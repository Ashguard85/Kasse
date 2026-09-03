import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayBleState,
  isNativeDisplayBleAvailable,
  sendCustomerDisplayState,
} from "./lib/customerDisplayBle";
import { getDataMode } from "./lib/api";

const Ctx = createContext(null);

export function CustomerDisplayBleProvider({ children }) {
  const [status, setStatus] = useState(() => getCustomerDisplayBleState().connected ? "connected" : "disconnected");
  const retryRef = useRef(null);
  const inputQueueRef = useRef([]);

  const connect = useCallback(async (allowScan = false) => {
    if (!isNativeDisplayBleAvailable()) {
      setStatus("unsupported");
      return false;
    }
    setStatus("connecting");
    try {
      const ok = await connectCustomerDisplay({
        allowScan,
        onDisconnected: () => setStatus("disconnected"),
        onInput: (input) => inputQueueRef.current.push(input),
      });
      setStatus(ok ? "connected" : "disconnected");
      return ok;
    } catch {
      setStatus("disconnected");
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectCustomerDisplay();
    setStatus("disconnected");
  }, []);

  const send = useCallback(async (payload) => {
    if (getDataMode() !== "local") return false;
    if (status !== "connected") {
      const ok = await connect(false);
      if (!ok) return false;
    }
    try {
      await sendCustomerDisplayState(payload);
      return true;
    } catch {
      setStatus("disconnected");
      return false;
    }
  }, [connect, status]);

  useEffect(() => {
    if (!isNativeDisplayBleAvailable()) return undefined;
    const auto = () => {
      if (getDataMode() === "local" && status !== "connected" && status !== "connecting") connect(false);
    };
    const timers = [700, 2500, 6000].map((ms) => window.setTimeout(auto, ms));
    retryRef.current = window.setInterval(auto, 7000);
    return () => {
      timers.forEach(window.clearTimeout);
      if (retryRef.current) window.clearInterval(retryRef.current);
    };
  }, [connect, status]);

  const consumeInput = useCallback(() => inputQueueRef.current.shift() || null, []);

  return <Ctx.Provider value={{ status, connect, disconnect, send, consumeInput, supported: isNativeDisplayBleAvailable() }}>{children}</Ctx.Provider>;
}

export function useCustomerDisplayBle() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCustomerDisplayBle benötigt CustomerDisplayBleProvider");
  return value;
}
