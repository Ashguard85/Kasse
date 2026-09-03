import { Capacitor } from "@capacitor/core";
import { BleClient, ScanMode } from "@capacitor-community/bluetooth-le";
import { acquireBleScan } from "./bleScanLock";

export const DISPLAY_SERVICE_UUID = "7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10";
export const DISPLAY_RX_UUID = "7a0f1002-1b55-4e2a-9c2e-9a6b9f3a2c10";
export const DISPLAY_INPUT_UUID = "7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10";
const DEVICE_NAME = "KasseDisplay";
const STORAGE_DEVICE_ID_KEY = "kasseDisplayDeviceId";

let initialized = false;
let connectedId = null;
let connecting = false;

export function isNativeDisplayBleAvailable() {
  return Capacitor.isNativePlatform();
}

function savedId() {
  try { return localStorage.getItem(STORAGE_DEVICE_ID_KEY) || ""; } catch { return ""; }
}
function remember(id) {
  try { if (id) localStorage.setItem(STORAGE_DEVICE_ID_KEY, id); } catch {}
}

async function init() {
  if (initialized) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  initialized = true;
  try {
    const enabled = await BleClient.isEnabled();
    if (!enabled) await BleClient.requestEnable();
  } catch {}
}

function match(result) {
  const name = result?.localName || result?.device?.name || "";
  const uuids = (result?.uuids || result?.device?.uuids || []).map((u) => String(u).toLowerCase());
  return name === DEVICE_NAME || uuids.includes(DISPLAY_SERVICE_UUID);
}

async function scan(timeoutMs = 12000) {
  await init();
  const release = await acquireBleScan("display");
  try {
    return await new Promise(async (resolve, reject) => {
      let done = false;
      const timer = window.setTimeout(async () => {
        if (done) return;
        done = true;
        try { await BleClient.stopLEScan(); } catch {}
        reject(new Error("KasseDisplay wurde nicht gefunden."));
      }, timeoutMs);

      try {
        await BleClient.requestLEScan(
          { allowDuplicates: false, scanMode: ScanMode.SCAN_MODE_LOW_LATENCY },
          async (result) => {
            if (done || !match(result)) return;
            done = true;
            window.clearTimeout(timer);
            try { await BleClient.stopLEScan(); } catch {}
            const id = result?.device?.deviceId;
            if (!id) return reject(new Error("Display ohne Geräte-ID gefunden."));
            remember(id);
            resolve(id);
          }
        );
      } catch (err) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try { await BleClient.stopLEScan(); } catch {}
        reject(err);
      }
    });
  } finally {
    release();
  }
}

async function open(id, onDisconnected, onInput) {
  await init();
  await BleClient.connect(id, () => {
    if (connectedId === id) connectedId = null;
    onDisconnected?.();
  }, { timeout: 12000 });
  connectedId = id;
  remember(id);
  try {
    await BleClient.startNotifications(
      id,
      DISPLAY_SERVICE_UUID,
      DISPLAY_INPUT_UUID,
      (value) => {
        try {
          const text = new TextDecoder("utf-8").decode(value).trim();
          const data = JSON.parse(text);
          onInput?.(data);
        } catch {}
      }
    );
  } catch {}
  return id;
}

export async function connectCustomerDisplay({ allowScan = false, onDisconnected, onInput } = {}) {
  if (!isNativeDisplayBleAvailable()) return false;
  if (connectedId) return true;
  if (connecting) return false;
  connecting = true;
  try {
    const known = savedId();
    if (known) {
      try {
        await open(known, onDisconnected, onInput);
        return true;
      } catch {}
    }
    if (!allowScan) return false;
    const id = await scan();
    await open(id, onDisconnected, onInput);
    return true;
  } finally {
    connecting = false;
  }
}

export async function disconnectCustomerDisplay() {
  if (!connectedId) return;
  const id = connectedId;
  connectedId = null;
  try { await BleClient.stopNotifications(id, DISPLAY_SERVICE_UUID, DISPLAY_INPUT_UUID); } catch {}
  try { await BleClient.disconnect(id); } catch {}
}

export function getCustomerDisplayBleState() {
  return { connected: Boolean(connectedId), deviceId: connectedId || savedId() || "" };
}

function toDataView(bytes) {
  return new DataView(Uint8Array.from(bytes).buffer);
}

export async function sendCustomerDisplayState(payload) {
  if (!connectedId) throw new Error("Kundendisplay nicht verbunden");
  const text = JSON.stringify(payload || {});
  const bytes = new TextEncoder().encode(text);
  const chunkSize = 150;
  const total = Math.ceil(bytes.length / chunkSize);
  const messageId = Date.now() & 0xffff;

  for (let index = 0; index < total; index += 1) {
    const slice = bytes.slice(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize));
    const frame = [
      0x4b, 0x44, // "KD"
      (messageId >> 8) & 0xff, messageId & 0xff,
      index & 0xff, total & 0xff,
      ...slice,
    ];
    await BleClient.writeWithoutResponse(
      connectedId,
      DISPLAY_SERVICE_UUID,
      DISPLAY_RX_UUID,
      toDataView(frame)
    );
  }
}
