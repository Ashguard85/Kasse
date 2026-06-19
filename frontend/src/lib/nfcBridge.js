// NFC-Bridge zum ESP32 + RC522/PN532 NFC-Leser.
// Docker/Webapp-Version: nutzt Web Bluetooth im Browser.
// Hinweis: Web Bluetooth verlangt beim ersten Verbinden den Browser-Gerätedialog.

const SERVICE_UUID = "7a0f0001-1b55-4e2a-9c2e-9a6b9f3a2c10";
const UID_CHAR_UUID = "7a0f0002-1b55-4e2a-9c2e-9a6b9f3a2c10";
const DEVICE_NAME = "KasseNFC";
const STORAGE_DEVICE_ID_KEY = "kasseNfcDeviceId";
const STORAGE_WAS_SETUP_KEY = "kasseNfcWasSetup";

let cachedDevice = null;

export function isWebBluetoothSupported() {
  return "bluetooth" in navigator;
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

  // Chrome kann bekannte Geräte manchmal ohne Namen zurückgeben.
  // Wenn die NFC-Box schon einmal eingerichtet wurde und nur ein Gerät erlaubt ist,
  // ist dieser Fallback für das Kinder-Kassen-Setup praktisch.
  if (devices.length === 1 && wasNfcSetupBefore()) return devices[0];

  return null;
}

function decodeText(value) {
  return new TextDecoder("utf-8").decode(value).trim();
}

// Für Diagnoseanzeige: Welche Geräte kennt Chrome für diese Website?
export async function getPermittedDeviceDebugInfo() {
  if (!isWebBluetoothSupported() || !navigator.bluetooth.getDevices) {
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
