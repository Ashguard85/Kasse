import React, { useState, useEffect, useRef } from "react";
import styles from "./Karten.module.css";
import QrCode from "../components/QrCode";
import { useNfc } from "../NfcContext";
import { apiFetch } from "../lib/api";
import { isCameraSupported, openCameraStream, startQrScanner, waitForVideoRef } from "../lib/qrScanner";

function priceStr(n) {
  return Number(n).toFixed(2) + " CHF";
}

export default function Karten() {
  const nfc = useNfc(); // geteilte, app-weite NFC-Box-Verbindung
  const [customers, setCustomers] = useState([]);
  const [name, setName] = useState("");
  const [initType, setInitType] = useState("both"); // nfc | qr | both | none
  const [initUid, setInitUid] = useState("");
  const [initQr, setInitQr] = useState("");
  const [balance, setBalance] = useState("");

  const [topupId, setTopupId] = useState("");
  const [topupAmount, setTopupAmount] = useState("");

  const [scanning, setScanning] = useState(false); // "nfc" | "qr" | false
  const [scanTarget, setScanTarget] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [transactions, setTransactions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showQr, setShowQr] = useState(null);
  const [showOverview, setShowOverview] = useState(false);

  // Add-token form (within selected customer detail)
  const [newTokenType, setNewTokenType] = useState("nfc");
  const [newTokenValue, setNewTokenValue] = useState("");

  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const bleDisconnectRef = useRef(null); // Trennt die ESP32-Bluetooth-NFC-Box
  const msgTimerRef = useRef(null); // Fix #5 (Review 4): verhindert Race Condition bei schnell aufeinanderfolgenden Meldungen

  const fetchCustomers = async () => {
    try {
      const res = await apiFetch(`/api/customers`);
      if (!res.ok) throw new Error("Server-Fehler");
      setCustomers(await res.json());
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  useEffect(() => { fetchCustomers(); }, []);
  useEffect(() => () => { stopQrScan(); stopNfcScan(); if (msgTimerRef.current) clearTimeout(msgTimerRef.current); }, []);

  const showMsg = (text, type = "ok") => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setMsg({ text, type });
    msgTimerRef.current = setTimeout(() => setMsg({ text: "", type: "" }), 3000);
  };

  // ── NFC (über ESP32-Bluetooth-Box) / QR scanning ──
  // Das Lenovo Tab M11 hat kein eigenes NFC, daher läuft das Kartenlesen
  // hier — genau wie in der Kasse — über die geteilte ESP32-Bluetooth-Box
  // aus dem NfcContext (eine app-weite Verbindung für alle Bereiche).
  const scanNfc = async (target) => {
    if (!nfc.isSupported) {
      return showMsg("NFC-Box-Verbindung nicht verfügbar. Bitte Bluetooth und Berechtigungen prüfen.", "err");
    }
    setScanTarget(target);
    setScanning("nfc");
    // Falls noch nicht verbunden: jetzt verbinden (Klick = Nutzergeste)
    if (nfc.status !== "connected") {
      showMsg("Verbinde mit NFC-Box …", "ok");
      const ok = await nfc.connect(true);
      if (!ok) {
        showMsg("NFC-Box nicht verbunden. Oben auf „neu verbinden“ tippen.", "err");
        setScanning(false);
        setScanTarget(null);
        return;
      }
    }
    showMsg("Karte an die NFC-Box halten …", "ok");
    bleDisconnectRef.current = nfc.subscribeUid((uid) => {
      applyScanResult(target, uid);
      showMsg("NFC-Karte gelesen ✓");
      stopNfcScan();
    });
  };

  const stopNfcScan = () => {
    // Nur das Abo beenden — die geteilte Verbindung bleibt offen.
    if (bleDisconnectRef.current) {
      bleDisconnectRef.current();
      bleDisconnectRef.current = null;
    }
    setScanning(false);
    setScanTarget(null);
  };

  const scanQr = async (target) => {
    if (!isCameraSupported()) {
      showMsg("Kamera nicht verfügbar. Bitte Kamera-Berechtigung prüfen.", "err");
      return;
    }

    try {
      const stream = await openCameraStream({ width: 640, height: 480 });
      setScanTarget(target);
      setScanning("qr");

      const video = await waitForVideoRef(() => videoRef.current);
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        showMsg("Kamera-Fenster konnte nicht geöffnet werden.", "err");
        setScanning(false);
        setScanTarget(null);
        return;
      }

      scannerRef.current = await startQrScanner(
        video,
        (value) => {
          stopQrScan();
          applyScanResult(target, value);
          showMsg("QR-Code gelesen ✓");
        },
        { stream, width: 640, height: 480 }
      );
    } catch (e) {
      if (e?.name === "NotAllowedError") {
        showMsg("Kamera-Zugriff verweigert. Bitte App-/Browser-Berechtigung erlauben.", "err");
      } else if (e?.name === "NotFoundError") {
        showMsg("Keine Kamera gefunden.", "err");
      } else {
        showMsg("Kamera Fehler: " + (e?.message || e), "err");
      }
      setScanning(false);
      setScanTarget(null);
    }
  };

  const stopQrScan = () => {
    if (scannerRef.current) {
      if (typeof scannerRef.current === "function") scannerRef.current();
      else cancelAnimationFrame(scannerRef.current);
      scannerRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setScanning(false);
    setScanTarget(null);
  };

  const applyScanResult = (target, value) => {
    if (target === "new-nfc") setInitUid(value);
    else if (target === "new-qr") setInitQr(value);
    else if (target === "topup") setTopupId(value);
    else if (target === "add-token") setNewTokenValue(value);
  };

  const genQrId = (setter) => {
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    setter(`KASSE-${rand}`);
  };

  // ── Create customer ──
  const createCustomer = async () => {
    if (!name) return showMsg("Bitte Namen eingeben", "err");
    const needsUid = initType === "nfc" || initType === "both";
    const needsQr = initType === "qr" || initType === "both";
    if (needsUid && !initUid) return showMsg("Bitte NFC-UID eingeben/scannen", "err");
    if (needsQr && !initQr) return showMsg("Bitte QR-Code eingeben/scannen/generieren", "err");

    try {
      const res = await apiFetch(`/api/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          balance: parseFloat(balance) || 0,
          nfc_uid: needsUid ? initUid : null,
          qr_code: needsQr ? initQr : null,
        }),
      });
      if (res.ok) {
        showMsg(`Kunde "${name}" erstellt ✓`);
        setName(""); setInitUid(""); setInitQr(""); setBalance("");
        fetchCustomers();
      } else {
        const d = await res.json();
        showMsg(d.error, "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  // ── Topup ──
  const topup = async () => {
    if (!topupId || !topupAmount) return;
    try {
      const lookup = await apiFetch(`/api/lookup/${encodeURIComponent(topupId)}`);
      if (!lookup.ok) return showMsg("Kunde nicht gefunden", "err");
      const customer = await lookup.json();
      const res = await apiFetch(`/api/customers/${customer.id}/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(topupAmount) }),
      });
      if (res.ok) {
        const updated = await res.json();
        showMsg(`Aufgeladen! Guthaben: ${priceStr(updated.balance)}`);
        setTopupId(""); setTopupAmount("");
        fetchCustomers();
        if (selected?.id === customer.id) selectCustomer(updated);
      } else {
        const d = await res.json();
        showMsg(d.error, "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  // ── Select customer / load transactions ──
  const selectCustomer = async (customer) => {
    setSelected(customer);
    try {
      const res = await apiFetch(`/api/transactions?customer_id=${customer.id}`);
      if (!res.ok) throw new Error();
      setTransactions(await res.json());
    } catch (e) {
      setTransactions([]);
      showMsg("Verlauf konnte nicht geladen werden", "err");
    }
  };

  // ── Add a token to selected customer (Mami bekommt jetzt auch QR / neue Karte nach Verlust) ──
  const addTokenToSelected = async () => {
    if (!selected || !newTokenValue) return showMsg("Bitte Wert eingeben/scannen", "err");
    try {
      const res = await apiFetch(`/api/customers/${selected.id}/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: newTokenType, value: newTokenValue }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelected(updated);
        setNewTokenValue("");
        showMsg("Zahlungsmittel hinzugefügt ✓");
        fetchCustomers();
      } else {
        const d = await res.json();
        showMsg(d.error, "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  const deactivateToken = async (tokenId) => {
    if (!confirm("Dieses Zahlungsmittel deaktivieren? (z.B. weil Karte verloren ging)")) return;
    try {
      const res = await apiFetch(`/api/tokens/${tokenId}/deactivate`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setSelected(updated);
        showMsg("Deaktiviert. Guthaben bleibt erhalten — neue Karte kann hinzugefügt werden.");
        fetchCustomers();
      } else {
        const d = await res.json().catch(() => ({}));
        showMsg(d.error || "Deaktivieren fehlgeschlagen", "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  const reactivateToken = async (tokenId) => {
    try {
      const res = await apiFetch(`/api/tokens/${tokenId}/reactivate`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setSelected(updated);
        showMsg("Wieder aktiviert ✓");
        fetchCustomers();
      } else {
        const d = await res.json().catch(() => ({}));
        showMsg(d.error || "Reaktivieren fehlgeschlagen", "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  const deleteToken = async (tokenId) => {
    if (!confirm("Zahlungsmittel endgültig löschen?")) return;
    try {
      const res = await apiFetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
      if (res.ok) {
        const updated = await res.json();
        setSelected(updated);
        fetchCustomers();
      } else {
        const d = await res.json().catch(() => ({}));
        showMsg(d.error || "Löschen fehlgeschlagen", "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  // Fix Review #2: QR-Codes werden jetzt lokal mit der QrCode-Komponente gerendert,
  // kein externer Dienst (api.qrserver.com) mehr nötig — funktioniert auch ohne Internet.

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <div>
            <h1>💳 Kartenverwaltung</h1>
            <p>Kunden anlegen, Guthaben aufladen und Zahlungsmittel verwalten.</p>
          </div>
          <button className={styles.overviewBtn} onClick={() => setShowOverview(true)}>
            📋 Übersicht
          </button>
        </header>

        {msg.text && (
          <div className={`${styles.toast} ${styles[msg.type === "err" ? "msgErr" : "msgOk"]}`}>
            {msg.text}
          </div>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}>👤</span>
            <div>
              <h2>Neuen Kunden anlegen</h2>
              <p>Name, Startguthaben und optional NFC/QR erfassen.</p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Emma" />
            </label>

            <label className={styles.field}>
              <span>Startguthaben</span>
              <input type="number" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00" min="0" step="0.50" />
            </label>
          </div>

          <div className={styles.field}>
            <span>Zahlungsmittel</span>
            <div className={styles.modeSwitch}>
              <button type="button" className={`${styles.modeBtn} ${initType === "nfc" ? styles.modeActive : ""}`} onClick={() => setInitType("nfc")}>📡 NFC</button>
              <button type="button" className={`${styles.modeBtn} ${initType === "qr" ? styles.modeActive : ""}`} onClick={() => setInitType("qr")}>📷 QR</button>
              <button type="button" className={`${styles.modeBtn} ${initType === "both" ? styles.modeActive : ""}`} onClick={() => setInitType("both")}>💳 Beides</button>
              <button type="button" className={`${styles.modeBtn} ${initType === "none" ? styles.modeActive : ""}`} onClick={() => setInitType("none")}>Später</button>
            </div>
          </div>

          {(initType === "nfc" || initType === "both") && (
            <label className={styles.field}>
              <span>NFC-UID</span>
              <div className={styles.inputWithButtons}>
                <input value={initUid} onChange={e => setInitUid(e.target.value.toUpperCase())} placeholder="Karte scannen oder manuell eingeben" />
                <button type="button" className={styles.scanBtn} onClick={() => scanNfc("new-nfc")}>📡</button>
              </div>
            </label>
          )}

          {(initType === "qr" || initType === "both") && (
            <label className={styles.field}>
              <span>QR-Code</span>
              <div className={styles.inputWithButtons}>
                <input value={initQr} onChange={e => setInitQr(e.target.value)} placeholder="QR scannen oder Text eingeben" />
                <button type="button" className={styles.scanBtn} onClick={() => scanQr("new-qr")}>📷</button>
                <button type="button" className={styles.scanBtn} onClick={() => genQrId(setInitQr)}>🎲</button>
              </div>
            </label>
          )}

          {initType === "none" && (
            <p className={styles.hint}>Der Kunde wird ohne Zahlungsmittel angelegt. Du kannst später NFC oder QR hinzufügen.</p>
          )}

          <button className={styles.primaryBtn} onClick={createCustomer}>Kunde erstellen</button>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}>💰</span>
            <div>
              <h2>Guthaben aufladen</h2>
              <p>Kunde per Karte/QR scannen oder Namen/Kunden-ID eingeben.</p>
            </div>
          </div>

          <label className={styles.field}>
            <span>Kunde / NFC / QR</span>
            <div className={styles.inputWithButtons}>
              <input value={topupId} onChange={e => setTopupId(e.target.value)} placeholder="NFC, QR, Name oder Kunden-ID …" />
              <button type="button" className={styles.scanBtn} onClick={() => scanNfc("topup")}>📡</button>
              <button type="button" className={styles.scanBtn} onClick={() => scanQr("topup")}>📷</button>
            </div>
          </label>

          <label className={styles.field}>
            <span>Betrag</span>
            <div className={styles.amountRow}>
              {[5, 10, 20].map(a => (
                <button type="button" key={a} className={styles.quickBtn} onClick={() => setTopupAmount(String(a))}>{a} CHF</button>
              ))}
              <input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Betrag" min="0.50" step="0.50" />
            </div>
          </label>

          <button className={styles.primaryBtn} onClick={topup} disabled={!topupId || !topupAmount}>Aufladen</button>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}>📇</span>
            <div>
              <h2>Kunden</h2>
              <p>{customers.length} Kunden gespeichert. Antippen für Details.</p>
            </div>
          </div>

          <div className={styles.customerList}>
            {customers.length === 0 && <div className={styles.empty}>Noch keine Kunden</div>}

            {customers.map(c => {
              const tokens = c.tokens || [];
              const activeTokens = tokens.filter(t => t.active);
              const isOpen = selected?.id === c.id;
              return (
                <article key={c.id} className={`${styles.customerCard} ${isOpen ? styles.customerOpen : ""}`}>
                  <button type="button" className={styles.customerSummary} onClick={() => selectCustomer(c)}>
                    <span className={styles.avatar}>👤</span>
                    <span className={styles.customerMain}>
                      <strong>{c.name}</strong>
                      <span>
                        {activeTokens.length > 0
                          ? activeTokens.slice(0, 2).map(t => `${t.type === "nfc" ? "📡" : "📷"} ${t.value}`).join(" · ")
                          : "kein Zahlungsmittel"}
                      </span>
                    </span>
                    <span className={`${styles.balancePill} ${c.balance < 1 ? styles.balanceLow : ""}`}>{priceStr(c.balance)}</span>
                  </button>

                  {isOpen && selected && (
                    <div className={styles.customerDetail}>
                      <div className={styles.detailTop}>
                        <div>
                          <span className={styles.detailLabel}>Guthaben</span>
                          <strong className={`${styles.detailBalance} ${selected.balance < 1 ? styles.balanceLowText : ""}`}>{priceStr(selected.balance)}</strong>
                        </div>
                        <button type="button" className={styles.secondaryBtn} onClick={() => setTopupId(String(selected.id))}>
                          Für Aufladung wählen
                        </button>
                      </div>

                      <div className={styles.detailBlock}>
                        <h3>Zahlungsmittel</h3>
                        {selected.tokens.length === 0 && <div className={styles.emptySmall}>Noch keine Zahlungsmittel</div>}
                        {selected.tokens.map(t => (
                          <div key={t.id} className={`${styles.tokenRow} ${!t.active ? styles.tokenInactive : ""}`}>
                            <span className={styles.tokenIcon}>{t.type === "nfc" ? "📡" : "📷"}</span>
                            <span className={styles.tokenValue}>{t.value}</span>
                            {!t.active && <span className={styles.tokenBadge}>deaktiviert</span>}
                            <span className={styles.tokenActions}>
                              {t.type === "qr" && t.active && <button type="button" className={styles.iconSmBtn} onClick={() => setShowQr(t)}>🖨️</button>}
                              {t.active
                                ? <button type="button" className={styles.iconSmBtn} onClick={() => deactivateToken(t.id)}>🚫</button>
                                : <button type="button" className={styles.iconSmBtn} onClick={() => reactivateToken(t.id)}>♻️</button>}
                              <button type="button" className={styles.iconSmBtn} onClick={() => deleteToken(t.id)}>🗑️</button>
                            </span>
                          </div>
                        ))}

                        <div className={styles.addTokenBox}>
                          <div className={styles.modeSwitchSmall}>
                            <button type="button" className={`${styles.modeBtn} ${newTokenType === "nfc" ? styles.modeActive : ""}`} onClick={() => setNewTokenType("nfc")}>📡 NFC</button>
                            <button type="button" className={`${styles.modeBtn} ${newTokenType === "qr" ? styles.modeActive : ""}`} onClick={() => setNewTokenType("qr")}>📷 QR</button>
                          </div>
                          <div className={styles.inputWithButtons}>
                            <input value={newTokenValue} onChange={e => setNewTokenValue(newTokenType === "nfc" ? e.target.value.toUpperCase() : e.target.value)} placeholder={newTokenType === "nfc" ? "Neue NFC-Karte" : "Neuer QR-Code"} />
                            <button type="button" className={styles.scanBtn} onClick={() => newTokenType === "nfc" ? scanNfc("add-token") : scanQr("add-token")}>
                              {newTokenType === "nfc" ? "📡" : "📷"}
                            </button>
                            {newTokenType === "qr" && <button type="button" className={styles.scanBtn} onClick={() => genQrId(setNewTokenValue)}>🎲</button>}
                          </div>
                          <button type="button" className={styles.secondaryBtn} onClick={addTokenToSelected}>+ Zahlungsmittel hinzufügen</button>
                        </div>
                      </div>

                      <div className={styles.detailBlock}>
                        <h3>Verlauf</h3>
                        <div className={styles.txList}>
                          {transactions.length === 0 && <div className={styles.emptySmall}>Keine Transaktionen</div>}
                          {transactions.map(t => (
                            <div key={t.id} className={styles.txRow}>
                              <span>{t.type === "purchase" ? "🛒" : "💰"}</span>
                              <span className={styles.txNote}>{t.note}</span>
                              <strong className={`${styles.txAmount} ${t.type === "purchase" ? styles.txMinus : styles.txPlus}`}>
                                {t.type === "purchase" ? "−" : "+"}{priceStr(t.amount)}
                              </strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {scanning && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            {scanning === "nfc" && (
              <>
                <div className={styles.scanAnim}>🔵</div>
                <p>NFC-Karte an die NFC-Box halten …</p>
              </>
            )}
            {scanning === "qr" && (
              <>
                <div className={styles.qrBox}>
                  <video ref={videoRef} className={styles.qrVideo} playsInline muted />
                  <div className={styles.qrFrame} />
                </div>
                <p>QR-Code vor die Kamera halten …</p>
              </>
            )}
            <button type="button" onClick={scanning === "nfc" ? stopNfcScan : stopQrScan}>Abbrechen</button>
          </div>
        </div>
      )}

      {showQr && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>{selected?.name}</h3>
            <QrCode value={showQr.value} size={200} />
            <p className={styles.qrValue}>{showQr.value}</p>
            <button type="button" className={`${styles.primaryBtn} ${styles.noPrint}`} onClick={() => window.print()}>🖨️ Drucken</button>
            <button type="button" className={styles.noPrint} onClick={() => setShowQr(null)}>Schliessen</button>
          </div>
        </div>
      )}

      {showOverview && (
        <div className={styles.overlay} onClick={() => setShowOverview(false)}>
          <div className={styles.overviewModal} onClick={e => e.stopPropagation()}>
            <div className={styles.overviewHeader}>
              <h3>📋 Kundenübersicht</h3>
              <div className={styles.overviewActions}>
                <button type="button" className={styles.primaryBtn} onClick={() => window.print()}>🖨️ Alle drucken</button>
                <button type="button" className={styles.closeBtn} onClick={() => setShowOverview(false)}>✕</button>
              </div>
            </div>
            <div className={styles.overviewGrid}>
              {customers.length === 0 && <div className={styles.empty}>Noch keine Kunden</div>}
              {customers.map(c => {
                const qrToken = (c.tokens || []).find(t => t.type === "qr" && t.active);
                const nfcTokens = (c.tokens || []).filter(t => t.type === "nfc" && t.active);
                return (
                  <div key={c.id} className={styles.overviewCard}>
                    <div className={styles.overviewName}>{c.name}</div>
                    <div className={styles.overviewBalance}>{priceStr(c.balance)}</div>
                    {qrToken && <div className={styles.overviewQrImg}><QrCode value={qrToken.value} size={140} /></div>}
                    {nfcTokens.map(t => <div key={t.id} className={styles.overviewUid}>📡 {t.value}</div>)}
                    {qrToken && <div className={styles.overviewUid}>📷 {qrToken.value}</div>}
                    {!qrToken && nfcTokens.length === 0 && <div className={styles.overviewUid}>— keine Kennung —</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
