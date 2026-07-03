import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Drucker.module.css";
import {
  buildTestReceipt,
  getLastReceiptText,
  getPrinterSettings,
  getReceiptLayoutSettings,
  isNativePrinterAvailable,
  listPairedPrinters,
  prepareReceiptLogoFromFile,
  printReceiptText,
  printCharsetTestReceipt,
  printTestReceipt,
  resetReceiptLayoutSettings,
  setPrinterSettings,
  setReceiptLayoutSettings,
} from "../lib/escposPrinter";
import { loadPrinterSettingsFromApi, savePrinterSettingsToApi, saveReceiptLayoutToApi } from "../lib/printerSettingsSync";

export default function Drucker() {
  const [msg, setMsg] = useState({ text: "", type: "" });
  const msgTimerRef = useRef(null);

  const initialPrinter = getPrinterSettings();
  const [printerEnabled, setPrinterEnabled] = useState(initialPrinter.enabled);
  const [printerAddress, setPrinterAddress] = useState(initialPrinter.address);
  const [printerName, setPrinterName] = useState(initialPrinter.name);
  const [printers, setPrinters] = useState([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [layout, setLayout] = useState(() => getReceiptLayoutSettings());
  const logoInputRef = useRef(null);
  const previewText = useMemo(() => buildTestReceipt(layout), [layout]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const synced = await loadPrinterSettingsFromApi();
      if (cancelled) return;
      if (synced.printer) {
        setPrinterEnabled(synced.printer.enabled);
        setPrinterAddress(synced.printer.address);
        setPrinterName(synced.printer.name);
      }
      if (synced.layout) setLayout(synced.layout);
    })();
    return () => { cancelled = true; };
  }, []);

  const showMsg = (text, type = "ok") => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setMsg({ text, type });
    msgTimerRef.current = setTimeout(() => setMsg({ text: "", type: "" }), 3500);
  };

  const refreshPrinters = async () => {
    setPrinterLoading(true);
    try {
      const devices = await listPairedPrinters();
      const sorted = [...devices].sort((a, b) => {
        if (a.printerLikely && !b.printerLikely) return -1;
        if (!a.printerLikely && b.printerLikely) return 1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      setPrinters(sorted);
      if (sorted.length === 0) {
        showMsg("Keine gekoppelten Bluetooth-Geräte gefunden. PT-210 zuerst in Android koppeln.", "err");
      } else {
        showMsg("Bluetooth-Geräte geladen ✓");
      }
    } catch (e) {
      showMsg(e?.message || "Bluetooth-Geräte konnten nicht geladen werden", "err");
    } finally {
      setPrinterLoading(false);
    }
  };

  const savePrinter = async () => {
    const found = printers.find((d) => d.address === printerAddress);
    const saved = await savePrinterSettingsToApi({
      enabled: printerEnabled,
      address: printerAddress,
      name: found?.name || printerName || "PT-210 Bondrucker",
    });
    setPrinterName(saved.name);
    showMsg(saved.enabled ? "Bondrucker gespeichert ✓" : "Bondrucker deaktiviert");
  };

  const testPrinter = async () => {
    const found = printers.find((d) => d.address === printerAddress);
    const settings = setPrinterSettings({
      enabled: printerEnabled,
      address: printerAddress,
      name: found?.name || printerName || "PT-210 Bondrucker",
    });
    if (!settings.enabled) return showMsg("Bondrucker ist deaktiviert", "err");
    if (!settings.address) return showMsg("Bitte zuerst den PT-210 auswählen", "err");
    setPrinting(true);
    try {
      await printTestReceipt(settings, layout);
      showMsg("Testbon wurde gesendet ✓");
    } catch (e) {
      showMsg(e?.message || "Testdruck fehlgeschlagen", "err");
    } finally {
      setPrinting(false);
    }
  };


  const testCharset = async () => {
    const found = printers.find((d) => d.address === printerAddress);
    const settings = setPrinterSettings({
      enabled: printerEnabled,
      address: printerAddress,
      name: found?.name || printerName || "PT-210 Bondrucker",
    });
    const savedLayout = setReceiptLayoutSettings(layout);
    setLayout(savedLayout);
    if (!settings.enabled) return showMsg("Bondrucker ist deaktiviert", "err");
    if (!settings.address) return showMsg("Bitte zuerst den PT-210 auswählen", "err");
    setPrinting(true);
    try {
      await printCharsetTestReceipt(settings, savedLayout);
      showMsg("Umlaut-Test wurde gesendet ✓");
    } catch (e) {
      showMsg(e?.message || "Umlaut-Test fehlgeschlagen", "err");
    } finally {
      setPrinting(false);
    }
  };

  const printLast = async () => {
    const text = getLastReceiptText();
    const settings = getPrinterSettings();
    if (!text) return showMsg("Kein letzter Bon vorhanden.", "err");
    if (!settings.enabled || !settings.address) return showMsg("Bondrucker ist noch nicht eingerichtet.", "err");
    setPrinting(true);
    try {
      await printReceiptText(text, settings, layout);
      showMsg("Letzter Bon wurde gesendet ✓");
    } catch (e) {
      showMsg(e?.message || "Bon konnte nicht gedruckt werden", "err");
    } finally {
      setPrinting(false);
    }
  };

  const importLogo = async (file) => {
    if (!file) return;
    try {
      const logoDataUrl = await prepareReceiptLogoFromFile(file);
      setLayout((prev) => ({ ...prev, logoDataUrl, printLogo: true }));
      showMsg("Logo übernommen ✓ Jetzt Bonlayout speichern.");
    } catch (e) {
      showMsg(e?.message || "Logo konnte nicht übernommen werden", "err");
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    setLayout((prev) => ({ ...prev, logoDataUrl: "", printLogo: false }));
    showMsg("Logo entfernt. Bonlayout speichern nicht vergessen.");
  };

  const updateLayout = (patch) => {
    setLayout((prev) => ({ ...prev, ...patch }));
  };

  const saveLayout = async () => {
    const saved = await saveReceiptLayoutToApi(layout);
    setLayout(saved);
    showMsg("Bonlayout gespeichert ✓");
  };

  const resetLayout = async () => {
    const next = resetReceiptLayoutSettings();
    const saved = await saveReceiptLayoutToApi(next);
    setLayout(saved);
    showMsg("Bonlayout zurückgesetzt");
  };

  const printPreview = () => {
    const saved = setReceiptLayoutSettings(layout);
    setLayout(saved);
    window.print();
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>🧾 Drucker</h1>
        <p className={styles.intro}>
          Alles rund um PT-210, Testbon und Kassenzettel-Layout ist hier gebündelt. Die normalen Einstellungen bleiben dadurch sauber.
        </p>

        <section className={styles.section}>
          <h2>GOOJPRT PT-210 / 58mm ESC/POS</h2>
          <p>Den Drucker zuerst in Android per Bluetooth koppeln. Danach hier laden, auswählen, aktivieren und speichern.</p>

          <div className={styles.printerTopRow}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={printerEnabled}
                onChange={(e) => setPrinterEnabled(e.target.checked)}
              />
              Bondrucker aktivieren
            </label>
            <button className={styles.testBtn} onClick={refreshPrinters} disabled={printerLoading}>
              {printerLoading ? "Lade …" : "Gekoppelte Geräte laden"}
            </button>
          </div>

          <div className={styles.selectRow}>
            <select
              value={printerAddress}
              onChange={(e) => {
                const address = e.target.value;
                const found = printers.find((d) => d.address === address);
                setPrinterAddress(address);
                setPrinterName(found?.name || "");
              }}
            >
              <option value="">Drucker auswählen …</option>
              {printers.map((device) => (
                <option key={device.address} value={device.address}>
                  {device.printerLikely ? "🧾 " : "🔵 "}{device.name} — {device.address}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.actions}>
            <button onClick={savePrinter}>Bondrucker speichern</button>
            <button className={styles.testBtn} onClick={testPrinter} disabled={printing}>Testbon drucken</button>
            <button className={styles.secondaryBtn} onClick={printLast} disabled={printing}>Letzten Bon drucken</button>
          </div>

          <p className={styles.smallWarn}>
            Direktdruck geht nur in der Android-APK. {!isNativePrinterAvailable() ? "Du bist gerade nicht in der nativen APK, deshalb ist Bluetooth-Direktdruck hier nicht verfügbar." : ""}
          </p>
        </section>

        <section className={styles.section}>
          <h2>Bonlayout</h2>
          <p>Diese Angaben steuern Testbon, echten Kassenzettel und die Vorschau. Der Bildmodus druckt den ganzen Bon als Bitmap und umgeht damit die Umlaut-Probleme des PT-210.</p>

          <div className={styles.layoutGrid}>
            <label>
              Ladenname
              <input value={layout.shopName} onChange={(e) => updateLayout({ shopName: e.target.value })} />
            </label>
            <label>
              Untertitel
              <input value={layout.subtitle} onChange={(e) => updateLayout({ subtitle: e.target.value })} />
            </label>
            <label>
              Fusszeile
              <input value={layout.footerText} onChange={(e) => updateLayout({ footerText: e.target.value })} />
            </label>
            <label>
              Zeilenbreite
              <select value={layout.lineWidth} onChange={(e) => updateLayout({ lineWidth: Number(e.target.value) })}>
                <option value={32}>32 Zeichen – Standard PT-210</option>
                <option value={30}>30 Zeichen – etwas mehr Luft</option>
                <option value={28}>28 Zeichen – sehr sicher</option>
              </select>
            </label>
            <label>
              Vorschau-Schrift
              <select value={layout.previewFontSize} onChange={(e) => updateLayout({ previewFontSize: e.target.value })}>
                <option value="small">Klein</option>
                <option value="normal">Normal</option>
                <option value="large">Gross</option>
              </select>
            </label>
            <label>
              Druckmodus
              <select value={layout.printMode || "image"} onChange={(e) => updateLayout({ printMode: e.target.value })}>
                <option value="image">Bildmodus – empfohlen / funktioniert beim PT-210</option>
                <option value="text">Textmodus – Fallback, PT-210 problematisch</option>
              </select>
            </label>
            <label>
              Bildbreite / Rand
              <select value={layout.imagePaddingPx ?? 4} onChange={(e) => updateLayout({ imagePaddingPx: Number(e.target.value) })}>
                <option value={0}>Maximal breit – 0 px Rand</option>
                <option value={4}>Sehr breit – 4 px Rand</option>
                <option value={8}>Breit – 8 px Rand</option>
                <option value={12}>Normal – 12 px Rand</option>
                <option value={16}>Schmal – 16 px Rand</option>
              </select>
            </label>
            <label>
              Druckschrift PT-210
              <select value={layout.textStyle} onChange={(e) => updateLayout({ textStyle: e.target.value })}>
                <option value="normal">Normal – Font A</option>
                <option value="small">Klein – Font B</option>
                <option value="bold">Fett</option>
                <option value="large">Gross – doppelte Höhe</option>
                <option value="largeBold">Gross + Fett</option>
              </select>
            </label>
            <label>
              Zeichensatz / Umlaute
              <select value={layout.codePage} onChange={(e) => updateLayout({ codePage: e.target.value })}>
                <option value="auto">Automatisch – CP858 probieren</option>
                <option value="iso885915">ISO-8859-15 – ESC t 28</option>
                <option value="cp858">CP858 – Euro + Umlaute</option>
                <option value="cp850">CP850 – Multilingual</option>
                <option value="windows1252">Windows-1252</option>
                <option value="pc936">PC936 / GB18030 – laut Drucker-Testblatt</option>
                <option value="replace">Sicher: ä→ae, ö→oe, ü→ue</option>
              </select>
            </label>
            <label>
              Artikelabstand
              <select value={layout.itemSpacing} onChange={(e) => updateLayout({ itemSpacing: e.target.value })}>
                <option value="compact">Kompakt</option>
                <option value="normal">Normal</option>
                <option value="wide">Luftig</option>
              </select>
            </label>
          </div>

          <div className={styles.logoBox}>
            <div className={styles.logoControls}>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={Boolean(layout.printLogo)}
                  onChange={(e) => updateLayout({ printLogo: e.target.checked })}
                />
                Logo oben auf Bon drucken
              </label>

              <label>
                Logo-Breite
                <select value={layout.logoWidthPx || 384} onChange={(e) => updateLayout({ logoWidthPx: Number(e.target.value) })}>
                  <option value={240}>Schmal – 240 px</option>
                  <option value={280}>Mittel – 280 px</option>
                  <option value={320}>Breit – 320 px</option>
                  <option value={360}>Sehr breit – 360 px</option>
                  <option value={384}>Maximal – 384 px</option>
                </select>
              </label>

              <label>
                Logo-Höhe
                <select value={layout.logoMaxHeightPx || 260} onChange={(e) => updateLayout({ logoMaxHeightPx: Number(e.target.value) })}>
                  <option value={130}>Klein – 130 px</option>
                  <option value={180}>Normal – 180 px</option>
                  <option value={220}>Gross – 220 px</option>
                  <option value={260}>Sehr gross – 260 px</option>
                  <option value={320}>Extra gross – 320 px</option>
                  <option value={384}>Maximal – 384 px</option>
                </select>
              </label>

              <input
                ref={logoInputRef}
                className={styles.hiddenFile}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => importLogo(e.target.files?.[0])}
              />
              <div className={styles.actions}>
                <button type="button" className={styles.testBtn} onClick={() => logoInputRef.current?.click()}>Logo auswählen</button>
                <button type="button" className={styles.secondaryBtn} onClick={removeLogo} disabled={!layout.logoDataUrl}>Logo entfernen</button>
              </div>
              <p className={styles.smallHint}>
                Am besten funktioniert ein einfaches Schwarz/Weiss-Logo mit wenig Details. Im Bildmodus wird das Logo direkt in das Bonbild eingebettet. Falls ein altes Logo noch klein wirkt: Logo bitte einmal entfernen, neu auswählen und dann Bonlayout speichern.
              </p>
            </div>
            <div className={styles.logoPreview}>
              {layout.logoDataUrl ? (
                <img src={layout.logoDataUrl} alt="Bonlogo Vorschau" />
              ) : (
                <span>Kein Logo gewählt</span>
              )}
            </div>
          </div>

          <div className={styles.checkGrid}>
            <label><input type="checkbox" checked={layout.showDate} onChange={(e) => updateLayout({ showDate: e.target.checked })} /> Datum/Uhrzeit zeigen</label>
            <label><input type="checkbox" checked={layout.showPayment} onChange={(e) => updateLayout({ showPayment: e.target.checked })} /> Zahlungsart zeigen</label>
            <label><input type="checkbox" checked={layout.showCustomer} onChange={(e) => updateLayout({ showCustomer: e.target.checked })} /> Kunde zeigen</label>
            <label><input type="checkbox" checked={layout.showBalance} onChange={(e) => updateLayout({ showBalance: e.target.checked })} /> Restguthaben zeigen</label>
            <label><input type="checkbox" checked={layout.showItemQuantity} onChange={(e) => updateLayout({ showItemQuantity: e.target.checked })} /> Mengen zeigen</label>
            <label><input type="checkbox" checked={layout.showUnitPrice} onChange={(e) => updateLayout({ showUnitPrice: e.target.checked })} /> Einzelpreise bei Mengen zeigen</label>
          </div>

          <div className={styles.actions}>
            <button onClick={saveLayout}>Bonlayout speichern</button>
            <button className={styles.testBtn} onClick={testCharset} disabled={printing}>Umlaut-/Bild-Test drucken</button>
            <button className={styles.secondaryBtn} onClick={resetLayout}>Standard wiederherstellen</button>
            <button className={styles.testBtn} onClick={printPreview}>Vorschau lokal drucken</button>
          </div>
        </section>

        <section className={`${styles.section} ${styles.previewSection}`}>
          <div>
            <h2>Live-Vorschau</h2>
            <p>Die Vorschau prüft Lesbarkeit und Zeilenumbrüche. Im Bildmodus werden Umlaute als Pixel gedruckt und sind nicht mehr von der Codepage abhängig.</p>
          </div>
          <div className={styles.receiptPaper}>
            {layout.printLogo && layout.logoDataUrl && (
              <img
                className={styles.receiptLogoPreview}
                src={layout.logoDataUrl}
                alt="Bonlogo"
                style={{
                  width: `${Math.round(((layout.logoWidthPx || 384) / 384) * 100)}%`,
                  maxHeight: `${Math.max(22, Math.round(((layout.logoMaxHeightPx || 260) / 384) * 58))}mm`,
                }}
              />
            )}
            <pre className={`${styles.receiptPreview} ${styles[`font_${layout.previewFontSize}`] || styles.font_normal}`}>{previewText}</pre>
          </div>
        </section>

        {msg.text && (
          <div className={`${styles.msg} ${msg.type === "err" ? styles.msgErr : styles.msgOk}`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
