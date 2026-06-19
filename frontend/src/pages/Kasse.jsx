import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./Kasse.module.css";
import { useCart } from "../CartContext";
import { useNfc } from "../NfcContext";
import { apiFetch, assetUrl, loadAssetUrl } from "../lib/api";
import { isCameraSupported, openCameraStream, startQrScanner, waitForVideoRef } from "../lib/qrScanner";

const API = "/api";
const LETTERS = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
const PAGE_SIZE = 9;

function priceStr(n) {
  return n.toFixed(2) + " CHF";
}

function useResolvedAssetUrl(path) {
  const [url, setUrl] = useState(path ? assetUrl(path) : null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return undefined;
    }
    setUrl(assetUrl(path));
    loadAssetUrl(path)
      .then((nextUrl) => { if (!cancelled) setUrl(nextUrl); })
      .catch(() => { if (!cancelled) setUrl(assetUrl(path)); });
    return () => { cancelled = true; };
  }, [path]);

  return url;
}

function ArticleTile({ article, onClick }) {
  const imageUrl = useResolvedAssetUrl(article.image);
  return (
    <button
      className={styles.articleCard}
      onClick={() => onClick(article)}
    >
      {article.image ? (
        <>
          <div
            className={styles.articleBlurBg}
            style={{ backgroundImage: imageUrl ? `url(${imageUrl})` : undefined }}
          />
          {imageUrl && <img className={styles.articleImg} src={imageUrl} alt={article.name} />}
        </>
      ) : (
        <span className={styles.articleEmoji}>{article.emoji || "🛍️"}</span>
      )}
      <div className={styles.articleOverlay}>
        <div className={styles.articleName}>{article.name}</div>
        <div className={styles.articlePrice}>{priceStr(article.price)}</div>
      </div>
    </button>
  );
}

export default function Kasse() {
  const { cart, addToCart, removeFromCart, clearCart } = useCart(); // Warenkorb lebt im globalen Context, überlebt Seitenwechsel
  const nfc = useNfc(); // geteilte, app-weite NFC-Box-Verbindung
  const [allArticles, setAllArticles] = useState([]); // Fix #8: ungefiltert, für die Buchstabenleiste
  const [articles, setArticles] = useState([]); // gefiltert für die Anzeige
  const [letter, setLetter] = useState("ALL");
  const [page, setPage] = useState(0);
  const [phase, setPhase] = useState("shop"); // shop | payment | success | error
  const [payMode, setPayMode] = useState("nfc"); // "nfc" | "qr" | "bleNfc" | "manual"
  // Welche Methoden sind freigeschaltet (aus den Einstellungen, gemeinsam für alle Geräte)
  const [enabledModes, setEnabledModes] = useState({ nfc: true, qr: true, bleNfc: true, manual: true });
  const [manualName, setManualName] = useState(""); // Kundenname per Tastatur eintippen
  const [nfcStatus, setNfcStatus] = useState("");
  const [cardInfo, setCardInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);
  const nfcAbortRef = useRef(null); // Fix #7: echtes Abbrechen via AbortController
  const bleDisconnectRef = useRef(null); // Trennt die ESP32-Bluetooth-Bridge
  const paymentDoneRef = useRef(false); // Fix #6: verhindert Mehrfach-Abbuchung durch mehrfaches NFC-Lesen
  const gridRef = useRef(null); // für Swipe-Erkennung
  const touchStartRef = useRef({ x: 0, y: 0 });

  // Fix #8: alle Artikel einmalig laden für die Buchstabenleiste (unabhängig vom aktuellen Filter)
  const fetchAllArticles = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/articles`);
      if (!res.ok) throw new Error("Server-Fehler");
      setAllArticles(await res.json());
    } catch (e) {
      setAllArticles([]);
    }
  }, []);

  const fetchArticles = useCallback(async () => {
    try {
      const params = letter !== "ALL" ? `?letter=${letter}` : "";
      const res = await apiFetch(`/api/articles${params}`);
      if (!res.ok) throw new Error("Server-Fehler");
      const data = await res.json();
      setArticles(data);
      setPage(0);
    } catch (e) {
      setArticles([]);
    }
  }, [letter]);

  useEffect(() => { fetchAllArticles(); }, [fetchAllArticles]);
  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  // Zahlungsmethoden-Einstellungen laden (gemeinsam für alle Geräte).
  // Nur aktive Methoden werden in der Kasse angezeigt; die Standard-Methode
  // wird vorausgewählt, damit man auf dem jeweiligen Gerät nicht jedes Mal
  // umstellen muss.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/settings/payment`);
        if (!res.ok) return;
        const data = await res.json();
        setEnabledModes(data.enabled);
        if (data.enabled[data.default]) {
          setPayMode(data.default);
        } else {
          const firstActive = ["nfc", "qr", "bleNfc", "manual"].find((m) => data.enabled[m]);
          if (firstActive) setPayMode(firstActive);
        }
      } catch {
        // bei Fehler bleiben alle Methoden sichtbar (Default-State)
      }
    })();
  }, []);

  // Falls der aktuell gewählte Modus nicht (mehr) aktiv ist, auf die erste
  // aktive Methode wechseln — verhindert, dass ein unsichtbarer Modus aktiv bleibt.
  useEffect(() => {
    if (!enabledModes[payMode]) {
      const firstActive = ["nfc", "qr", "bleNfc", "manual"].find((m) => enabledModes[m]);
      if (firstActive) setPayMode(firstActive);
    }
  }, [enabledModes, payMode]);

  // Stop scanners on unmount
  useEffect(() => () => { stopQr(); stopNfc(); stopBleNfc(); }, []);

  const paginated = articles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(articles.length / PAGE_SIZE);
  // Fix #1 (Review 4): Frontend rundet zusätzlich, damit gar nicht erst ein
  // verrauschter Float-Wert (z.B. 0.30000000000000004) ans Backend geschickt wird.
  const total = Math.round(cart.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;

  // ── Swipe-Navigation zwischen Seiten ──
  // Reine Touch-Events statt einer externen Library, da nur ein simpler
  // horizontaler Wisch nötig ist und kein komplexes Gesture-Handling.
  const SWIPE_THRESHOLD = 50; // Mindestdistanz in px, damit es als Swipe zählt
  const SWIPE_MAX_VERTICAL = 75; // zu schräge Wische (eher Scroll-Versuch) ignorieren

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_MAX_VERTICAL) return;

    if (dx < 0) {
      // nach links gewischt → nächste Seite
      setPage((p) => Math.min(totalPages - 1, p + 1));
    } else {
      // nach rechts gewischt → vorherige Seite
      setPage((p) => Math.max(0, p - 1));
    }
  };

  // ── Cart: addToCart/removeFromCart kommen jetzt aus dem CartContext ──

  // ── Payment ──
  // Safari-Fix: bei QR-Modus wird startQr() direkt aufgerufen, BEVOR irgendwelche
  // setState-Aufrufe einen Re-Render auslösen — sonst verliert iOS WebKit die
  // "user gesture" und der Kamera-Prompt erscheint nicht.
  const startPayment = () => {
    if (cart.length === 0) return;
    paymentDoneRef.current = false; // Fix #6: Guard zurücksetzen für neue Zahlung
    if (payMode === "qr") {
      startQr(); // öffnet Kamera direkt im Klick-Handler und setzt danach payment
    } else if (payMode === "bleNfc") {
      startBleNfc(); // requestDevice() muss ebenfalls direkt im Klick-Handler laufen
      setPhase("payment");
      setCardInfo(null);
      setErrorMsg("");
    } else if (payMode === "manual") {
      setPhase("payment");
      setCardInfo(null);
      setErrorMsg("");
      setNfcStatus("");
    } else {
      setPhase("payment");
      setCardInfo(null);
      setErrorMsg("");
      startNfc();
    }
  };

  // NFC — Fix #6 + #7: AbortController zum echten Stoppen, Guard gegen Mehrfach-Trigger
  const startNfc = async () => {
    setNfcStatus("Bitte NFC-Karte ans Tablet halten …");
    if (!("NDEFReader" in window)) {
      setNfcStatus("NFC wird von diesem Browser nicht unterstützt.");
      return;
    }
    try {
      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReader();
      await ndef.scan({ signal: controller.signal });
      setNfcStatus("Warten auf Karte …");
      ndef.onreadingerror = () => setNfcStatus("Karte konnte nicht gelesen werden. Nochmal versuchen.");
      ndef.onreading = async ({ serialNumber }) => {
        if (paymentDoneRef.current) return; // schon verarbeitet, ignoriere weitere Reads
        paymentDoneRef.current = true;
        stopNfc();
        await processPayment(serialNumber.toUpperCase());
      };
    } catch (err) {
      if (err.name !== "AbortError") {
        setNfcStatus(`NFC Fehler: ${err.message}`);
      }
    }
  };

  const stopNfc = () => {
    if (nfcAbortRef.current) {
      nfcAbortRef.current.abort();
      nfcAbortRef.current = null;
    }
  };

  // ── Bluetooth-NFC-Box (ESP32) über die geteilte App-weite Verbindung ──────
  // Die Verbindung selbst hält der NfcContext (app-weit, bleibt offen).
  // Die Kasse abonniert hier nur die UID-Lesungen, solange sie auf Zahlung wartet.
  const startBleNfc = async () => {
    if (!nfc.isSupported) {
      setNfcStatus("NFC-Box-Verbindung ist nicht verfügbar. Bitte Bluetooth und Berechtigungen prüfen.");
      return;
    }
    // Falls noch nicht verbunden: jetzt verbinden (Klick = Nutzergeste, Dialog erlaubt)
    if (nfc.status !== "connected") {
      setNfcStatus("Verbinde mit NFC-Box …");
      const ok = await nfc.connect(true);
      if (!ok) {
        setNfcStatus("NFC-Box nicht verbunden. Oben auf „neu verbinden“ tippen.");
        return;
      }
    }
    setNfcStatus("Karte an die NFC-Box halten …");
    // UID-Lesungen abonnieren
    bleDisconnectRef.current = nfc.subscribeUid((uid) => {
      if (paymentDoneRef.current) return;
      paymentDoneRef.current = true;
      stopBleNfc();
      processPayment(uid);
    });
  };

  const stopBleNfc = () => {
    // Nur das Abo beenden — die Verbindung selbst bleibt für andere Bereiche offen.
    if (bleDisconnectRef.current) {
      bleDisconnectRef.current();
      bleDisconnectRef.current = null;
    }
  };

  // QR/Kamera: zuerst Kamera öffnen, dann mit BarcodeDetector oder jsQR lesen.
  // jsQR ist wichtig für Android-WebView/Capacitor, weil BarcodeDetector dort
  // nicht auf jedem Tablet vorhanden ist.
  const startQr = async () => {
    if (!isCameraSupported()) {
      setNfcStatus("Kamera nicht verfügbar. Bitte Kamera-Berechtigung prüfen.");
      return;
    }

    try {
      // Direkt im Klick-Handler öffnen, damit Android/Browser die Nutzergeste erkennt.
      setNfcStatus("Kamera wird geöffnet …");
      const stream = await openCameraStream({ width: 640, height: 480 });

      setPhase("payment");
      setCardInfo(null);
      setErrorMsg("");

      const video = await waitForVideoRef(() => videoRef.current);
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        setNfcStatus("Kamera-Fenster konnte nicht geöffnet werden.");
        return;
      }

      qrScannerRef.current = await startQrScanner(
        video,
        async (value) => {
          if (paymentDoneRef.current) return;
          paymentDoneRef.current = true;
          stopQr();
          await processPayment(value);
        },
        { stream, width: 640, height: 480 }
      );

      setNfcStatus("QR-Code vor die Kamera halten …");
    } catch (err) {
      if (err?.name === "NotAllowedError") {
        setNfcStatus("Kamera-Zugriff wurde verweigert. Bitte App-/Browser-Berechtigung erlauben.");
      } else if (err?.name === "NotFoundError") {
        setNfcStatus("Keine Kamera gefunden.");
      } else {
        setNfcStatus(`Kamera Fehler: ${err?.message || err}`);
      }
    }
  };

  const stopQr = () => {
    if (qrScannerRef.current) {
      if (typeof qrScannerRef.current === "function") qrScannerRef.current();
      else cancelAnimationFrame(qrScannerRef.current);
      qrScannerRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  // Manuelle Eingabe: Name eintippen statt scannen
  const submitManualPayment = () => {
    if (!manualName.trim() || paymentDoneRef.current) return;
    paymentDoneRef.current = true;
    processPayment(manualName.trim());
  };

  // Fix #10: try/catch für Netzwerkfehler bei der Zahlung
  const processPayment = async (identifier) => {
    setNfcStatus("Verarbeite Zahlung …");
    stopQr();
    stopNfc();
    stopBleNfc();
    const items = cart.map((i) => `${i.name} x${i.qty}`).join(", ");
    try {
      const res = await apiFetch(`/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_uid: identifier, total, items }),
      });
      const data = await res.json();
      if (res.ok) {
        setCardInfo(data);
        setPhase("success");
        clearCart(); // erst hier wird der Warenkorb geleert — exakt wie gewünscht
      } else {
        setErrorMsg(
          data.balance !== undefined
            ? `Guthaben zu niedrig! Karte hat ${priceStr(data.balance)}, benötigt: ${priceStr(total)}`
            : data.error || "Zahlung fehlgeschlagen"
        );
        setPhase("error");
      }
    } catch (e) {
      setErrorMsg("Server nicht erreichbar. Bitte Verbindung prüfen und nochmal versuchen.");
      setPhase("error");
    }
  };

  const resetShop = () => {
    stopQr();
    stopNfc();
    stopBleNfc();
    paymentDoneRef.current = false;
    setPhase("shop");
    setCardInfo(null);
    setErrorMsg("");
    setNfcStatus("");
    setManualName("");
  };

  const retryPayment = () => {
    paymentDoneRef.current = false;
    if (payMode === "qr") {
      startQr();
    } else if (payMode === "bleNfc") {
      startBleNfc();
      setPhase("payment");
    } else if (payMode === "manual") {
      setPhase("payment");
    } else {
      setPhase("payment");
      startNfc();
    }
  };

  return (
    <div className={styles.layout}>
      {/* Left */}
      <div className={styles.left}>
        <div className={styles.letterBar}>
          {LETTERS.map((l) => {
            // Fix #8: Buchstaben werden aus ALLEN Artikeln berechnet, nicht aus dem aktuell gefilterten Set
            const used = allArticles.some(a => a.name[0].toUpperCase() === l);
            if (l !== "ALL" && !used) return null;
            return (
              <button
                key={l}
                className={`${styles.letterBtn} ${letter === l ? styles.letterActive : ""}`}
                onClick={() => { setLetter(l); setPage(0); }}
              >
                {l === "ALL" ? "Alle" : l}
              </button>
            );
          })}
        </div>

        <div
          ref={gridRef}
          key={page}
          className={styles.grid}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {paginated.length === 0 && <div className={styles.empty}>Keine Artikel</div>}
          {paginated.map((a) => (
            <ArticleTile key={a.id} article={a} onClick={addToCart} />
          ))}
        </div>

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>◀</button>
            <span>{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>▶</button>
          </div>
        )}
      </div>

      {/* Right: cart */}
      <div className={styles.right}>
        <div className={styles.cartHeader}>🛒 Warenkorb</div>

        <div className={styles.cartItems}>
          {cart.length === 0 && <div className={styles.cartEmpty}>Noch nichts im Warenkorb</div>}
          {cart.map((item) => (
            <div key={item.id} className={styles.cartItem}>
              <div className={styles.cartItemName}>{item.name}</div>
              <div className={styles.cartItemControls}>
                <button className={styles.qtyBtn} onClick={() => removeFromCart(item.id)}>−</button>
                <span className={styles.qty}>{item.qty}</span>
                <button className={styles.qtyBtn} onClick={() => addToCart(item)}>+</button>
              </div>
              <div className={styles.cartItemPrice}>{priceStr(item.price * item.qty)}</div>
            </div>
          ))}
        </div>

        <div className={styles.cartTotal}>
          <span>Gesamt</span>
          <span className={styles.totalAmount}>{priceStr(total)}</span>
        </div>

        {/* Zahlungsmethoden-Umschalter — nur aktivierte Methoden (aus den
            Einstellungen). Bei nur einer aktiven Methode wird der Umschalter
            ausgeblendet, da nichts umzuschalten ist. */}
        {(() => {
          const methodDefs = [
            { id: "nfc", label: "📡 NFC" },
            { id: "qr", label: "📷 QR" },
            { id: "bleNfc", label: "🔵 Box" },
            { id: "manual", label: "✏️ Name" },
          ];
          const active = methodDefs.filter((m) => enabledModes[m.id]);
          if (active.length <= 1) return null;
          return (
            <div className={styles.modeSwitch}>
              {active.map((m) => (
                <button
                  key={m.id}
                  className={`${styles.modeBtn} ${payMode === m.id ? styles.modeActive : ""}`}
                  onClick={() => setPayMode(m.id)}
                >{m.label}</button>
              ))}
            </div>
          );
        })()}

        <button className={styles.payBtn} onClick={startPayment} disabled={cart.length === 0}>
          {payMode === "nfc" && "💳 Mit NFC bezahlen"}
          {payMode === "qr" && "📷 Mit QR-Code bezahlen"}
          {payMode === "bleNfc" && "🔵 Mit NFC-Box bezahlen"}
          {payMode === "manual" && "✏️ Name eingeben"}
        </button>
        {cart.length > 0 && (
          <button className={styles.clearBtn} onClick={clearCart}>Warenkorb leeren</button>
        )}
      </div>

      {/* Overlay */}
      {(phase === "payment" || phase === "success" || phase === "error") && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            {phase === "payment" && (
              <>
                {payMode === "qr" ? (
                  <>
                    <div className={styles.qrBox}>
                      <video ref={videoRef} className={styles.qrVideo} playsInline muted />
                      <div className={styles.qrFrame} />
                    </div>
                    <h2>Zahlung: {priceStr(total)}</h2>
                    <p className={styles.nfcStatus}>{nfcStatus}</p>
                  </>
                ) : payMode === "bleNfc" ? (
                  <>
                    <div className={styles.nfcIcon}>🔵</div>
                    <h2>Zahlung: {priceStr(total)}</h2>
                    <p className={styles.nfcStatus}>{nfcStatus}</p>
                  </>
                ) : payMode === "manual" ? (
                  <>
                    <div className={styles.nfcIcon}>✏️</div>
                    <h2>Zahlung: {priceStr(total)}</h2>
                    <input
                      className={styles.manualNameInput}
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitManualPayment(); }}
                      placeholder="Name eingeben …"
                      autoFocus
                    />
                  </>
                ) : (
                  <>
                    <div className={styles.nfcIcon}>📡</div>
                    <h2>Zahlung: {priceStr(total)}</h2>
                    <p className={styles.nfcStatus}>{nfcStatus}</p>
                  </>
                )}
                {payMode === "manual" && (
                  <button className={styles.successBtn} onClick={submitManualPayment} disabled={!manualName.trim()}>
                    Bezahlen
                  </button>
                )}
                <button className={styles.cancelBtn} onClick={resetShop}>Abbrechen</button>
              </>
            )}
            {phase === "success" && (
              <>
                <div className={styles.successIcon}>✅</div>
                <h2>Bezahlt!</h2>
                <p>{cardInfo?.customer_name && <strong>{cardInfo.customer_name}</strong>} — Neues Guthaben: <strong>{cardInfo ? priceStr(cardInfo.new_balance) : ""}</strong></p>
                <button className={styles.successBtn} onClick={resetShop}>Weiter einkaufen</button>
              </>
            )}
            {phase === "error" && (
              <>
                <div className={styles.errorIcon}>❌</div>
                <h2>Fehler</h2>
                <p>{errorMsg}</p>
                <button className={styles.cancelBtn} onClick={retryPayment}>Nochmal</button>
                <button className={styles.successBtn} onClick={resetShop}>Zurück</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
