import React, { useEffect, useState } from "react";
import { apiFetch, getDataMode } from "../lib/api";
import { useProfile } from "../ProfileContext";
import styles from "./KundenDisplay.module.css";

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

export default function KundenDisplay() {
  const { activeProfile } = useProfile();
  const [state, setState] = useState({ status: "shop", items: [], total: 0 });
  const [connection, setConnection] = useState("loading");

  useEffect(() => {
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        if (getDataMode() === "local") {
          setConnection("local");
        } else {
          const res = await apiFetch("/api/customer-display");
          if (!res.ok) throw new Error();
          const data = await res.json();
          if (!stopped) {
            setState(data);
            setConnection("ok");
          }
        }
      } catch {
        if (!stopped) setConnection("error");
      } finally {
        if (!stopped) timer = setTimeout(poll, 650);
      }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [activeProfile?.id]);

  const theme = activeProfile?.theme || {};
  const items = Array.isArray(state.items) ? state.items : [];
  const cash = state.paymentMode === "cash";

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
          <h1>{activeProfile?.name || "KinderKasse"}</h1>
          <p>{theme.bannerText || "Willkommen!"}</p>
        </div>
      </header>

      {connection === "local" ? (
        <div className={styles.centerMessage}>
          <span>🌐</span>
          <h2>Servermodus erforderlich</h2>
          <p>Die Kundenanzeige auf einem zweiten Tablet funktioniert über den Docker-Server.</p>
        </div>
      ) : state.disabled ? (
        <div className={styles.centerMessage}>
          <span>📺</span>
          <h2>Kundenanzeige deaktiviert</h2>
          <p>Aktiviere sie in den Einstellungen des gewählten Profils.</p>
        </div>
      ) : (
        <main className={styles.content}>
          <section className={styles.items}>
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
            {connection === "error" && <div className={styles.offline}>Verbindung zum Server wird wiederhergestellt …</div>}
          </aside>
        </main>
      )}

      <button className={styles.exit} onClick={() => { window.location.hash = "#/einstellungen"; }}>⚙️</button>
    </div>
  );
}
