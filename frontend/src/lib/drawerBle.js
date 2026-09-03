import { Capacitor } from "@capacitor/core";
import { BleClient, ScanMode } from "@capacitor-community/bluetooth-le";
import { acquireBleScan } from "./bleScanLock";

export const DRAWER_SERVICE_UUID = "7a0f2001-1b55-4e2a-9c2e-9a6b9f3a2c10";
export const DRAWER_CMD_UUID = "7a0f2002-1b55-4e2a-9c2e-9a6b9f3a2c10";
const DEVICE_NAME = "KasseDrawer";
const STORAGE_DEVICE_ID_KEY = "kasseDrawerDeviceId";

let initialized = false;
let connectedId = null;
let connecting = false;

export function isDrawerBleAvailable() {
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
  const uuids = (result?.uuids || result?.device?.uuids || []).map((u)=>String(u).toLowerCase());
  return name === DEVICE_NAME || uuids.includes(DRAWER_SERVICE_UUID);
}
async function scan(timeoutMs=12000) {
  await init();
  const release = await acquireBleScan("drawer");
  try {
    return await new Promise(async (resolve,reject)=>{
      let done=false;
      const timer=window.setTimeout(async()=>{
        if(done)return; done=true; try{await BleClient.stopLEScan();}catch{}
        reject(new Error("KasseDrawer wurde nicht gefunden."));
      },timeoutMs);
      try{
        await BleClient.requestLEScan({allowDuplicates:false,scanMode:ScanMode.SCAN_MODE_LOW_LATENCY},async(result)=>{
          if(done||!match(result))return;
          done=true; window.clearTimeout(timer);
          try{await BleClient.stopLEScan();}catch{}
          const id=result?.device?.deviceId;
          if(!id)return reject(new Error("Drawer ohne Geräte-ID gefunden."));
          remember(id); resolve(id);
        });
      }catch(err){
        if(done)return; done=true; window.clearTimeout(timer);
        try{await BleClient.stopLEScan();}catch{} reject(err);
      }
    });
  } finally { release(); }
}
async function openConnection(id,onDisconnected) {
  await init();
  await BleClient.connect(id,()=>{ if(connectedId===id)connectedId=null; onDisconnected?.(); },{timeout:12000});
  connectedId=id; remember(id); return true;
}
export async function connectDrawer({allowScan=false,onDisconnected}={}) {
  if(!isDrawerBleAvailable())return false;
  if(connectedId)return true;
  if(connecting)return false;
  connecting=true;
  try{
    const known=savedId();
    if(known){try{return await openConnection(known,onDisconnected);}catch{}}
    if(!allowScan)return false;
    const id=await scan();
    return await openConnection(id,onDisconnected);
  } finally { connecting=false; }
}
export async function disconnectDrawer() {
  if(!connectedId)return;
  const id=connectedId; connectedId=null;
  try{await BleClient.disconnect(id);}catch{}
}
export function getDrawerBleState(){return {connected:Boolean(connectedId),deviceId:connectedId||savedId()||""};}
export async function openDrawerBle() {
  if(!connectedId)throw new Error("Kassenschublade nicht verbunden");
  const bytes=new TextEncoder().encode("OPEN");
  await BleClient.writeWithoutResponse(
    connectedId,
    DRAWER_SERVICE_UUID,
    DRAWER_CMD_UUID,
    new DataView(bytes.buffer)
  );
  return true;
}
