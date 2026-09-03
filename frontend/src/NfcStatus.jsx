import React from "react";
import { useNfc } from "./NfcContext";
import styles from "./App.module.css";

// Kleine Statusanzeige für die NFC-Box, oben in der Navigation.
// Zeigt verbunden/getrennt und erlaubt erneutes Verbinden per Tipp.
export default function NfcStatus() {
  const { status, statusText, connect, isSupported, enabled } = useNfc();

  if (!enabled || !isSupported) return null; // ausgeblendet, wenn NFC-Box deaktiviert ist

  const handleClick = () => {
    if (status !== "connected" && status !== "connecting") {
      connect(true); // Klick ist eine Nutzergeste → Dialog erlaubt
    }
  };

  let dotClass = styles.nfcDotOff;
  let label = "NFC-Box: getrennt";
  if (status === "connected") { dotClass = styles.nfcDotOn; label = "NFC-Box: verbunden"; }
  else if (status === "connecting") { dotClass = styles.nfcDotPending; label = "NFC-Box: verbinde …"; }

  return (
    <button
      className={styles.nfcStatus}
      onClick={handleClick}
      title={statusText || (status === "connected" ? "NFC-Box ist verbunden" : "Tippen, um die NFC-Box zu verbinden")}
    >
      <span className={`${styles.nfcDot} ${dotClass}`} />
      <span className={styles.nfcLabel}>{label}</span>
      {status !== "connected" && status !== "connecting" && (
        <span className={styles.nfcReconnect}>neu verbinden</span>
      )}
    </button>
  );
}
