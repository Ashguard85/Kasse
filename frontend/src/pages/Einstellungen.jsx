import React, { useState, useEffect, useRef } from "react";
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

// Anzeige-Infos für die vier Zahlungsmethoden
const PAY_METHODS = [
  { id: "nfc", icon: "📡", label: "NFC", desc: "Web NFC direkt am Gerät (nur Geräte mit eingebautem NFC)" },
  { id: "qr", icon: "📷", label: "QR-Code", desc: "Kamera scannt den QR-Code der Karte" },
  { id: "bleNfc", icon: "🔵", label: "NFC-Box", desc: "Externe ESP32-Bluetooth-Box (für Geräte ohne NFC)" },
  { id: "manual", icon: "✏️", label: "Name", desc: "Kundenname von Hand eintippen" },
];

export default function Einstellungen() {
  const [enabled, setEnabled] = useState({ nfc: true, qr: true, bleNfc: true, manual: true });
  const [defaultMode, setDefaultMode] = useState("nfc");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [dataMode, setDataModeState] = useState(getDataMode());
  const initialAccessConfig = getCloudflareAccessConfig();
  const [cfClientId, setCfClientId] = useState(initialAccessConfig.clientId);
  const [cfClientSecret, setCfClientSecret] = useState(initialAccessConfig.clientSecret);
  const [cfSecretHidden, setCfSecretHidden] = useState(Boolean(initialAccessConfig.clientSecret));
  const msgTimerRef = useRef(null);
  const importFileRef = useRef(null);

  const showMsg = (text, type = "ok") => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setMsg({ text, type });
    msgTimerRef.current = setTimeout(() => setMsg({ text: "", type: "" }), 3500);
  };

  const loadPaymentSettings = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/settings/payment`);
      if (!res.ok) throw new Error("Datenfehler");
      const data = await res.json();
      setEnabled(data.enabled);
      setDefaultMode(data.default);
      try { localStorage.setItem("kasseBleNfcEnabled", data.enabled?.bleNfc ? "1" : "0"); } catch {}
      window.dispatchEvent(new CustomEvent("kasse:payment-settings-updated", { detail: data }));
    } catch (e) {
      showMsg(dataMode === "local" ? "Lokale Einstellungen konnten nicht geladen werden" : "Einstellungen konnten nicht geladen werden", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPaymentSettings();
    return () => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current); };
    // bewusst nur beim ersten Mount; beim Wechsel des Datenmodus laden wir manuell neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMethod = (id) => {
    setEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      // Wenn die gerade deaktivierte Methode der Standard war, Standard auf
      // die erste noch aktive Methode verschieben.
      if (!next[id] && defaultMode === id) {
        const firstActive = PAY_METHODS.map((m) => m.id).find((m) => next[m]);
        if (firstActive) setDefaultMode(firstActive);
      }
      return next;
    });
  };

  const activeCount = Object.values(enabled).filter(Boolean).length;

  const changeDataMode = async (mode) => {
    const next = setDataMode(mode);
    setDataModeState(next);
    showMsg(next === "local" ? "Lokaler Datenmodus aktiv – kein Server nötig." : "Servermodus aktiv – Docker/Cloudflare wird verwendet.");
    window.setTimeout(loadPaymentSettings, 50);
  };

  const exportBackup = () => {
    try {
      const json = exportLocalData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `kasse-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showMsg("Backup exportiert ✓");
    } catch (e) {
      showMsg("Backup konnte nicht exportiert werden", "err");
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importLocalData(text);
      await loadPaymentSettings();
      showMsg("Backup importiert ✓");
    } catch (e) {
      showMsg("Backup konnte nicht importiert werden", "err");
    } finally {
      if (event.target) event.target.value = "";
    }
  };

  const resetLocalBackup = async () => {
    if (!confirm("Lokale Daten wirklich zurücksetzen? Kunden, Guthaben und Verkäufe auf diesem Tablet gehen verloren.")) return;
    resetLocalData();
    await loadPaymentSettings();
    showMsg("Lokale Daten zurückgesetzt");
  };

  const saveServerUrl = () => {
    setApiBase(serverUrl);
    showMsg("Server-Adresse gespeichert.");
  };

  const saveCloudflareAccess = () => {
    setCloudflareAccessConfig({ clientId: cfClientId, clientSecret: cfClientSecret });
    setCfSecretHidden(Boolean(cfClientSecret));
    showMsg("Cloudflare-Access-Daten gespeichert.");
  };

  const clearCloudflareAccess = () => {
    setCfClientId("");
    setCfClientSecret("");
    setCfSecretHidden(false);
    setCloudflareAccessConfig({ clientId: "", clientSecret: "" });
    showMsg("Cloudflare-Access-Daten gelöscht.");
  };

  const testConnection = async () => {
    try {
      const res = await apiFetch(`/api/articles`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showMsg("Server-Verbindung funktioniert ✓");
    } catch (e) {
      showMsg(`Server nicht erreichbar: ${e.message || "Verbindungsfehler"}`, "err");
    }
  };

  const save = async () => {
    if (activeCount === 0) {
      return showMsg("Mindestens eine Methode muss aktiv sein", "err");
    }
    if (!enabled[defaultMode]) {
      return showMsg("Die Standard-Methode muss aktiviert sein", "err");
    }
    try {
      const res = await apiFetch(`/api/settings/payment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, default: defaultMode }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnabled(data.enabled);
        setDefaultMode(data.default);
        try { localStorage.setItem("kasseBleNfcEnabled", data.enabled?.bleNfc ? "1" : "0"); } catch {}
        window.dispatchEvent(new CustomEvent("kasse:payment-settings-updated", { detail: data }));
        showMsg("Einstellungen gespeichert ✓");
      } else {
        showMsg(data.error || "Speichern fehlgeschlagen", "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  const cfSecretDisplayValue = cfSecretHidden && cfClientSecret ? "••••••••••••••••" : cfClientSecret;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>⚙️ Einstellungen</h1>
        <p className={styles.intro}>
          Lege fest, welche Zahlungsmethoden angezeigt werden und ob die App lokal auf dem Tablet oder mit deinem Kassenserver arbeitet.
        </p>

        <h2 className={styles.sectionTitle}>💳 Zahlungsmethoden</h2>
        <div className={styles.methodList}>
          {PAY_METHODS.map((m) => (
            <div key={m.id} className={`${styles.methodRow} ${enabled[m.id] ? "" : styles.methodOff}`}>
              <div className={styles.methodIcon}>{m.icon}</div>
              <div className={styles.methodInfo}>
                <div className={styles.methodLabel}>{m.label}</div>
                <div className={styles.methodDesc}>{m.desc}</div>
              </div>
              <div className={styles.methodControls}>
                <button
                  className={`${styles.defaultBtn} ${defaultMode === m.id ? styles.defaultActive : ""}`}
                  onClick={() => enabled[m.id] && setDefaultMode(m.id)}
                  disabled={!enabled[m.id]}
                  title="Als Standard setzen"
                >
                  {defaultMode === m.id ? "★ Standard" : "Standard"}
                </button>
                <button
                  className={`${styles.toggle} ${enabled[m.id] ? styles.toggleOn : styles.toggleOff}`}
                  onClick={() => toggleMethod(m.id)}
                  title={enabled[m.id] ? "Deaktivieren" : "Aktivieren"}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {activeCount === 0 && (
          <p className={styles.warn}>⚠️ Mindestens eine Methode muss aktiv sein.</p>
        )}

        <button className={styles.saveBtn} onClick={save} disabled={activeCount === 0 || loading}>
          Zahlungsmethoden speichern
        </button>

        <div className={styles.settingsDivider} />

        <h2 className={styles.sectionTitle}>💾 Daten speichern</h2>
        <div className={styles.serverBox}>
          <h2>{dataMode === "local" ? "📱 Lokal auf diesem Tablet" : "🌐 Server / Docker"}</h2>
          <p>
            Im Lokalmodus laufen Kasse, Karten und Artikel ohne Docker-Server direkt auf dem Tablet. Im Servermodus nutzt die App dein Docker-Backend.
          </p>
          <div className={styles.modeChoice}>
            <button
              type="button"
              className={`${styles.modeChoiceBtn} ${dataMode === "local" ? styles.modeChoiceActive : ""}`}
              onClick={() => changeDataMode("local")}
            >
              📱 Lokal speichern
              <span>funktioniert offline und ohne Server</span>
            </button>
            <button
              type="button"
              className={`${styles.modeChoiceBtn} ${dataMode === "server" ? styles.modeChoiceActive : ""}`}
              onClick={() => changeDataMode("server")}
            >
              🌐 Server verwenden
              <span>Docker/NAS/Cloudflare nutzen</span>
            </button>
          </div>

          {dataMode === "local" && (
            <div className={styles.localTools}>
              <p><b>Backup:</b> Deine lokalen Daten liegen auf diesem Tablet. Exportiere ab und zu eine Sicherung.</p>
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

            <h2 className={styles.sectionTitle}>🔧 Server-Stammdaten</h2>

        <div className={styles.serverBox}>
          <h2>🔗 Server-Verbindung</h2>
          <p>
            Adresse deiner Kasse, z.B. <b>https://deine-domain</b> oder <b>http://192.168.1.50:3800</b>. Im Docker-Browserbetrieb kann das Feld leer bleiben, wenn die Webapp über denselben Server läuft.
          </p>
          <div className={styles.serverRow}>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="Server-Adresse, z.B. https://kasse.example.ch"
            />
            <button onClick={saveServerUrl}>Speichern</button>
            <button className={styles.testBtn} onClick={testConnection}>Test</button>
          </div>
        </div>

        <div className={styles.serverBox}>
          <h2>☁️ Cloudflare Access</h2>
          <p>
            Nur nötig, wenn deine Kasse über einen Cloudflare-Tunnel mit Access geschützt ist. Die App sendet diese Werte als Header mit.
            In Cloudflare muss dafür eine <b>Service-Token/Service-Auth</b>-Regel für die Anwendung erlaubt sein.
          </p>
          <div className={styles.tokenGrid}>
            <label>
              Client ID
              <input
                value={cfClientId}
                onChange={(e) => setCfClientId(e.target.value)}
                placeholder="xxxxx.access"
                autoComplete="off"
                spellCheck="false"
              />
            </label>
            <label>
              Client Secret
              <input
                value={cfSecretDisplayValue}
                onFocus={() => {
                  if (cfSecretHidden) {
                    setCfClientSecret("");
                    setCfSecretHidden(false);
                  }
                }}
                onChange={(e) => {
                  setCfSecretHidden(false);
                  setCfClientSecret(e.target.value);
                }}
                placeholder={cfSecretHidden ? "Gespeichert – zum Ändern antippen" : "Client Secret sichtbar eingeben"}
                type="text"
                autoComplete="off"
                spellCheck="false"
              />
            </label>
          </div>
          <p className={styles.secretHint}>
            Das Secret bleibt beim Eingeben sichtbar. Nach dem Speichern wird es in diesem Feld durch Sterne ersetzt.
          </p>
          <div className={styles.serverActions}>
            <button onClick={saveCloudflareAccess}>Cloudflare-Daten speichern</button>
            <button className={styles.secondaryBtn} onClick={clearCloudflareAccess}>Löschen</button>
          </div>
          <p className={styles.smallWarn}>
            Hinweis: Diese Daten liegen auf dem Tablet. Für ein Kindergerät ist das praktisch, aber nicht hochsicher.
          </p>
        </div>

          </>
        )}

        {msg.text && (
          <div className={`${styles.msg} ${msg.type === "err" ? styles.msgErr : styles.msgOk}`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
