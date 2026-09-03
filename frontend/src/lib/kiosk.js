const CONFIG_KEY = "kasseKioskConfig";
const DEVICE_RESET_KEY = "kasseKioskResetVersion";

function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); } catch { return {}; }
}
function writeConfig(config) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config || {})); } catch {}
  window.dispatchEvent(new CustomEvent("kasse:kiosk-updated"));
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const clean = String(hex || "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function deriveHash(secret, saltHex) {
  const salt = hexToBytes(saltHex);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 },
    material,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}
function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}
export function createRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let raw = "";
  for (const b of buf) raw += alphabet[b % alphabet.length];
  return `KINDERKASSE-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}
export function getKioskConfig() {
  const c = readConfig();
  return {
    configured: Boolean(c.pinHash && c.pinSalt && c.recoveryHash && c.recoverySalt),
    locked: c.locked === true,
  };
}
export async function configureKiosk(pin) {
  const clean = String(pin || "").trim();
  if (!/^\d{4,8}$/.test(clean)) throw new Error("PIN muss aus 4 bis 8 Ziffern bestehen.");
  const recoveryCode = createRecoveryCode();
  const pinSalt = randomHex();
  const recoverySalt = randomHex();
  const config = {
    pinSalt,
    pinHash: await deriveHash(clean, pinSalt),
    recoverySalt,
    recoveryHash: await deriveHash(recoveryCode.toUpperCase(), recoverySalt),
    locked: false,
  };
  writeConfig(config);
  return recoveryCode;
}
export function setKioskLocked(locked) {
  const c = readConfig();
  if (!c.pinHash) return false;
  c.locked = locked === true;
  writeConfig(c);
  return c.locked;
}
export async function verifyPin(pin) {
  const c = readConfig();
  if (!c.pinHash || !c.pinSalt) return false;
  return (await deriveHash(String(pin || ""), c.pinSalt)) === c.pinHash;
}
export async function verifyRecovery(code) {
  const c = readConfig();
  if (!c.recoveryHash || !c.recoverySalt) return false;
  return (await deriveHash(String(code || "").trim().toUpperCase(), c.recoverySalt)) === c.recoveryHash;
}
export async function replacePinWithRecovery(code, newPin) {
  if (!(await verifyRecovery(code))) return false;
  const clean = String(newPin || "").trim();
  if (!/^\d{4,8}$/.test(clean)) throw new Error("PIN muss aus 4 bis 8 Ziffern bestehen.");
  const c = readConfig();
  c.pinSalt = randomHex();
  c.pinHash = await deriveHash(clean, c.pinSalt);
  c.locked = false;
  writeConfig(c);
  return true;
}
export function removeKioskConfig() {
  try { localStorage.removeItem(CONFIG_KEY); } catch {}
  window.dispatchEvent(new CustomEvent("kasse:kiosk-updated"));
}
export function getSeenResetVersion() {
  try { return Number(localStorage.getItem(DEVICE_RESET_KEY) || 0) || 0; } catch { return 0; }
}
export function setSeenResetVersion(version) {
  const value = Number(version || 0) || 0;
  try { localStorage.setItem(DEVICE_RESET_KEY, String(value)); } catch {}
  return value;
}
export function applyServerResetVersion(version) {
  const next = Number(version || 0) || 0;
  const seen = getSeenResetVersion();
  if (next > seen) {
    try { localStorage.setItem(DEVICE_RESET_KEY, String(next)); } catch {}
    removeKioskConfig();
    return true;
  }
  if (next && !seen) {
    try { localStorage.setItem(DEVICE_RESET_KEY, String(next)); } catch {}
  }
  return false;
}
