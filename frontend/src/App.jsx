import React, { useEffect, useState } from "react";
import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import Kasse from "./pages/Kasse";
import Admin from "./pages/Admin";
import Karten from "./pages/Karten";
import Einstellungen from "./pages/Einstellungen";
import Drucker from "./pages/Drucker";
import Statistik from "./pages/Statistik";
import KundenDisplay from "./pages/KundenDisplay";
import { CartProvider } from "./CartContext";
import { NfcProvider } from "./NfcContext";
import NfcStatus from "./NfcStatus";
import styles from "./App.module.css";
import { ProfileProvider, useProfile } from "./ProfileContext";
import { CustomerDisplayBleProvider } from "./CustomerDisplayBleContext";
import { DrawerProvider } from "./DrawerContext";
import { apiFetch, getDataMode } from "./lib/api";
import {
  getScreenAwakeSettings,
  installWakeLockRecovery,
  setScreenAwake,
} from "./lib/wakeLock";
import {
  applyServerResetVersion,
  getKioskConfig,
  setKioskLocked,
  verifyPin,
  verifyRecovery,
  replacePinWithRecovery,
} from "./lib/kiosk";

function UnlockDialog({ onClose, onUnlocked }) {
  const [mode, setMode] = useState("pin");
  const [pin, setPin] = useState("");
  const [recovery, setRecovery] = useState("");
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState("");

  const submitPin = async () => {
    if (await verifyPin(pin)) {
      setKioskLocked(false);
      onUnlocked();
      return;
    }
    setError("PIN ist nicht korrekt.");
  };

  const submitRecovery = async () => {
    try {
      const ok = await replacePinWithRecovery(recovery, newPin);
      if (!ok) return setError("Recovery-Code ist nicht korrekt.");
      onUnlocked();
    } catch (e) {
      setError(e.message || "PIN konnte nicht geändert werden.");
    }
  };

  return (
    <div className={styles.kioskOverlay}>
      <div className={styles.kioskDialog}>
        <div className={styles.kioskIcon}>🔐</div>
        <h2>Kassenmodus entsperren</h2>
        {mode === "pin" ? (
          <>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitPin(); }}
              placeholder="PIN"
              autoFocus
            />
            <button className={styles.kioskPrimary} onClick={submitPin}>Entsperren</button>
            <button className={styles.kioskLink} onClick={() => { setMode("recovery"); setError(""); }}>PIN vergessen?</button>
          </>
        ) : (
          <>
            <input value={recovery} onChange={(e) => { setRecovery(e.target.value); setError(""); }} placeholder="Recovery-Code" autoFocus />
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={newPin}
              onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "")); setError(""); }}
              placeholder="Neuer PIN (4–8 Ziffern)"
            />
            <button className={styles.kioskPrimary} onClick={submitRecovery}>Neuen PIN setzen</button>
            <button className={styles.kioskLink} onClick={() => { setMode("pin"); setError(""); }}>Zurück zur PIN-Eingabe</button>
          </>
        )}
        {error && <div className={styles.kioskError}>{error}</div>}
        <button className={styles.kioskCancel} onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

function AppShell() {
  const { activeProfile } = useProfile();
  const [kiosk, setKiosk] = useState(() => getKioskConfig());
  const [showUnlock, setShowUnlock] = useState(false);
  const [locationHash, setLocationHash] = useState(() => String(window.location.hash || ""));

  useEffect(() => {
    const onHash = () => setLocationHash(String(window.location.hash || ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const cleanupRecovery = installWakeLockRecovery();
    const apply = () => {
      const customer = locationHash.startsWith("#/kundendisplay");
      const settings = getScreenAwakeSettings();
      setScreenAwake(!customer && settings.register);
    };
    apply();
    window.addEventListener("kasse:screen-awake-updated", apply);
    return () => {
      window.removeEventListener("kasse:screen-awake-updated", apply);
      cleanupRecovery();
      setScreenAwake(false);
    };
  }, [locationHash]);

  useEffect(() => {
    const refresh = () => setKiosk(getKioskConfig());
    window.addEventListener("kasse:kiosk-updated", refresh);
    return () => window.removeEventListener("kasse:kiosk-updated", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkReset = async () => {
      try {
        if (getDataMode() !== "server") return;
        const res = await apiFetch("/api/admin/kiosk-reset-version");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && applyServerResetVersion(data.version)) setKiosk(getKioskConfig());
      } catch {}
    };
    checkReset();
    const timer = setInterval(checkReset, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const customerDisplay = locationHash.startsWith("#/kundendisplay");

  if (kiosk.locked && !customerDisplay) {
    return (
      <HashRouter>
        <div className={`${styles.app} ${styles.kioskApp}`}>
          <main className={styles.kioskMain}>
            <Kasse />
          </main>
          <button className={styles.kioskUnlockButton} onClick={() => setShowUnlock(true)} title="Kassenmodus entsperren">🔒</button>
          {showUnlock && (
            <UnlockDialog
              onClose={() => setShowUnlock(false)}
              onUnlocked={() => { setShowUnlock(false); setKiosk(getKioskConfig()); window.location.hash = "#/"; }}
            />
          )}
        </div>
      </HashRouter>
    );
  }

  return (
    <HashRouter>
      <div className={styles.app}>
        <div className={styles.portraitHint}>
          <span>🔄</span>
          Bitte das Tablet drehen
        </div>

        <nav className={styles.nav}>
          <div className={styles.logo}>🛒 {activeProfile?.name || "Kasse"}</div>
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ""}>🛒 Kasse</NavLink>
          <NavLink to="/karten" className={({ isActive }) => isActive ? styles.active : ""}>💳 Karten</NavLink>
          <NavLink to="/admin" className={({ isActive }) => isActive ? styles.active : ""}>📦 Artikel</NavLink>
          <NavLink to="/drucker" className={({ isActive }) => isActive ? styles.active : ""}>🧾 Drucker</NavLink>
          <NavLink to="/statistik" className={({ isActive }) => isActive ? styles.active : ""}>📊 Statistik</NavLink>
          <NavLink to="/einstellungen" className={({ isActive }) => isActive ? styles.active : ""}>⚙️ Einstellungen</NavLink>
          <NfcStatus />
        </nav>
        <main className={styles.main}>
          <Routes>
            <Route path="/" element={<Kasse />} />
            <Route path="/karten" element={<Karten />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/drucker" element={<Drucker />} />
            <Route path="/statistik" element={<Statistik />} />
            <Route path="/einstellungen" element={<Einstellungen />} />
            <Route path="/kundendisplay" element={<KundenDisplay />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default function App() {
  return (
    <NfcProvider>
      <CartProvider>
        <ProfileProvider>
          <CustomerDisplayBleProvider>
            <DrawerProvider>
              <AppShell />
            </DrawerProvider>
          </CustomerDisplayBleProvider>
        </ProfileProvider>
      </CartProvider>
    </NfcProvider>
  );
}
