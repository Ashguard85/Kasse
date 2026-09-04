import { Capacitor } from "@capacitor/core";
import { BleClient, ScanMode } from "@capacitor-community/bluetooth-le";
import { acquireBleScan } from "./bleScanLock";

export const DISPLAY_SERVICE_UUID = "7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10";
export const DISPLAY_RX_UUID = "7a0f1002-1b55-4e2a-9c2e-9a6b9f3a2c10";
export const DISPLAY_INPUT_UUID = "7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10";
const DEVICE_NAME = "KasseDisplay";
const STORAGE_DEVICE_ID_KEY = "kasseDisplayDeviceId";

let nativeInitialized = false;
let nativeConnectedId = null;
let nativeConnecting = false;

let webDevice = null;
let webRxCharacteristic = null;
let webInputCharacteristic = null;
let webInputHandler = null;
let webDisconnectHandler = null;
let webConnecting = false;

function isNativePlatform() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function isCustomerDisplayBleAvailable() {
  if (isNativePlatform()) return true;
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

// Rückwärtskompatibel für ältere Aufrufer.
export function isNativeDisplayBleAvailable() {
  return isCustomerDisplayBleAvailable();
}

function savedId() {
  try { return localStorage.getItem(STORAGE_DEVICE_ID_KEY) || ""; } catch { return ""; }
}
function remember(id) {
  try { if (id) localStorage.setItem(STORAGE_DEVICE_ID_KEY, id); } catch {}
}

async function initNative() {
  if (nativeInitialized) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  nativeInitialized = true;
  try {
    const enabled = await BleClient.isEnabled();
    if (!enabled) await BleClient.requestEnable();
  } catch {}
}

function matchNative(result) {
  const name = result?.localName || result?.device?.name || "";
  const uuids = (result?.uuids || result?.device?.uuids || []).map((u) => String(u).toLowerCase());
  return name === DEVICE_NAME || uuids.includes(DISPLAY_SERVICE_UUID);
}

async function scanNative(timeoutMs = 12000) {
  await initNative();
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
            if (done || !matchNative(result)) return;
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

async function openNative(id, onDisconnected, onInput) {
  await initNative();
  await BleClient.connect(id, () => {
    if (nativeConnectedId === id) nativeConnectedId = null;
    onDisconnected?.();
  }, { timeout: 12000 });
  nativeConnectedId = id;
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

async function connectNative({ allowScan = false, onDisconnected, onInput } = {}) {
  if (nativeConnectedId) return true;
  if (nativeConnecting) return false;
  nativeConnecting = true;
  try {
    const known = savedId();
    if (known) {
      try {
        await openNative(known, onDisconnected, onInput);
        return true;
      } catch {}
    }
    if (!allowScan) return false;
    const id = await scanNative();
    await openNative(id, onDisconnected, onInput);
    return true;
  } finally {
    nativeConnecting = false;
  }
}

function isMatchingWebDevice(device) {
  if (!device) return false;
  const known = savedId();
  if (known && device.id === known) return true;
  return device.name === DEVICE_NAME;
}

async function getKnownWebDevice() {
  if (webDevice) return webDevice;
  if (!navigator.bluetooth?.getDevices) return null;
  try {
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find(isMatchingWebDevice) || null;
    if (device) {
      webDevice = device;
      remember(device.id);
    }
    return device;
  } catch {
    return null;
  }
}

async function requestWebDevice() {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: DEVICE_NAME }],
    optionalServices: [DISPLAY_SERVICE_UUID],
  });
  webDevice = device;
  remember(device.id);
  return device;
}

function cleanupWebListeners() {
  if (webInputCharacteristic && webInputHandler) {
    try { webInputCharacteristic.removeEventListener("characteristicvaluechanged", webInputHandler); } catch {}
  }
  if (webDevice && webDisconnectHandler) {
    try { webDevice.removeEventListener("gattserverdisconnected", webDisconnectHandler); } catch {}
  }
  webRxCharacteristic = null;
  webInputCharacteristic = null;
  webInputHandler = null;
  webDisconnectHandler = null;
}

async function openWeb(device, onDisconnected, onInput) {
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(DISPLAY_SERVICE_UUID);
  const rx = await service.getCharacteristic(DISPLAY_RX_UUID);
  const input = await service.getCharacteristic(DISPLAY_INPUT_UUID);

  cleanupWebListeners();
  webDevice = device;
  webRxCharacteristic = rx;
  webInputCharacteristic = input;
  remember(device.id);

  webInputHandler = (event) => {
    try {
      const text = new TextDecoder("utf-8").decode(event.target.value).trim();
      const data = JSON.parse(text);
      onInput?.(data);
    } catch {}
  };
  webDisconnectHandler = () => {
    cleanupWebListeners();
    onDisconnected?.();
  };

  try {
    await input.startNotifications();
    input.addEventListener("characteristicvaluechanged", webInputHandler);
  } catch {}
  device.addEventListener("gattserverdisconnected", webDisconnectHandler);
  return true;
}

async function connectWeb({ allowScan = false, onDisconnected, onInput } = {}) {
  if (webDevice?.gatt?.connected && webRxCharacteristic) return true;
  if (webConnecting) return false;
  webConnecting = true;
  try {
    let device = await getKnownWebDevice();
    if (!device) {
      if (!allowScan) return false;
      device = await requestWebDevice();
    }
    try {
      await openWeb(device, onDisconnected, onInput);
      return true;
    } catch (err) {
      if (!allowScan) return false;
      webDevice = null;
      const fresh = await requestWebDevice();
      await openWeb(fresh, onDisconnected, onInput);
      return true;
    }
  } finally {
    webConnecting = false;
  }
}

export async function connectCustomerDisplay(options = {}) {
  if (!isCustomerDisplayBleAvailable()) return false;
  return isNativePlatform() ? connectNative(options) : connectWeb(options);
}

export async function disconnectCustomerDisplay() {
  if (nativeConnectedId) {
    const id = nativeConnectedId;
    nativeConnectedId = null;
    try { await BleClient.stopNotifications(id, DISPLAY_SERVICE_UUID, DISPLAY_INPUT_UUID); } catch {}
    try { await BleClient.disconnect(id); } catch {}
  }

  if (webDevice) {
    try { if (webInputCharacteristic) await webInputCharacteristic.stopNotifications(); } catch {}
    cleanupWebListeners();
    try { if (webDevice.gatt?.connected) webDevice.gatt.disconnect(); } catch {}
  }
}

export function getCustomerDisplayBleState() {
  const webConnected = Boolean(webDevice?.gatt?.connected && webRxCharacteristic);
  return {
    connected: Boolean(nativeConnectedId) || webConnected,
    deviceId: nativeConnectedId || (webConnected ? webDevice?.id : "") || savedId() || "",
  };
}

function toDataView(bytes) {
  return new DataView(Uint8Array.from(bytes).buffer);
}

async function writeWebFrame(frame) {
  if (!webRxCharacteristic) throw new Error("Kundendisplay nicht verbunden");
  const bytes = Uint8Array.from(frame);
  if (typeof webRxCharacteristic.writeValueWithoutResponse === "function") {
    await webRxCharacteristic.writeValueWithoutResponse(bytes);
  } else {
    await webRxCharacteristic.writeValue(bytes);
  }
}

export async function sendCustomerDisplayState(payload) {
  const text = JSON.stringify(payload || {});
  const bytes = new TextEncoder().encode(text);
  const chunkSize = 150;
  const total = Math.ceil(bytes.length / chunkSize);
  const messageId = Date.now() & 0xffff;

  if (!nativeConnectedId && !webRxCharacteristic) throw new Error("Kundendisplay nicht verbunden");

  for (let index = 0; index < total; index += 1) {
    const slice = bytes.slice(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize));
    const frame = [
      0x4b, 0x44, // "KD"
      (messageId >> 8) & 0xff, messageId & 0xff,
      index & 0xff, total & 0xff,
      ...slice,
    ];

    if (nativeConnectedId) {
      await BleClient.writeWithoutResponse(
        nativeConnectedId,
        DISPLAY_SERVICE_UUID,
        DISPLAY_RX_UUID,
        toDataView(frame)
      );
    } else {
      await writeWebFrame(frame);
    }
  }
}
