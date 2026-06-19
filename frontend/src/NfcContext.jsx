import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { connectNfcBridge, getPermittedDevice, isWebBluetoothSupported } from "./lib/nfcBridge";
import { apiFetch } from "./lib/api";

// Hält EINE app-weite Bluetooth-Verbindung zur NFC-Box. Kasse und
// Kartenverwaltung teilen sich diese Verbindung, statt jeweils eigene
// aufzubauen. Status wird oben in der App angezeigt.

const NfcContext = createContext(null);

const AUTO_RETRY_MS = 5000;
const STARTUP_RETRY_DELAYS = [500, 1500, 3000, 6000, 10000];

// Verbindungsstatus: "disconnected" | "connecting" | "connected" | "unsupported"
export function NfcProvider({ children }) {
  const [status, setStatus] = useState(
    isWebBluetoothSupported() ? "disconnected" : "unsupported"
  );
  const [statusText, setStatusText] = useState("");
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("kasseBleNfcEnabled") !== "0"; } catch { return true; }
  });

  const statusRef = useRef(status);
  const disconnectRef = useRef(null);
  const connectingRef = useRef(false);
  const retryTimerRef = useRef(null);

  // Liste von Callbacks, die bei einer gelesenen UID benachrichtigt werden.
  // So können sich Kasse UND Kartenverwaltung gleichzeitig "anhören".
  const uidListenersRef = useRef(new Set());

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const emitUid = useCallback((uid) => {
    uidListenersRef.current.forEach((cb) => {
      try { cb(uid); } catch { /* einzelne Listener-Fehler ignorieren */ }
    });
  }, []);

  // Registriert einen UID-Listener, gibt eine Abmeldefunktion zurück.
  const subscribeUid = useCallback((cb) => {
    uidListenersRef.current.add(cb);
    return () => uidListenersRef.current.delete(cb);
  }, []);

  const markDisconnected = useCallback((text = "NFC-Box getrennt") => {
    disconnectRef.current = null;
    connectingRef.current = false;
    setStatus("disconnected");
    setStatusText(text);
  }, []);

  // Verbindung aufbauen. allowDialog=true erlaubt den Geräte-Auswahldialog
  // (nur aus einer Nutzergeste heraus möglich). Beim Auto-Connect ist er false.
  const connect = useCallback(async (allowDialog = true) => {
    if (!enabled) {
      return false;
    }

    if (!isWebBluetoothSupported()) {
      setStatus("unsupported");
      return false;
    }

    if (disconnectRef.current || connectingRef.current) {
      return statusRef.current === "connected";
    }

    // Bei Auto-Connect (kein Dialog): nur fortfahren, wenn ein bereits
    // erlaubtes Gerät existiert. Sonst lautlos abbrechen.
    if (!allowDialog) {
      const known = await getPermittedDevice();
      if (!known) return false;

      // Wenn die App im Hintergrund ist, nicht aggressiv scannen/verbinden.
      if (document.visibilityState === "hidden") return false;
    }

    connectingRef.current = true;
    setStatus("connecting");

    try {
      const disconnect = await connectNfcBridge(
        (uid) => emitUid(uid),
        (text) => setStatusText(text),
        {
          allowDialog,
          onDisconnected: () => {
            markDisconnected("NFC-Box getrennt — verbinde automatisch neu …");
          },
        }
      );

      disconnectRef.current = disconnect;
      connectingRef.current = false;
      setStatus("connected");
      return true;
    } catch (err) {
      connectingRef.current = false;
      setStatus("disconnected");

      if (allowDialog) {
        if (err?.name === "NotFoundError") {
          setStatusText("Keine NFC-Box ausgewählt");
        } else if (err?.name === "SecurityError") {
          setStatusText("Bluetooth-Auswahl muss direkt per Tipp gestartet werden");
        } else {
          setStatusText("Verbindung fehlgeschlagen");
        }
      } else {
        // Kein roter Fehler beim automatischen Versuch: Die Box ist vielleicht
        // noch nicht hochgefahren. Der Timer versucht es weiter.
        setStatusText("NFC-Box nicht erreichbar — erneuter Versuch läuft …");
      }

      return false;
    }
  }, [enabled, emitUid, markDisconnected]);

  const disconnect = useCallback(() => {
    if (disconnectRef.current) {
      disconnectRef.current();
      disconnectRef.current = null;
    }
    connectingRef.current = false;
    setStatus("disconnected");
    setStatusText("");
  }, []);

  // Zahlungs-Einstellungen laden: Wenn die NFC-Box deaktiviert ist, wird weder
  // der Status angezeigt noch automatisch verbunden.
  useEffect(() => {
    let cancelled = false;

    const applyEnabled = (value) => {
      if (cancelled) return;
      const nextEnabled = value !== false;
      setEnabled(nextEnabled);
      try { localStorage.setItem("kasseBleNfcEnabled", nextEnabled ? "1" : "0"); } catch {}
      if (!nextEnabled) disconnect();
    };

    const load = async () => {
      try {
        const res = await apiFetch(`/api/settings/payment`);
        if (!res.ok) return;
        const data = await res.json();
        applyEnabled(data.enabled?.bleNfc);
      } catch {
        // Bei Serverfehler bleibt der lokal bekannte Zustand bestehen.
      }
    };

    const handleSettingsUpdate = (event) => {
      applyEnabled(event.detail?.enabled?.bleNfc);
    };

    load();
    window.addEventListener("kasse:payment-settings-updated", handleSettingsUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("kasse:payment-settings-updated", handleSettingsUpdate);
    };
  }, [disconnect]);

  // Auto-Reconnect: Beim ersten Laden, beim Zurückkehren aus Standby und danach
  // periodisch versuchen, eine bereits erlaubte NFC-Box wieder zu verbinden.
  // Das öffnet NIE den Geräte-Auswahldialog.
  useEffect(() => {
    if (!enabled || !isWebBluetoothSupported()) return undefined;

    let cancelled = false;

    const tryAutoConnect = async () => {
      if (cancelled) return;
      if (statusRef.current === "connected" || connectingRef.current) return;
      if (document.visibilityState === "hidden") return;
      await connect(false);
    };

    // Direkt mehrfach probieren: Android/Chrome braucht nach dem Starten einer
    // installierten PWA manchmal mehrere Sekunden, bis Bluetooth wieder bereit ist.
    const startupTimers = STARTUP_RETRY_DELAYS.map((delay) =>
      window.setTimeout(tryAutoConnect, delay)
    );
    retryTimerRef.current = window.setInterval(tryAutoConnect, AUTO_RETRY_MS);

    const scheduleSoon = () => {
      window.setTimeout(tryAutoConnect, 500);
      window.setTimeout(tryAutoConnect, 2000);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") scheduleSoon();
    };

    const handleFocus = () => scheduleSoon();
    const handlePageShow = () => scheduleSoon();
    const handleOnline = () => scheduleSoon();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      startupTimers.forEach((timer) => window.clearTimeout(timer));
      if (retryTimerRef.current) window.clearInterval(retryTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
    };
  }, [connect, enabled]);

  const value = {
    status,
    statusText,
    connect,
    disconnect,
    subscribeUid,
    isSupported: isWebBluetoothSupported(),
    enabled,
  };

  return <NfcContext.Provider value={value}>{children}</NfcContext.Provider>;
}

export function useNfc() {
  const ctx = useContext(NfcContext);
  if (!ctx) throw new Error("useNfc muss innerhalb von <NfcProvider> verwendet werden");
  return ctx;
}
