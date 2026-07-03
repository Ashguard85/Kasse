// NFC-Bridge zum ESP32 + RC522/PN532 NFC-Leser.
// Web/PWA: nutzt Web Bluetooth (Browser-Sicherheitsdialog nötig).
// Android APK (Capacitor): nutzt native BLE und kann KasseNFC automatisch scannen/verbinden.

import { Capacitor } from "@capacitor/core";
import { BleClient, ScanMode } from "@capacitor-community/bluetooth-le";

const SERVICE_UUID = "7a0f0001-1b55-4e2a-9c2e-9a6b9f3a2c10";
const UID_CHAR_UUID = "7a0f0002-1b55-4e2a-9c2e-9a6b9f3a2c10";
const DEVICE_NAME = "KasseNFC";
const STORAGE_DEVICE_ID_KEY = "kasseNfcDeviceId";
const STORAGE_WAS_SETUP_KEY = "kasseNfcWasSetup";
const NATIVE_DEVICE_ID_KEY = "kasseNativeNfcDeviceId";

let cachedDevice = null;
let nativeInitialized = false;
let nativeConnecting = false;

export function isNativeBleApp() {
  return Capacitor.isNativePlatform();
}

export function isWebBluetoothSupported() {
  return isNativeBleApp() || "bluetooth" in navigator;
}

function makeError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function rememberDevice(device) {
  cachedDevice = device;
  try {
    if (device?.id) localStorage.setItem(STORAGE_DEVICE_ID_KEY, device.id);
    localStorage.setItem(STORAGE_WAS_SETUP_KEY, "1");
  } catch {}
}

function rememberNativeDevice(deviceId) {
  try {
    if (deviceId) localStorage.setItem(NATIVE_DEVICE_ID_KEY, deviceId);
    localStorage.setItem(STORAGE_WAS_SETUP_KEY, "1");
  } catch {}
}

function getRememberedNativeDeviceId() {
  try { return localStorage.getItem(NATIVE_DEVICE_ID_KEY); } catch { return null; }
}

function getRememberedDeviceId() {
  try { return localStorage.getItem(STORAGE_DEVICE_ID_KEY); } catch { return null; }
}

function wasNfcSetupBefore() {
  try { return localStorage.getItem(STORAGE_WAS_SETUP_KEY) === "1"; } catch { return false; }
}

function pickKnownDevice(devices) {
  if (!devices || devices.length === 0) return null;
  const rememberedId = getRememberedDeviceId();
  if (rememberedId) {
    const byId = devices.find((d) => d.id === rememberedId);
    if (byId) return byId;
  }
  const byName = devices.find((d) => d.name === DEVICE_NAME);
  if (byName) return byName;
  if (devices.length === 1 && wasNfcSetupBefore()) return devices[0];
  return null;
}

function decodeText(value) {
  return new TextDecoder("utf-8").decode(value).trim();
}

async function ensureNativeBle(onStatus) {
  if (nativeInitialized) return;
  onStatus?.("Bluetooth vorbereiten …");
  // androidNeverForLocation passt zum Manifest: Wir verwenden die Scanresultate nicht zur Standortbestimmung.
  await BleClient.initialize({ androidNeverForLocation: true });
  nativeInitialized = true;

  try {
    const enabled = await BleClient.isEnabled();
    if (!enabled) {
      onStatus?.("Bluetooth aktivieren …");
      await BleClient.requestEnable();
    }
  } catch {
    // Einige Android-Versionen melden hier nicht sauber. Der Verbindungsversuch zeigt den echten Fehler.
  }
}

function isKasseNfcScanResult(result) {
  const name = result?.localName || result?.device?.name || "";
  const uuids = result?.uuids || result?.device?.uuids || [];
  return name === DEVICE_NAME || uuids.map((u) => String(u).toLowerCase()).includes(SERVICE_UUID);
}

async function scanNativeDevice(onStatus, timeoutMs = 12000) {
  await ensureNativeBle(onStatus);
  onStatus?.("Suche NFC-Box …");

  let finished = false;
  return await new Promise(async (resolve, reject) => {
    const timer = window.setTimeout(async () => {
      if (finished) return;
      finished = true;
      try { await BleClient.stopLEScan(); } catch {}
      reject(makeError("NotFoundError", "KasseNFC wurde nicht gefunden."));
    }, timeoutMs);

    try {
      await BleClient.requestLEScan(
        {
          allowDuplicates: false,
          scanMode: ScanMode.SCAN_MODE_LOW_LATENCY,
        },
        async (result) => {
          if (finished || !isKasseNfcScanResult(result)) return;
          finished = true;
          window.clearTimeout(timer);
          try { await BleClient.stopLEScan(); } catch {}
          const device = result.device;
          if (!device?.deviceId) {
            reject(makeError("NotFoundError", "NFC-Box ohne Geräte-ID gefunden."));
          } else {
            rememberNativeDevice(device.deviceId);
            resolve(device);
          }
        }
      );
    } catch (err) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      try { await BleClient.stopLEScan(); } catch {}
      reject(err);
    }
  });
}

async function openNativeConnection(deviceOrId, onUid, onStatus, onDisconnected) {
  const deviceId = typeof deviceOrId === "string" ? deviceOrId : deviceOrId.deviceId;
  if (!deviceId) throw makeError("NotFoundError", "Keine NFC-Box-Geräte-ID vorhanden.");

  await ensureNativeBle(onStatus);
  onStatus?.("Verbinde mit NFC-Box …");

  await BleClient.connect(
    deviceId,
    () => {
      onStatus?.("Bluetooth-Verbindung getrennt.");
      onDisconnected?.();
    },
    { timeout: 12000 }
  );

  rememberNativeDevice(deviceId);

  await BleClient.startNotifications(
    deviceId,
    SERVICE_UUID,
    UID_CHAR_UUID,
    (value) => {
      const uid = decodeText(value).toUpperCase();
      if (uid && uid !== "READY") onUid(uid);
    }
  );

  onStatus?.("Verbunden — Karte an die NFC-Box halten …");

  return async function disconnect() {
    try { await BleClient.stopNotifications(deviceId, SERVICE_UUID, UID_CHAR_UUID); } catch {}
    try { await BleClient.disconnect(deviceId); } catch {}
  };
}

async function connectNativeNfcBridge(onUid, onStatus, options = {}) {
  const { onDisconnected } = options;
  if (nativeConnecting) throw makeError("NetworkError", "NFC-Box-Verbindung läuft bereits.");
  nativeConnecting = true;

  try {
    const savedId = getRememberedNativeDeviceId();
    if (savedId) {
      try {
        onStatus?.("Bekannte NFC-Box verwenden …");
        return await openNativeConnection(savedId, onUid, onStatus, onDisconnected);
      } catch {
        // Falls MAC/Verbindung gerade nicht klappt: per Scan neu finden.
      }
    }

    const device = await scanNativeDevice(onStatus);
    return await openNativeConnection(device, onUid, onStatus, onDisconnected);
  } finally {
    nativeConnecting = false;
  }
}

// Für Diagnoseanzeige: Welche Geräte kennt Chrome für diese Website?
export async function getPermittedDeviceDebugInfo() {
  if (isNativeBleApp()) {
    return {
      supported: true,
      native: true,
      count: getRememberedNativeDeviceId() ? 1 : 0,
      devices: getRememberedNativeDeviceId() ? [{ id: getRememberedNativeDeviceId(), name: DEVICE_NAME }] : [],
    };
  }

  if (!("bluetooth" in navigator) || !navigator.bluetooth.getDevices) {
    return { supported: false, count: 0, devices: [] };
  }

  try {
    const devices = await navigator.bluetooth.getDevices();
    return {
      supported: true,
      count: devices.length,
      rememberedId: getRememberedDeviceId(),
      devices: devices.map((d) => ({ id: d.id, name: d.name || "(ohne Name)" })),
    };
  } catch (err) {
    return { supported: true, error: err?.message || String(err), count: 0, devices: [] };
  }
}

export async function getPermittedDevice() {
  if (isNativeBleApp()) {
    // Native Android darf selbst scannen. Rückgabe ist nur ein Signal für den Auto-Connect-Pfad.
    return { native: true };
  }

  if (!isWebBluetoothSupported()) return null;
  if (cachedDevice) return cachedDevice;

  if (navigator.bluetooth.getDevices) {
    try {
      const devices = await navigator.bluetooth.getDevices();
      const known = pickKnownDevice(devices);
      if (known) {
        rememberDevice(known);
        return known;
      }
    } catch {}
  }

  return null;
}

async function getKnownDevice(onStatus) {
  if (cachedDevice) {
    onStatus?.("Bekannte NFC-Box verwenden …");
    return cachedDevice;
  }

  if (navigator.bluetooth.getDevices) {
    try {
      onStatus?.("Suche bereits erlaubte NFC-Box …");
      const devices = await navigator.bluetooth.getDevices();
      const known = pickKnownDevice(devices);
      if (known) {
        rememberDevice(known);
        return known;
      }
    } catch {}
  }
  return null;
}

async function requestNewDevice(onStatus) {
  onStatus?.("Bluetooth-Gerät auswählen …");
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: DEVICE_NAME }],
    optionalServices: [SERVICE_UUID],
  });
  rememberDevice(device);
  return device;
}

async function openWebConnection(device, onUid, onStatus, onDisconnected) {
  onStatus?.("Verbinde mit NFC-Box …");

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const characteristic = await service.getCharacteristic(UID_CHAR_UUID);

  const handleNotification = (event) => {
    const uid = decodeText(event.target.value).toUpperCase();
    if (uid && uid !== "READY") onUid(uid);
  };

  await characteristic.startNotifications();
  characteristic.addEventListener("characteristicvaluechanged", handleNotification);

  const handleDisconnect = () => {
    onStatus?.("Bluetooth-Verbindung getrennt.");
    onDisconnected?.();
  };

  device.addEventListener("gattserverdisconnected", handleDisconnect);
  onStatus?.("Verbunden — Karte an die NFC-Box halten …");

  return function disconnect() {
    characteristic.removeEventListener("characteristicvaluechanged", handleNotification);
    device.removeEventListener("gattserverdisconnected", handleDisconnect);
    if (device.gatt?.connected) device.gatt.disconnect();
  };
}

export async function connectNfcBridge(onUid, onStatus, options = {}) {
  const { allowDialog = true, onDisconnected } = options;

  if (isNativeBleApp()) {
    return await connectNativeNfcBridge(onUid, onStatus, options);
  }

  if (!isWebBluetoothSupported()) {
    throw makeError("NotSupportedError", "Web Bluetooth wird von diesem Browser nicht unterstützt.");
  }

  let device = await getKnownDevice(onStatus);
  if (!device) {
    if (!allowDialog) throw makeError("NotFoundError", "Keine bereits erlaubte NFC-Box gefunden.");
    device = await requestNewDevice(onStatus);
  }

  try {
    return await openWebConnection(device, onUid, onStatus, onDisconnected);
  } catch (err) {
    if (!allowDialog) throw err;
    cachedDevice = null;
    if (err.name === "NetworkError" || err.name === "NotFoundError") {
      const freshDevice = await requestNewDevice(onStatus);
      return await openWebConnection(freshDevice, onUid, onStatus, onDisconnected);
    }
    throw err;
  }
}
