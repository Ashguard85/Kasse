import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, getDataMode } from "../lib/api";
import { useProfile } from "../ProfileContext";
import styles from "./KundenDisplay.module.css";

const LOCAL_SOURCE_KEY = "kasseCustomerDisplayLocalSource";

function priceStr(n) {
  return Number(n || 0).toFixed(2) + " CHF";
}

const PAY_LABELS = {
  nfc: "NFC",
  qr: "QR-Code",
  bleNfc: "NFC-Box",
  manual: "Kundenguthaben",
  cash: "Barzahlung",
};

function getSavedLocalSource() {
  try { return localStorage.getItem(LOCAL_SOURCE_KEY) || ""; } catch { return ""; }
}
function saveLocalSource(value) {
  const clean = String(value || "").trim().replace(/\/$/, "");
  try {
    if (clean) localStorage.setItem(LOCAL_SOURCE_KEY, clean);
    else localStorage.removeItem(LOCAL_SOURCE_KEY);
  } catch {}
  return clean;
}
function normalizeSource(value) {
  const clean = String(value || "").trim().replace(/\/$/, "");
  if (!clean) return "";
  if (/\/state$/i.test(clean)) return clean;
  return `${clean}/state`;
}

export default function KundenDisplay() {
  const { activeProfile } = useProfile();
  const [state, setState] = useState({ status: "shop", items: [], total: 0 });
  const [connection, setConnection] = useState("loading");
  const [localSource, setLocalSource] = useState(() => getSavedLocalSource());
  const [localSourceDraft, setLocalSourceDraft] = useState(() => getSavedLocalSource());
  const [pinEntry, setPinEntry] = useState("");
  const [pinSending, setPinSending] = useState(false);
  const itemsRef = useRef(null);
  const previousItemSignatureRef = useRef("");

  const localMode = getDataMode() === "local";

  useEffect(() => {
    let stopped = false;
    let timer;

    const poll = async () => {
      try {
        let res;
        if (getDataMode() === "local") {
          const source = normalizeSource(localSource);
          if (!source) {
            if (!stopped) setConnection("setup");
            return;
          }
          res = await fetch(source, { cache: "no-store" });
        } else {
          res = await apiFetch("/api/customer-display");
        }

        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!stopped) {
          setState(data);
          setConnection("ok");
        }
      } catch {
        if (!stopped) setConnection("error");
      } finally {
        if (!stopped) timer = setTimeout(poll, 650);
      }
    };

    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [activeProfile?.id, localSource]);

  const liveProfile = state?.profile || {};
  const theme = useMemo(
    () => ({ ...(activeProfile?.theme || {}), ...(liveProfile?.theme || {}) }),
    [activeProfile?.theme, liveProfile?.theme]
  );
  const profileName = liveProfile?.name || activeProfile?.name || "KinderKasse";
  const items = Array.isArray(state.items) ? state.items : [];
  const cash = state.paymentMode === "cash";

  useEffect(() => {
    const signature = items.map((item) => `${item.name}|${item.qty}|${item.price}`).join(";");
    const changed = signature !== previousItemSignatureRef.current;
    previousItemSignatureRef.current = signature;
    if (!changed || !items.length || !itemsRef.current) return;

    requestAnimationFrame(() => {
      const box = itemsRef.current;
      box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
      const last = box.lastElementChild;
      if (last) {
        last.classList.remove(styles.itemFresh);
        // Reflow ensures repeated quantity changes re-trigger the highlight.
        void last.offsetWidth;
        last.classList.add(styles.itemFresh);
      }
    });
  }, [items]);

  useEffect(() => {
    if (state.status === "pin") setPinEntry("");
  }, [state.status, state?.pinRequest?.invalid]);

  const sendTerminalInput = async (payload) => {
    if (pinSending) return;
    setPinSending(true);
    try {
      if (getDataMode() === "local") {
        const source = normalizeSource(localSource);
        if (!source) return;
        const base = source.replace(/\/state$/i, "");
        const res = await fetch(`${base}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await apiFetch("/api/customer-display/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      }
    } finally {
      setPinSending(false);
    }
  };

  const submitPin = async () => {
    if (!/^\d{4,8}$/.test(pinEntry)) return;
    await sendTerminalInput({ pin: pinEntry });
    setPinEntry("");
  };

  const saveSource = () => {
    const clean = saveLocalSource(localSourceDraft);
    setLocalSource(clean);
    setConnection(clean ? "loading" : "setup");
  };

  return (
    <div className={styles.screen}>
      <header
        className={styles.header}
        style={{
          backgroundColor: theme.bannerBackground || "var(--green)",
          backgroundImage: theme.bannerImageDataUrl ? `linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url(${theme.bannerImageDataUrl})` : undefined,
          color: theme.bannerTextColor || "#fff",
        }}
      >
        {theme.logoImageDataUrl && <img src={theme.logoImageDataUrl} className={styles.logo} alt="" />}
        <div>
          <h1>{profileName}</h1>
          <p>{theme.bannerText || "Willkommen!"}</p>
        </div>
      </header>

      {localMode && connection === "setup" ? (
        <div className={styles.setupPanel}>
          <div className={styles.setupIcon}>📱</div>
          <h2>Lokales Kundendisplay verbinden</h2>
          <p>Gib die Adresse ein, die auf dem Kassen-Tablet unter <strong>Einstellungen → Kundenanzeige</strong> angezeigt wird.</p>
          <input
            value={localSourceDraft}
            onChange={(e) => setLocalSourceDraft(e.target.value)}
            placeholder="http://192.168.43.1:3890"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button onClick={saveSource}>Verbinden</button>
          <small>Beide Geräte müssen im selben WLAN sein. Alternativ kann das Kassen-Tablet einen Hotspot bereitstellen.</small>
        </div>
      ) : state.status === "pin" ? (
        <div className={styles.pinTerminal}>
          <div className={styles.pinCustomer}>🔐 {state?.pinRequest?.customerName ? `Hallo ${state.pinRequest.customerName}` : "PIN erforderlich"}</div>
          <h2>PIN eingeben</h2>
          <div className={styles.pinDots}>
            {Array.from({ length: Math.max(4, pinEntry.length) }).slice(0,8).map((_, i) => (
              <span key={i} className={i < pinEntry.length ? styles.pinDotFilled : ""}>●</span>
            ))}
          </div>
          {state?.pinRequest?.invalid && <div className={styles.pinError}>PIN falsch – bitte erneut eingeben</div>}
          <div className={styles.pinPad}>
            {[1,2,3,4,5,6,7,8,9].map((n) => (
              <button key={n} onClick={() => pinEntry.length < 8 && setPinEntry((v) => `${v}${n}`)}>{n}</button>
            ))}
            <button onClick={() => setPinEntry((v) => v.slice(0,-1))}>←</button>
            <button onClick={() => pinEntry.length < 8 && setPinEntry((v) => `${v}0`)}>0</button>
            <button className={styles.pinConfirm} onClick={submitPin} disabled={pinEntry.length < 4 || pinSending}>✓</button>
          </div>
          <button className={styles.pinCancel} onClick={() => sendTerminalInput({ action: "cancel" })}>Abbrechen</button>
        </div>
      ) : state.disabled ? (
        <div className={styles.centerMessage}>
          <span>📺</span>
          <h2>Kundenanzeige deaktiviert</h2>
          <p>Aktiviere sie in den Einstellungen der Kasse.</p>
        </div>
      ) : (
        <main className={styles.content}>
          <section ref={itemsRef} className={styles.items}>
            {items.length === 0 ? (
              <div className={styles.centerMessage}>
                <span>🛒</span>
                <h2>Willkommen!</h2>
                <p>Der nächste Einkauf kann beginnen.</p>
              </div>
            ) : items.map((item, index) => (
              <div className={styles.item} key={`${item.name}-${index}`}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.qty} × {priceStr(item.price)}</span>
                </div>
                <b>{priceStr(Number(item.price) * Number(item.qty))}</b>
              </div>
            ))}
          </section>

          <aside className={styles.summary}>
            <div className={styles.totalLabel}>TOTAL</div>
            <div className={styles.total}>{priceStr(state.total)}</div>

            {state.status === "payment" && (
              <div className={styles.payment}>
                <span>Zahlung</span>
                <strong>{PAY_LABELS[state.paymentMode] || "Bitte bezahlen"}</strong>
                {cash && state.tendered != null && (
                  <>
                    <div className={styles.cashRow}><span>Gegeben</span><b>{priceStr(state.tendered)}</b></div>
                    <div className={styles.cashRow}><span>Rückgeld</span><b>{priceStr(state.change)}</b></div>
                  </>
                )}
              </div>
            )}

            {state.status === "success" && (
              <div className={styles.success}>✅<strong>Vielen Dank!</strong></div>
            )}
            {connection === "error" && (
              <div className={styles.offline}>
                Verbindung wird wiederhergestellt …
                {localMode && <button className={styles.changeSource} onClick={() => setConnection("setup")}>Adresse ändern</button>}
              </div>
            )}
          </aside>
        </main>
      )}

      <button className={styles.exit} onClick={() => { window.location.hash = "#/einstellungen"; }}>⚙️</button>
    </div>
  );
}
