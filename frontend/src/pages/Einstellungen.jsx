import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Einstellungen.module.css";
import {
  apiFetch,
  getApiBase,
  setApiBase,
  getCloudflareAccessConfig,
  setCloudflareAccessConfig,
  getDataMode,
  setDataMode,
  exportLocalData,
  importLocalData,
  resetLocalData,
} from "../lib/api";
import { DEFAULT_THEME } from "../lib/localDb";
import {
  THEME_PRESETS,
  applyAppearanceMode,
  getThemeChecks,
  getThemeRuntime,
  normalizeTheme,
} from "../lib/themePresets";
import { useProfile } from "../ProfileContext";
import { useCart } from "../CartContext";
import { useCustomerDisplayBle } from "../CustomerDisplayBleContext";
import { useDrawer } from "../DrawerContext";
import { getLocalDisplayServerInfo, startLocalDisplayServer } from "../lib/localDisplayServer";
import {
  configureKiosk,
  getKioskConfig,
  removeKioskConfig,
  setKioskLocked,
  setSeenResetVersion,
  verifyPin,
} from "../lib/kiosk";

const PAY_METHODS = [
  { id: "nfc", icon: "📡", label: "NFC", desc: "Web NFC direkt am Gerät" },
  { id: "qr", icon: "📷", label: "QR-Code", desc: "Kamera scannt den QR-Code" },
  { id: "bleNfc", icon: "🔵", label: "NFC-Box", desc: "Externe ESP32-Bluetooth-Box" },
  { id: "manual", icon: "✏️", label: "Name", desc: "Kundenname von Hand eingeben" },
  { id: "cash", icon: "💵", label: "Barzahlung", desc: "Bar kassieren und Rückgeld berechnen" },
];

const SIMPLE_THEME_FIELDS = [
  ["primaryColor", "Hauptfarbe"],
  ["accentColor", "Akzentfarbe"],
  ["pageBackground", "Seitenhintergrund"],
  ["registerBackground", "Kassenhintergrund"],
  ["bannerBackground", "Bannerfarbe"],
];

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
    reader.readAsDataURL(file);
  });
}

export default function Einstellungen() {
  const { profiles, activeProfile, refreshProfiles, switchProfile } = useProfile();
  const { cart, clearCart } = useCart();
  const displayBle = useCustomerDisplayBle();
  const drawer = useDrawer();
  const [enabled, setEnabled] = useState({ nfc: true, qr: true, bleNfc: true, manual: true, cash: true });
  const [defaultMode, setDefaultMode] = useState("nfc");
  const [cashBreakdownEnabled, setCashBreakdownEnabled] = useState(false);
  const [customerDisplayEnabled, setCustomerDisplayEnabled] = useState(false);
  const [customerDisplayType, setCustomerDisplayType] = useState("esp32");
  const [localDisplayServerUrl, setLocalDisplayServerUrl] = useState("");
  const [drawerEnabled, setDrawerEnabled] = useState(false);
  const [drawerOpenOnCash, setDrawerOpenOnCash] = useState(true);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [dataMode, setDataModeState] = useState(getDataMode());
  const initialAccess = getCloudflareAccessConfig();
  const [cfClientId, setCfClientId] = useState(initialAccess.clientId);
  const [cfClientSecret, setCfClientSecret] = useState(initialAccess.clientSecret);
  const [cfSecretHidden, setCfSecretHidden] = useState(Boolean(initialAccess.clientSecret));
  const [newProfileName, setNewProfileName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [theme, setTheme] = useState(() => normalizeTheme(DEFAULT_THEME));
  const msgTimerRef = useRef(null);
  const importFileRef = useRef(null);
  const bannerFileRef = useRef(null);
  const logoFileRef = useRef(null);
  const [kioskConfig, setKioskConfigState] = useState(() => getKioskConfig());
  const [kioskPin, setKioskPin] = useState("");
  const [kioskPinConfirm, setKioskPinConfirm] = useState("");
  const [kioskCurrentPin, setKioskCurrentPin] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const preview = useMemo(() => getThemeRuntime({ ...DEFAULT_THEME, ...theme }), [theme]);
  const contrastChecks = useMemo(() => getThemeChecks({ ...DEFAULT_THEME, ...theme }), [theme]);

  const showMsg = (text, type = "ok") => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setMsg({ text, type });
    msgTimerRef.current = setTimeout(() => setMsg({ text: "", type: "" }), 3800);
  };

  const updateTheme = (patch) => {
    setTheme((current) => normalizeTheme({ ...current, ...patch }));
  };

  const loadDrawerSettings = async () => {
    try {
      const res = await apiFetch("/api/settings/drawer");
      if (!res.ok) return;
      const data = await res.json();
      setDrawerEnabled(data.enabled === true);
      setDrawerOpenOnCash(data.openOnCash !== false);
    } catch {}
  };

  const loadPaymentSettings = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/settings/payment");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEnabled(data.enabled);
      setDefaultMode(data.default);
      setCashBreakdownEnabled(data.cashBreakdownEnabled === true);
      setCustomerDisplayEnabled(data.customerDisplayEnabled === true);
      setCustomerDisplayType(data.customerDisplayType === "device" ? "device" : "esp32");
      try { localStorage.setItem("kasseBleNfcEnabled", data.enabled?.bleNfc ? "1" : "0"); } catch {}
      window.dispatchEvent(new CustomEvent("kasse:payment-settings-updated", { detail: data }));
    } catch {
      showMsg("Einstellungen konnten nicht geladen werden", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeProfile) {
      setProfileName(activeProfile.name);
      setTheme(normalizeTheme({ ...DEFAULT_THEME, ...(activeProfile.theme || {}) }));
      loadPaymentSettings();
      loadDrawerSettings();
    }
  }, [activeProfile?.id]);

  useEffect(() => () => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
  }, []);

  useEffect(() => {
    const refresh = () => setKioskConfigState(getKioskConfig());
    window.addEventListener("kasse:kiosk-updated", refresh);
    return () => window.removeEventListener("kasse:kiosk-updated", refresh);
  }, []);

  const selectProfile = async (id) => {
    if (Number(id) === Number(activeProfile?.id)) return;
    if (cart.length && !confirm("Beim Profilwechsel wird der aktuelle Warenkorb geleert. Profil wechseln?")) return;
    clearCart();
    await switchProfile(Number(id));
    showMsg("Profil gewechselt ✓");
  };

  const createProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return showMsg("Bitte einen Profilnamen eingeben", "err");
    try {
      const res = await apiFetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, theme: normalizeTheme({ ...DEFAULT_THEME, bannerText: name }) }),
      });
      const data = await res.json();
      if (!res.ok) return showMsg(data.error || "Profil konnte nicht erstellt werden", "err");
      setNewProfileName("");
      await refreshProfiles();
      clearCart();
      await switchProfile(data.id);
      showMsg(`Profil „${data.name}“ erstellt ✓`);
    } catch {
      showMsg("Profil konnte nicht erstellt werden", "err");
    }
  };

  const saveProfile = async () => {
    if (!activeProfile) return;
    try {
      const cleanTheme = normalizeTheme(theme);
      const res = await apiFetch(`/api/profiles/${activeProfile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, theme: cleanTheme }),
      });
      const data = await res.json();
      if (!res.ok) return showMsg(data.error || "Profil konnte nicht gespeichert werden", "err");
      await refreshProfiles();
      window.dispatchEvent(new CustomEvent("kasse:profiles-updated"));
      showMsg("Profil und Design gespeichert ✓");
    } catch {
      showMsg("Profil konnte nicht gespeichert werden", "err");
    }
  };

  const setProfileActive = async (profile, active) => {
    if (!active && Number(profile.id) === Number(activeProfile?.id)
      && !confirm("Aktives Profil archivieren? Danach wird auf ein anderes Profil gewechselt.")) return;
    try {
      const res = await apiFetch(`/api/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (!res.ok) return showMsg(data.error || "Änderung fehlgeschlagen", "err");
      const rows = await refreshProfiles();
      if (!active && Number(profile.id) === Number(activeProfile?.id)) {
        const next = rows.find((item) => item.active && Number(item.id) !== Number(profile.id));
        if (next) {
          clearCart();
          await switchProfile(next.id);
        }
      }
      showMsg(active ? "Profil reaktiviert ✓" : "Profil archiviert ✓");
    } catch {
      showMsg("Änderung fehlgeschlagen", "err");
    }
  };

  const applyPreset = (preset) => {
    setTheme((current) => normalizeTheme({
      ...current,
      ...preset.theme,
      bannerText: current.bannerText,
      bannerImageDataUrl: current.bannerImageDataUrl,
      logoImageDataUrl: current.logoImageDataUrl,
    }));
    showMsg(`Vorlage „${preset.name}“ übernommen`);
  };

  const loadThemeImage = async (event, key, label) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await readImageFile(file);
      updateTheme({ [key]: data });
      showMsg(`${label} geladen ✓`);
    } catch {
      showMsg(`${label} konnte nicht geladen werden`, "err");
    } finally {
      event.target.value = "";
    }
  };

  const toggleMethod = (id) => setEnabled((previous) => {
    const next = { ...previous, [id]: !previous[id] };
    if (!next[id] && defaultMode === id) {
      const first = PAY_METHODS.map((method) => method.id).find((method) => next[method]);
      if (first) setDefaultMode(first);
    }
    return next;
  });

  const activeCount = Object.values(enabled).filter(Boolean).length;

  const saveDrawerSettings = async () => {
    try {
      const res = await apiFetch("/api/settings/drawer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: drawerEnabled, openOnCash: drawerOpenOnCash }),
      });
      const data = await res.json();
      if (!res.ok) return showMsg(data.error || "Kassenschublade konnte nicht gespeichert werden", "err");
      setDrawerEnabled(data.enabled === true);
      setDrawerOpenOnCash(data.openOnCash !== false);
      showMsg("Kassenschublade gespeichert ✓");
    } catch {
      showMsg("Kassenschublade konnte nicht gespeichert werden", "err");
    }
  };

  const savePayments = async () => {
    if (!activeCount || !enabled[defaultMode]) return showMsg("Mindestens eine aktive Methode mit aktivem Standard ist nötig", "err");
    try {
      const res = await apiFetch("/api/settings/payment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, default: defaultMode, cashBreakdownEnabled, customerDisplayEnabled, customerDisplayType }),
      });
      const data = await res.json();
      if (!res.ok) return showMsg(data.error || "Speichern fehlgeschlagen", "err");
      setEnabled(data.enabled);
      setDefaultMode(data.default);
      setCashBreakdownEnabled(data.cashBreakdownEnabled === true);
      setCustomerDisplayEnabled(data.customerDisplayEnabled === true);
      setCustomerDisplayType(data.customerDisplayType === "device" ? "device" : "esp32");
      window.dispatchEvent(new CustomEvent("kasse:payment-settings-updated", { detail: data }));
      showMsg("Zahlungsmethoden gespeichert ✓");
    } catch {
      showMsg("Speichern fehlgeschlagen", "err");
    }
  };

  const setupKioskPin = async () => {
    if (kioskPin !== kioskPinConfirm) return showMsg("Die beiden PINs stimmen nicht überein", "err");
    try {
      try {
        if (getDataMode() === "server") {
          const resetRes = await apiFetch("/api/admin/kiosk-reset-version");
          if (resetRes.ok) setSeenResetVersion((await resetRes.json()).version);
        }
      } catch {}
      const code = await configureKiosk(kioskPin);
      setRecoveryCode(code);
      setKioskPin("");
      setKioskPinConfirm("");
      setKioskConfigState(getKioskConfig());
      showMsg("Kassen-PIN eingerichtet ✓");
    } catch (e) {
      showMsg(e.message || "PIN konnte nicht eingerichtet werden", "err");
    }
  };

  const activateKiosk = () => {
    if (!getKioskConfig().configured) return showMsg("Bitte zuerst einen PIN einrichten", "err");
    setKioskLocked(true);
    window.location.hash = "#/";
  };

  const disableKiosk = async () => {
    if (!(await verifyPin(kioskCurrentPin))) return showMsg("PIN ist nicht korrekt", "err");
    removeKioskConfig();
    setKioskCurrentPin("");
    setRecoveryCode("");
    setKioskConfigState(getKioskConfig());
    showMsg("Kassenmodus und PIN entfernt ✓");
  };

  const changeKioskPin = async () => {
    if (!(await verifyPin(kioskCurrentPin))) return showMsg("Aktueller PIN ist nicht korrekt", "err");
    if (kioskPin !== kioskPinConfirm) return showMsg("Die beiden neuen PINs stimmen nicht überein", "err");
    try {
      const code = await configureKiosk(kioskPin);
      setRecoveryCode(code);
      setKioskPin("");
      setKioskPinConfirm("");
      setKioskCurrentPin("");
      setKioskConfigState(getKioskConfig());
      showMsg("PIN geändert – neuer Recovery-Code erstellt ✓");
    } catch (e) {
      showMsg(e.message || "PIN konnte nicht geändert werden", "err");
    }
  };

  const prepareLocalDeviceDisplay = async () => {
    try {
      const info = await startLocalDisplayServer();
      setLocalDisplayServerUrl(info?.url || "");
      if (info?.url) showMsg("Lokaler Display-Server gestartet ✓");
      else showMsg("Display-Server gestartet. Bitte WLAN/Hotspot-Verbindung prüfen.", "err");
    } catch {
      showMsg("Lokaler Display-Server konnte nicht gestartet werden", "err");
    }
  };

  const refreshLocalDisplayServerInfo = async () => {
    try {
      const info = await getLocalDisplayServerInfo();
      setLocalDisplayServerUrl(info?.url || "");
    } catch {}
  };

  const changeDataMode = async (mode) => {
    const next = setDataMode(mode);
    setDataModeState(next);
    await refreshProfiles().catch(() => {});
    showMsg(next === "local" ? "Lokaler Datenmodus aktiv" : "Servermodus aktiv");
  };

  const exportBackup = () => {
    try {
      const blob = new Blob([exportLocalData()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kasse-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showMsg("Backup exportiert ✓");
    } catch {
      showMsg("Backup konnte nicht exportiert werden", "err");
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      importLocalData(await file.text());
      await refreshProfiles();
      await loadPaymentSettings();
      showMsg("Backup importiert ✓");
    } catch {
      showMsg("Backup konnte nicht importiert werden", "err");
    } finally {
      event.target.value = "";
    }
  };

  const resetLocalBackup = async () => {
    if (!confirm("Lokale Daten wirklich zurücksetzen?")) return;
    resetLocalData();
    await refreshProfiles();
    await loadPaymentSettings();
    showMsg("Lokale Daten zurückgesetzt");
  };

  const saveCloudflareAccess = () => {
    setCloudflareAccessConfig({ clientId: cfClientId, clientSecret: cfClientSecret });
    setCfSecretHidden(Boolean(cfClientSecret));
    showMsg("Cloudflare-Daten gespeichert");
  };

  const testConnection = async () => {
    try {
      const res = await apiFetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      showMsg(`Verbindung funktioniert – ${data.profile?.name || "Profil"} ✓`);
    } catch (error) {
      showMsg(`Server nicht erreichbar: ${error.message || "Verbindungsfehler"}`, "err");
    }
  };

  const cfSecretDisplayValue = cfSecretHidden && cfClientSecret ? "••••••••••••••••" : cfClientSecret;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>⚙️ Einstellungen</h1>
        <p className={styles.intro}>Profilwechsel, Design, Zahlungsmethoden und Verbindungseinstellungen.</p>

        <h2 className={styles.sectionTitle}>🏪 Aktives Profil</h2>
        <div className={styles.serverBox}>
          <div className={styles.profileSwitchRow}>
            <label>
              Profil
              <select value={activeProfile?.id || ""} onChange={(event) => selectProfile(event.target.value)}>
                {profiles.filter((profile) => profile.active).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </label>
            <span>Der Profilwechsel ist nur hier möglich.</span>
          </div>
          <div className={styles.profileCreateRow}>
            <input
              value={newProfileName}
              onChange={(event) => setNewProfileName(event.target.value)}
              placeholder="Neues Profil, z.B. Nagelstudio"
            />
            <button onClick={createProfile}>+ Profil erstellen</button>
          </div>
          {profiles.some((profile) => !profile.active) && (
            <div className={styles.archiveList}>
              {profiles.filter((profile) => !profile.active).map((profile) => (
                <div key={profile.id}>
                  <span>{profile.name}</span>
                  <button className={styles.secondaryBtn} onClick={() => setProfileActive(profile, true)}>Reaktivieren</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {activeProfile && (
          <>
            <h2 className={styles.sectionTitle}>🎨 Profil und App-Design</h2>
            <div className={styles.serverBox}>
              <label className={styles.profileNameField}>
                Profilname
                <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </label>
              <label className={styles.profileNameField}>
                Bannertext
                <input
                  value={theme.bannerText || ""}
                  onChange={(event) => updateTheme({ bannerText: event.target.value })}
                  placeholder="Willkommen im Einkaufsladen"
                />
              </label>

              <h3 className={styles.subTitle}>Designvorlagen</h3>
              <p className={styles.helpText}>Eine Vorlage setzt nur Farben und Darstellungsmodus. Eigene Bilder und Texte bleiben erhalten.</p>
              <div className={styles.presetGrid}>
                {THEME_PRESETS.map((preset) => (
                  <button key={preset.id} className={styles.presetCard} onClick={() => applyPreset(preset)}>
                    <span className={styles.presetHeading}><b>{preset.icon} {preset.name}</b><small>{preset.description}</small></span>
                    <span className={styles.swatches}>
                      <i style={{ background: preset.theme.primaryColor }} />
                      <i style={{ background: preset.theme.accentColor }} />
                      <i style={{ background: preset.theme.pageBackground }} />
                    </span>
                  </button>
                ))}
              </div>

              <div className={styles.modeEditor}>
                <div>
                  <h3 className={styles.subTitle}>Darstellung</h3>
                  <p className={styles.helpText}>Hell eignet sich für die meisten Tablets. Dunkel ist für gedämpfte Umgebungen gedacht.</p>
                </div>
                <div className={styles.modeButtons}>
                  <button
                    className={theme.appearanceMode !== "dark" ? styles.modeButtonActive : ""}
                    onClick={() => setTheme(applyAppearanceMode(theme, "light"))}
                  >☀️ Hell</button>
                  <button
                    className={theme.appearanceMode === "dark" ? styles.modeButtonActive : ""}
                    onClick={() => setTheme(applyAppearanceMode(theme, "dark"))}
                  >🌙 Dunkel</button>
                </div>
              </div>

              <label className={styles.autoContrastRow}>
                <input
                  type="checkbox"
                  checked={theme.autoContrast !== false}
                  onChange={(event) => updateTheme({ autoContrast: event.target.checked })}
                />
                <span><strong>Farben automatisch lesbar halten</strong><small>Textfarben und dunkle Buttonfarbe werden automatisch berechnet.</small></span>
              </label>

              <div className={styles.colorGrid}>
                {SIMPLE_THEME_FIELDS.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <span>
                      <input
                        type="color"
                        value={theme[key] || DEFAULT_THEME[key]}
                        onChange={(event) => updateTheme({ [key]: event.target.value })}
                      />
                      <code>{theme[key]}</code>
                    </span>
                  </label>
                ))}
              </div>

              {theme.autoContrast === false && (
                <details className={styles.advancedColors}>
                  <summary>Erweiterte Textfarben</summary>
                  <div className={styles.colorGrid}>
                    <label>
                      Dunkle Hauptfarbe
                      <span><input type="color" value={theme.primaryDark} onChange={(event) => updateTheme({ primaryDark: event.target.value })} /><code>{theme.primaryDark}</code></span>
                    </label>
                    <label>
                      Banner-Textfarbe
                      <span><input type="color" value={theme.bannerTextColor} onChange={(event) => updateTheme({ bannerTextColor: event.target.value })} /><code>{theme.bannerTextColor}</code></span>
                    </label>
                  </div>
                </details>
              )}

              <div className={styles.imageEditor}>
                <div>
                  <h3 className={styles.subTitle}>Logo und Bannerbild</h3>
                  <p className={styles.helpText}>Das Logo wird links im Kassenbanner angezeigt. Ein ruhiges, breites Bannerbild funktioniert am besten.</p>
                </div>
                <div className={styles.serverActions}>
                  <button onClick={() => logoFileRef.current?.click()}>Logo wählen</button>
                  <button className={styles.secondaryBtn} onClick={() => updateTheme({ logoImageDataUrl: "" })}>Logo entfernen</button>
                  <button onClick={() => bannerFileRef.current?.click()}>Bannerbild wählen</button>
                  <button className={styles.secondaryBtn} onClick={() => updateTheme({ bannerImageDataUrl: "" })}>Banner entfernen</button>
                </div>
                <input ref={logoFileRef} type="file" accept="image/*" hidden onChange={(event) => loadThemeImage(event, "logoImageDataUrl", "Logo")} />
                <input ref={bannerFileRef} type="file" accept="image/*" hidden onChange={(event) => loadThemeImage(event, "bannerImageDataUrl", "Bannerbild")} />
              </div>

              <h3 className={styles.subTitle}>Live-Vorschau</h3>
              <div className={styles.appPreview} style={{ background: preview.pageBackground, color: preview.palette.gray800 }}>
                <div className={styles.previewNav} style={{ background: preview.primaryColor, color: preview.primaryText }}>
                  <b>🛒 KinderKasse</b>
                  <span style={{ background: preview.accentColor, color: preview.accentText }}>Kasse</span>
                  <span>Produkte</span>
                  <span>Einstellungen</span>
                </div>
                <div className={styles.previewRegister} style={{ background: preview.registerBackground }}>
                  <div
                    className={styles.bannerPreview}
                    style={{
                      backgroundColor: preview.bannerBackground,
                      color: theme.bannerImageDataUrl ? "#ffffff" : preview.bannerTextColor,
                      backgroundImage: theme.bannerImageDataUrl
                        ? `linear-gradient(rgba(0,0,0,.38),rgba(0,0,0,.38)),url(${theme.bannerImageDataUrl})`
                        : "none",
                    }}
                  >
                    {theme.logoImageDataUrl && <img src={theme.logoImageDataUrl} alt="Profil-Logo" />}
                    <span><strong>{profileName || activeProfile.name}</strong><small>{theme.bannerText}</small></span>
                  </div>
                  <div className={styles.previewContent}>
                    <div className={styles.previewProducts}>
                      {["Nagellack", "Maniküre", "Pflege"].map((item, index) => (
                        <div key={item} style={{ background: preview.surface, color: preview.palette.gray800 }}>
                          <b>{["💅", "✨", "🧴"][index]}</b><span>{item}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.previewCart} style={{ background: preview.surface, color: preview.palette.gray800 }}>
                      <strong>Warenkorb</strong><span>Maniküre · 25.00 CHF</span>
                      <button style={{ background: preview.primaryColor, color: preview.primaryText }}>Bezahlen</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.contrastGrid}>
                {contrastChecks.map((check) => {
                  const passed = check.ratio >= 4.5;
                  return (
                    <div key={check.id} className={passed ? styles.contrastOk : styles.contrastWarn}>
                      <span>{passed ? "✓" : "!"}</span>
                      <div><strong>{check.label}</strong><small>Kontrast {check.ratio.toFixed(1)}:1</small></div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.serverActions}>
                <button onClick={saveProfile}>Profil und Design speichern</button>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => setTheme(normalizeTheme({ ...DEFAULT_THEME, bannerText: profileName || activeProfile.name }))}
                >Standardfarben</button>
                {profiles.filter((profile) => profile.active).length > 1 && (
                  <button className={styles.dangerBtn} onClick={() => setProfileActive(activeProfile, false)}>Profil archivieren</button>
                )}
              </div>
            </div>
          </>
        )}

        <div className={styles.settingsDivider} />
        <h2 className={styles.sectionTitle}>💳 Zahlungsmethoden dieses Profils</h2>
        <div className={styles.methodList}>
          {PAY_METHODS.map((method) => (
            <div key={method.id} className={`${styles.methodRow} ${enabled[method.id] ? "" : styles.methodOff}`}>
              <div className={styles.methodIcon}>{method.icon}</div>
              <div className={styles.methodInfo}>
                <div className={styles.methodLabel}>{method.label}</div>
                <div className={styles.methodDesc}>{method.desc}</div>
              </div>
              <div className={styles.methodControls}>
                <button
                  className={`${styles.defaultBtn} ${defaultMode === method.id ? styles.defaultActive : ""}`}
                  onClick={() => enabled[method.id] && setDefaultMode(method.id)}
                  disabled={!enabled[method.id]}
                >{defaultMode === method.id ? "★ Standard" : "Standard"}</button>
                <button className={`${styles.toggle} ${enabled[method.id] ? styles.toggleOn : styles.toggleOff}`} onClick={() => toggleMethod(method.id)}>
                  <span className={styles.toggleKnob} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.serverBox}>
          <h2>💵 Barzahlung</h2>
          <p>Die Rückgeld-Stückelung ist optional und wird nur angezeigt, wenn sie hier aktiviert ist.</p>
          <div className={styles.methodRow}>
            <div className={styles.methodIcon}>🪙</div>
            <div className={styles.methodInfo}>
              <div className={styles.methodLabel}>Rückgeld-Stückelung anzeigen</div>
              <div className={styles.methodDesc}>Vorschlag mit Schweizer Noten und Münzen, z. B. 20 + 10 + 1 + 0.50.</div>
            </div>
            <button className={`${styles.toggle} ${cashBreakdownEnabled ? styles.toggleOn : styles.toggleOff}`} onClick={() => setCashBreakdownEnabled((v) => !v)}>
              <span className={styles.toggleKnob} />
            </button>
          </div>
        </div>

        <div className={styles.serverBox}>
          <h2>🗄️ Kassenschublade</h2>
          <p>Optional. Wenn deaktiviert, verhält sich KinderKasse exakt wie bisher.</p>
          <div className={styles.methodRow}>
            <div className={styles.methodIcon}>🗄️</div>
            <div className={styles.methodInfo}>
              <div className={styles.methodLabel}>Kassenschublade aktivieren</div>
              <div className={styles.methodDesc}>ESP32-C3 als <code>KasseDrawer</code>. Servermodus über WLAN/Cloudflare, lokaler APK-Modus über BLE.</div>
            </div>
            <button className={`${styles.toggle} ${drawerEnabled ? styles.toggleOn : styles.toggleOff}`} onClick={() => setDrawerEnabled((v) => !v)}>
              <span className={styles.toggleKnob} />
            </button>
          </div>
          <div className={styles.methodRow}>
            <div className={styles.methodIcon}>💵</div>
            <div className={styles.methodInfo}>
              <div className={styles.methodLabel}>Nach erfolgreicher Barzahlung öffnen</div>
              <div className={styles.methodDesc}>Der Servo öffnet erst, nachdem der Verkauf gespeichert wurde.</div>
            </div>
            <button className={`${styles.toggle} ${drawerOpenOnCash ? styles.toggleOn : styles.toggleOff}`} onClick={() => setDrawerOpenOnCash((v) => !v)}>
              <span className={styles.toggleKnob} />
            </button>
          </div>
          {dataMode === "local" && drawer.supported && drawerEnabled && (
            <div className={styles.serverActions}>
              <button onClick={() => drawer.connect(true)} disabled={drawer.status === "connecting"}>
                {drawer.status === "connected" ? "✅ Kassenschublade verbunden" : drawer.status === "connecting" ? "Suche KasseDrawer …" : "🗄️ Kassenschublade per BLE verbinden"}
              </button>
              {drawer.status === "connected" && <button className={styles.secondaryBtn} onClick={() => drawer.open()}>Test öffnen</button>}
            </div>
          )}
          <div className={styles.serverActions}>
            <button onClick={saveDrawerSettings}>Kassenschublade speichern</button>
          </div>
        </div>

        <div className={styles.serverBox}>
          <h2>🖥️ Kundenanzeige</h2>
          <p>Wähle, ob ein kompaktes ESP32-Display oder ein zweites Handy/Tablet als Kundenanzeige verwendet wird.</p>

          <div className={styles.displayTypeGrid}>
            <button
              className={`${styles.displayTypeCard} ${customerDisplayType === "esp32" ? styles.displayTypeActive : ""}`}
              onClick={() => setCustomerDisplayType("esp32")}
            >
              <strong>📟 ESP32 Display-Box</strong>
              <span>Servermodus: WLAN/Cloudflare · Lokaler APK-Modus: BLE</span>
            </button>
            <button
              className={`${styles.displayTypeCard} ${customerDisplayType === "device" ? styles.displayTypeActive : ""}`}
              onClick={() => setCustomerDisplayType("device")}
            >
              <strong>📱 Zweites Gerät</strong>
              <span>Servermodus: Docker-Webanzeige · Lokaler APK-Modus: LAN/Hotspot</span>
            </button>
          </div>

          <div className={styles.methodRow}>
            <div className={styles.methodIcon}>📺</div>
            <div className={styles.methodInfo}>
              <div className={styles.methodLabel}>Kundenanzeige aktivieren</div>
              <div className={styles.methodDesc}>Überträgt Warenkorb, Total, Zahlungsart, Rückgeld und das aktive Profil.</div>
            </div>
            <button className={`${styles.toggle} ${customerDisplayEnabled ? styles.toggleOn : styles.toggleOff}`} onClick={() => setCustomerDisplayEnabled((v) => !v)}>
              <span className={styles.toggleKnob} />
            </button>
          </div>

          {customerDisplayType === "esp32" && (
            <>
              <p><strong>ESP32:</strong> Im Docker-/Servermodus liest die Box automatisch <code>/api/customer-display</code> per WLAN. Im lokalen APK-Modus wird sie per BLE als <code>KasseDisplay</code> verbunden.</p>
              {displayBle.supported && (
                <div className={styles.serverActions}>
                  <button onClick={() => displayBle.connect(true)} disabled={displayBle.status === "connecting"}>
                    {displayBle.status === "connected" ? "✅ BLE-Display verbunden" : displayBle.status === "connecting" ? "Suche BLE-Display …" : "📟 ESP32 per BLE verbinden"}
                  </button>
                </div>
              )}
            </>
          )}

          {customerDisplayType === "device" && (
            <>
              {dataMode === "server" ? (
                <>
                  <p><strong>Zweites Gerät über Docker:</strong> Dort dieselbe KinderKasse öffnen, Server verbinden und <code>#/kundendisplay</code> aufrufen.</p>
                  <div className={styles.serverActions}>
                    <button className={styles.secondaryBtn} onClick={() => window.open(`${window.location.origin}${window.location.pathname}#/kundendisplay`, "_blank")}>Kundenanzeige auf diesem Gerät öffnen</button>
                  </div>
                </>
              ) : (
                <>
                  <p><strong>Zweites Gerät ohne Docker:</strong> Beide Geräte müssen im selben WLAN sein. Alternativ kann das Kassen-Tablet einen Hotspot bereitstellen. Die Kassen-APK stellt dann einen kleinen lokalen Display-Server bereit.</p>
                  <div className={styles.serverActions}>
                    <button onClick={prepareLocalDeviceDisplay}>Lokalen Display-Server starten</button>
                    <button className={styles.secondaryBtn} onClick={refreshLocalDisplayServerInfo}>Adresse aktualisieren</button>
                  </div>
                  {localDisplayServerUrl && (
                    <div className={styles.localDisplayUrl}>
                      <span>Diese Adresse am zweiten Gerät verwenden:</span>
                      <code>{localDisplayServerUrl}</code>
                      <button className={styles.secondaryBtn} onClick={() => navigator.clipboard?.writeText(localDisplayServerUrl)}>Kopieren</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className={styles.serverActions}>
            <button className={styles.secondaryBtn} onClick={() => { window.location.hash = "#/kundendisplay"; }}>
              📱 Dieses Gerät als Kundendisplay starten
            </button>
          </div>
        </div>

        <button className={styles.saveBtn} onClick={savePayments} disabled={!activeCount || loading}>Zahlungsmethoden speichern</button>

        <div className={styles.settingsDivider} />
        <h2 className={styles.sectionTitle}>🔐 Kassenmodus dieses Geräts</h2>
        <div className={styles.serverBox}>
          <h2>Nur die Kassenansicht anzeigen</h2>
          <p>Der Kassenmodus gilt nur für dieses Tablet bzw. diesen Browser. Profile, Artikel, Karten, Drucker, Statistik und Einstellungen werden ausgeblendet. Zum Verlassen ist der PIN nötig.</p>

          {!kioskConfig.configured ? (
            <div className={styles.kioskSetup}>
              <label>Neuer PIN
                <input type="password" inputMode="numeric" maxLength={8} value={kioskPin} onChange={(e) => setKioskPin(e.target.value.replace(/\D/g, ""))} placeholder="4–8 Ziffern" />
              </label>
              <label>PIN wiederholen
                <input type="password" inputMode="numeric" maxLength={8} value={kioskPinConfirm} onChange={(e) => setKioskPinConfirm(e.target.value.replace(/\D/g, ""))} placeholder="PIN wiederholen" />
              </label>
              <button onClick={setupKioskPin}>PIN einrichten</button>
            </div>
          ) : (
            <>
              <div className={styles.kioskStatus}>✅ PIN eingerichtet</div>
              <div className={styles.serverActions}>
                <button onClick={activateKiosk}>🔒 Kassenmodus jetzt aktivieren</button>
              </div>
              <details className={styles.advancedColors}>
                <summary>PIN ändern oder Kassenmodus entfernen</summary>
                <div className={styles.kioskSetup}>
                  <label>Aktueller PIN
                    <input type="password" inputMode="numeric" maxLength={8} value={kioskCurrentPin} onChange={(e) => setKioskCurrentPin(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <label>Neuer PIN
                    <input type="password" inputMode="numeric" maxLength={8} value={kioskPin} onChange={(e) => setKioskPin(e.target.value.replace(/\D/g, ""))} placeholder="4–8 Ziffern" />
                  </label>
                  <label>Neuen PIN wiederholen
                    <input type="password" inputMode="numeric" maxLength={8} value={kioskPinConfirm} onChange={(e) => setKioskPinConfirm(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <div className={styles.serverActions}>
                    <button onClick={changeKioskPin}>PIN ändern</button>
                    <button className={styles.dangerBtn} onClick={disableKiosk}>PIN und Kassenmodus entfernen</button>
                  </div>
                </div>
              </details>
            </>
          )}

          {recoveryCode && (
            <div className={styles.recoveryBox}>
              <strong>⚠️ Recovery-Code jetzt sichern</strong>
              <code>{recoveryCode}</code>
              <p>Der Code wird aus Sicherheitsgründen nur jetzt angezeigt. Damit kann auf dem Sperrbildschirm ein neuer PIN gesetzt werden.</p>
              <button className={styles.secondaryBtn} onClick={() => navigator.clipboard?.writeText(recoveryCode)}>Code kopieren</button>
            </div>
          )}

          <div className={styles.kioskDockerHint}>
            <strong>Docker-Notfallreset:</strong>
            <span>Falls PIN und Recovery-Code verloren sind, kann der Kassenmodus vom Docker-Host zurückgesetzt werden. Der genaue Befehl steht in <code>README-KASSENMODUS.md</code>. Der Reset entsperrt alle Kassenmodus-Geräte, die mit diesem Docker-Server verbunden sind. Dabei werden keine Profile, Kunden, Guthaben oder Verkäufe gelöscht.</span>
          </div>
        </div>

        <div className={styles.settingsDivider} />
        <h2 className={styles.sectionTitle}>💾 Daten speichern</h2>
        <div className={styles.serverBox}>
          <h2>{dataMode === "local" ? "📱 Lokal auf diesem Tablet" : "🌐 Server / Docker"}</h2>
          <p>Auch im Lokalmodus sind Profile, Produkte, Bons und Guthaben getrennt.</p>
          <div className={styles.modeChoice}>
            <button className={`${styles.modeChoiceBtn} ${dataMode === "local" ? styles.modeChoiceActive : ""}`} onClick={() => changeDataMode("local")}>📱 Lokal speichern<span>offline ohne Server</span></button>
            <button className={`${styles.modeChoiceBtn} ${dataMode === "server" ? styles.modeChoiceActive : ""}`} onClick={() => changeDataMode("server")}>🌐 Server verwenden<span>Docker/NAS/Cloudflare</span></button>
          </div>
          {dataMode === "local" && (
            <div className={styles.localTools}>
              <div className={styles.serverActions}>
                <button onClick={exportBackup}>Backup exportieren</button>
                <button className={styles.secondaryBtn} onClick={() => importFileRef.current?.click()}>Backup importieren</button>
                <button className={styles.dangerBtn} onClick={resetLocalBackup}>Lokal zurücksetzen</button>
              </div>
              <input ref={importFileRef} type="file" accept="application/json,.json" hidden onChange={importBackup} />
            </div>
          )}
        </div>

        {dataMode === "server" && (
          <>
            <div className={styles.settingsDivider} />
            <h2 className={styles.sectionTitle}>🔧 Server</h2>
            <div className={styles.serverBox}>
              <h2>🔗 Server-Verbindung</h2>
              <div className={styles.serverRow}>
                <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://kasse.example.ch oder http://192.168.1.50:3800" />
                <button onClick={() => { setApiBase(serverUrl); showMsg("Server-Adresse gespeichert"); }}>Speichern</button>
                <button onClick={testConnection}>Test</button>
              </div>
            </div>
            <div className={styles.serverBox}>
              <h2>☁️ Cloudflare Access</h2>
              <div className={styles.tokenGrid}>
                <label>Client ID<input value={cfClientId} onChange={(event) => setCfClientId(event.target.value)} /></label>
                <label>Client Secret<input value={cfSecretDisplayValue} onFocus={() => { if (cfSecretHidden) { setCfClientSecret(""); setCfSecretHidden(false); } }} onChange={(event) => setCfClientSecret(event.target.value)} type="text" /></label>
              </div>
              <div className={styles.serverActions}>
                <button onClick={saveCloudflareAccess}>Cloudflare-Daten speichern</button>
                <button className={styles.secondaryBtn} onClick={() => { setCfClientId(""); setCfClientSecret(""); setCfSecretHidden(false); setCloudflareAccessConfig({}); }}>Löschen</button>
              </div>
            </div>
          </>
        )}

        {msg.text && <div className={`${styles.msg} ${msg.type === "err" ? styles.msgErr : styles.msgOk}`}>{msg.text}</div>}
      </div>
    </div>
  );
}
