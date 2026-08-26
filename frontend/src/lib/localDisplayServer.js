import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeLocalDisplayServer = registerPlugin("LocalDisplayServer");

export function isLocalDisplayServerAvailable() {
  return Capacitor.isNativePlatform();
}
export async function startLocalDisplayServer() {
  if (!isLocalDisplayServerAvailable()) return { running: false, url: "", ip: "", port: 3890 };
  return await NativeLocalDisplayServer.start();
}
export async function stopLocalDisplayServer() {
  if (!isLocalDisplayServerAvailable()) return;
  return await NativeLocalDisplayServer.stop();
}
export async function getLocalDisplayServerInfo() {
  if (!isLocalDisplayServerAvailable()) return { running: false, url: "", ip: "", port: 3890 };
  return await NativeLocalDisplayServer.getInfo();
}
export async function publishLocalDisplayState(payload) {
  if (!isLocalDisplayServerAvailable()) return false;
  await NativeLocalDisplayServer.updateState({ json: JSON.stringify(payload || {}) });
  return true;
}

export async function consumeLocalDisplayInput() {
  if (!isLocalDisplayServerAvailable()) return null;
  try {
    const result = await NativeLocalDisplayServer.consumeInput();
    if (!result?.json) return null;
    return JSON.parse(result.json);
  } catch { return null; }
}
