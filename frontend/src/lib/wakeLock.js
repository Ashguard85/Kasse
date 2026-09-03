import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeScreenAwake = registerPlugin("ScreenAwake");
const STORAGE_KEY = "kasseScreenAwakeSettings";

let browserLock = null;
let requested = false;

export function getScreenAwakeSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      register: parsed.register !== false,
      customerDisplay: parsed.customerDisplay !== false,
    };
  } catch {
    return { register: true, customerDisplay: true };
  }
}

export function setScreenAwakeSettings(next = {}) {
  const current = getScreenAwakeSettings();
  const value = {
    register: next.register ?? current.register,
    customerDisplay: next.customerDisplay ?? current.customerDisplay,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  window.dispatchEvent(new CustomEvent("kasse:screen-awake-updated", { detail: value }));
  return value;
}

async function setNative(enabled) {
  try {
    if (!Capacitor.isNativePlatform()) return;
    await NativeScreenAwake.setEnabled({ enabled: Boolean(enabled) });
  } catch {}
}

async function acquireBrowser() {
  if (!requested || document.visibilityState !== "visible") return;
  if (!("wakeLock" in navigator) || browserLock) return;
  try {
    browserLock = await navigator.wakeLock.request("screen");
    browserLock.addEventListener("release", () => { browserLock = null; });
  } catch {}
}

async function releaseBrowser() {
  if (!browserLock) return;
  try { await browserLock.release(); } catch {}
  browserLock = null;
}

export async function setScreenAwake(enabled) {
  requested = Boolean(enabled);
  await setNative(requested);
  if (requested) await acquireBrowser();
  else await releaseBrowser();
}

export function installWakeLockRecovery() {
  const restore = () => {
    if (requested && document.visibilityState === "visible") {
      setNative(true);
      acquireBrowser();
    }
  };
  document.addEventListener("visibilitychange", restore);
  window.addEventListener("focus", restore);
  return () => {
    document.removeEventListener("visibilitychange", restore);
    window.removeEventListener("focus", restore);
  };
}
