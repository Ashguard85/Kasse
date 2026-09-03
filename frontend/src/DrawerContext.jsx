import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from "react";
import {connectDrawer,disconnectDrawer,getDrawerBleState,isDrawerBleAvailable,openDrawerBle} from "./lib/drawerBle";
import {getDataMode} from "./lib/api";

const Ctx=createContext(null);

export function DrawerProvider({children}) {
  const [status,setStatus]=useState(()=>getDrawerBleState().connected?"connected":"disconnected");
  const retryRef=useRef(null);

  const connect=useCallback(async(allowScan=false)=>{
    if(!isDrawerBleAvailable()){setStatus("unsupported");return false;}
    setStatus("connecting");
    try{
      const ok=await connectDrawer({allowScan,onDisconnected:()=>setStatus("disconnected")});
      setStatus(ok?"connected":"disconnected"); return ok;
    }catch{setStatus("disconnected");return false;}
  },[]);

  const disconnect=useCallback(async()=>{await disconnectDrawer();setStatus("disconnected");},[]);
  const open=useCallback(async()=>{
    if(getDataMode()!=="local")return false;
    if(status!=="connected"){const ok=await connect(false);if(!ok)return false;}
    try{await openDrawerBle();return true;}catch{setStatus("disconnected");return false;}
  },[connect,status]);

  useEffect(()=>{
    if(!isDrawerBleAvailable())return undefined;
    const auto=()=>{if(getDataMode()==="local"&&status!=="connected"&&status!=="connecting")connect(false);};
    const timers=[900,3200,7000].map(ms=>window.setTimeout(auto,ms));
    retryRef.current=window.setInterval(auto,9000);
    return()=>{timers.forEach(window.clearTimeout);if(retryRef.current)window.clearInterval(retryRef.current);};
  },[connect,status]);

  return <Ctx.Provider value={{status,connect,disconnect,open,supported:isDrawerBleAvailable()}}>{children}</Ctx.Provider>;
}
export function useDrawer(){const v=useContext(Ctx);if(!v)throw new Error("useDrawer benötigt DrawerProvider");return v;}
