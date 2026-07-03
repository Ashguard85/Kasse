import { Capacitor, registerPlugin } from "@capacitor/core";

const STORAGE_KEY = "kasseEscposPrinterSettings";
const RECEIPT_LAYOUT_KEY = "kasseReceiptLayoutSettings";
const LAST_RECEIPT_KEY = "kasseLastReceiptText";
const DEFAULT_LINE_WIDTH = 32;

const CODE_PAGES = ["auto", "iso885915", "cp858", "cp850", "windows1252", "pc936", "gb18030", "replace"];
const TEXT_STYLES = ["normal", "small", "bold", "large", "largeBold"];
const PRINT_MODES = ["image", "text"];
const RECEIPT_IMAGE_WIDTH_PX = 384;

const DEFAULT_RECEIPT_LAYOUT = {
  shopName: "Noemi's Lädeli",
  subtitle: "Kassenzettel",
  footerText: "Danke fürs Einkaufen!",
  lineWidth: DEFAULT_LINE_WIDTH,
  previewFontSize: "large",
  itemSpacing: "compact",
  printMode: "image",
  imagePaddingPx: 0,
  textStyle: "bold",
  codePage: "auto",
  printLogo: false,
  logoDataUrl: "",
  logoWidthPx: 320,
  logoMaxHeightPx: 320,
  showDate: true,
  showPayment: true,
  showCustomer: true,
  showBalance: true,
  showItemQuantity: true,
  showUnitPrice: true,
};

const NativeEscPosPrinter = registerPlugin("EscPosPrinter");

export function isNativePrinterAvailable() {
  try {
    return Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function getPrinterSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      enabled: Boolean(parsed.enabled),
      address: parsed.address || "",
      name: parsed.name || "",
    };
  } catch {
    return { enabled: false, address: "", name: "" };
  }
}

export function setPrinterSettings(settings) {
  const next = {
    enabled: Boolean(settings?.enabled),
    address: settings?.address || "",
    name: settings?.name || "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("kasse:printer-settings-updated", { detail: next }));
  return next;
}

export function getReceiptLayoutSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECEIPT_LAYOUT_KEY) || "{}");
    return sanitizeReceiptLayout(parsed);
  } catch {
    return { ...DEFAULT_RECEIPT_LAYOUT };
  }
}

export function setReceiptLayoutSettings(layout) {
  const next = sanitizeReceiptLayout(layout);
  localStorage.setItem(RECEIPT_LAYOUT_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("kasse:receipt-layout-updated", { detail: next }));
  return next;
}

export function resetReceiptLayoutSettings() {
  localStorage.removeItem(RECEIPT_LAYOUT_KEY);
  const next = { ...DEFAULT_RECEIPT_LAYOUT };
  window.dispatchEvent(new CustomEvent("kasse:receipt-layout-updated", { detail: next }));
  return next;
}

export function getDefaultReceiptLayoutSettings() {
  return { ...DEFAULT_RECEIPT_LAYOUT };
}

export async function prepareReceiptLogoFromFile(file, maxWidth = 768, maxHeight = 768) {
  if (!file) throw new Error("Keine Logo-Datei ausgewählt.");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("Bitte eine Bilddatei auswählen: PNG, JPG oder WebP.");
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);
  const srcW = Math.max(1, img.naturalWidth || img.width || 1);
  const srcH = Math.max(1, img.naturalHeight || img.height || 1);

  let scale = Math.min(1, maxWidth / srcW);
  if (srcH * scale > maxHeight) scale = maxHeight / srcH;

  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Logo konnte nicht verarbeitet werden.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return canvas.toDataURL("image/png");
}

export function hasReceiptLogo(layout = getReceiptLayoutSettings()) {
  const safeLayout = sanitizeReceiptLayout(layout);
  return Boolean(safeLayout.logoDataUrl);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Logo-Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Logo-Bild konnte nicht geöffnet werden."));
    img.src = src;
  });
}

function receiptLogoBase64(dataUrl = "") {
  const value = String(dataUrl || "");
  const comma = value.indexOf(",");
  if (!value.startsWith("data:image/") || comma < 0) return "";
  return value.slice(comma + 1);
}

export function getLastReceiptText() {
  try {
    return localStorage.getItem(LAST_RECEIPT_KEY) || "";
  } catch {
    return "";
  }
}

export function saveLastReceiptText(text) {
  try {
    localStorage.setItem(LAST_RECEIPT_KEY, text || "");
  } catch {}
}

export async function requestPrinterPermission() {
  if (!isNativePrinterAvailable()) {
    return { granted: false, web: true };
  }
  return NativeEscPosPrinter.requestPrinterPermission();
}

export async function listPairedPrinters() {
  if (!isNativePrinterAvailable()) {
    return [];
  }
  await requestPrinterPermission();
  const result = await NativeEscPosPrinter.listBondedDevices();
  return Array.isArray(result?.devices) ? result.devices : [];
}

export async function printReceiptText(text, settings = getPrinterSettings(), layout = getReceiptLayoutSettings()) {
  if (!settings?.enabled) {
    throw new Error("Bondrucker ist nicht aktiviert.");
  }
  if (!settings?.address) {
    throw new Error("Kein Bondrucker ausgewählt.");
  }
  if (!isNativePrinterAvailable()) {
    throw new Error("Direkter Bluetooth-Druck funktioniert nur in der Android-APK.");
  }
  const safeLayout = sanitizeReceiptLayout(layout);
  await requestPrinterPermission();

  if (safeLayout.printMode === "image") {
    const imageDataUrl = await renderReceiptImageDataUrl(text, safeLayout);
    return NativeEscPosPrinter.printImage({
      address: settings.address,
      imageData: receiptLogoBase64(imageDataUrl),
      widthPx: RECEIPT_IMAGE_WIDTH_PX,
    });
  }

  return NativeEscPosPrinter.printText({
    address: settings.address,
    text: normalizeReceiptForPrinter(text, safeLayout),
    codePage: effectivePrinterCodePage(safeLayout),
    textStyle: safeLayout.textStyle,
    printLogo: Boolean(safeLayout.printLogo && safeLayout.logoDataUrl),
    logoData: receiptLogoBase64(safeLayout.logoDataUrl),
    logoWidthPx: safeLayout.logoWidthPx,
    logoMaxHeightPx: safeLayout.logoMaxHeightPx,
  });
}

export async function renderReceiptImageDataUrl(text, layout = getReceiptLayoutSettings()) {
  const safeLayout = sanitizeReceiptLayout(layout);
  const width = RECEIPT_IMAGE_WIDTH_PX;
  const paddingX = safeLayout.imagePaddingPx;
  const paddingTop = 18;
  const paddingBottom = 24;
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const baseFontSize = safeLayout.previewFontSize === "large" ? 23 : safeLayout.previewFontSize === "small" ? 18 : 20;
  const lineHeight = Math.round(baseFontSize * 1.35);
  const bold = safeLayout.textStyle === "bold" || safeLayout.textStyle === "largeBold";
  const fontWeight = bold ? "700" : "500";
  const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  let logo = null;
  let logoW = 0;
  let logoH = 0;
  if (safeLayout.printLogo && safeLayout.logoDataUrl) {
    try {
      logo = await loadImage(safeLayout.logoDataUrl);
      const maxLogoW = Math.min(width - paddingX * 2, safeLayout.logoWidthPx || 384);
      const maxLogoH = safeLayout.logoMaxHeightPx || 260;
      const srcW = Math.max(1, logo.naturalWidth || logo.width || 1);
      const srcH = Math.max(1, logo.naturalHeight || logo.height || 1);
      const scale = Math.min(maxLogoW / srcW, maxLogoH / srcH);
      logoW = Math.max(1, Math.round(srcW * scale));
      logoH = Math.max(1, Math.round(srcH * scale));
    } catch {
      logo = null;
    }
  }

  const logoBlockHeight = logo ? logoH + 12 : 0;
  const height = Math.max(80, paddingTop + logoBlockHeight + lines.length * lineHeight + paddingBottom);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Bonbild konnte nicht erstellt werden.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let y = paddingTop;
  if (logo) {
    const x = Math.round((width - logoW) / 2);
    ctx.drawImage(logo, x, y, logoW, logoH);
    y += logoH + 12;
  }

  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";
  ctx.font = `${fontWeight} ${baseFontSize}px ${fontFamily}`;

  const maxTextWidth = width - paddingX * 2;
  for (const line of lines) {
    let fontSize = baseFontSize;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    while (ctx.measureText(line).width > maxTextWidth && fontSize > 14) {
      fontSize -= 1;
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    }
    ctx.fillText(line, paddingX, y);
    y += lineHeight;
  }

  return canvas.toDataURL("image/png");
}

export function buildTestReceipt(layout = getReceiptLayoutSettings()) {
  return buildReceiptText({
    items: [
      { name: "Äpfel", qty: 1, price: 1.0 },
      { name: "Müesli", qty: 2, price: 2.5 },
      { name: "Keks", qty: 1, price: 0.8 },
    ],
    total: 6.8,
    paymentMode: "Testdruck",
    customerName: "Noemi Müller",
    newBalance: 12.5,
    paidAt: new Date(),
  }, layout);
}

export function buildCharsetTestReceipt(layout = getReceiptLayoutSettings()) {
  const safeLayout = sanitizeReceiptLayout(layout);
  const width = safeLayout.lineWidth;
  const lines = [];
  lines.push(center("Umlaut-Test", width, safeLayout));
  lines.push(rule(width));
  lines.push(`Zeichensatz: ${codePageLabel(safeLayout.codePage)}`);
  lines.push(`Schrift: ${textStyleLabel(safeLayout.textStyle)}`);
  lines.push("");
  lines.push("Gross: Ä Ö Ü");
  lines.push("Klein:  ä ö ü");
  lines.push("Scharf: ß");
  lines.push("Akzente: é è à");
  lines.push("Euro: €");
  lines.push("CHF 12.50");
  lines.push("");
  lines.push(center("Wenn das sauber aussieht,", width, safeLayout));
  lines.push(center("Einstellung speichern.", width, safeLayout));
  lines.push("");
  return lines.map((line) => receiptClean(line, safeLayout)).join("\n");
}

export async function printTestReceipt(settings = getPrinterSettings(), layout = getReceiptLayoutSettings()) {
  return printReceiptText(buildTestReceipt(layout), settings, layout);
}

export async function printCharsetTestReceipt(settings = getPrinterSettings(), layout = getReceiptLayoutSettings()) {
  return printReceiptText(buildCharsetTestReceipt(layout), settings, layout);
}

export function openReceiptPreview() {
  window.open("/bon-layout-test.html", "_blank", "noopener,noreferrer");
}

export function buildReceiptText(
  { items = [], total = 0, paymentMode = "", customerName = "", newBalance, paidAt = new Date() },
  layout = getReceiptLayoutSettings()
) {
  const safeLayout = sanitizeReceiptLayout(layout);
  const width = safeLayout.lineWidth;
  const date = paidAt instanceof Date ? paidAt : new Date(paidAt);
  const lines = [];

  if (safeLayout.shopName) lines.push(center(safeLayout.shopName, width, safeLayout));
  if (safeLayout.subtitle) lines.push(center(safeLayout.subtitle, width, safeLayout));
  if (safeLayout.shopName || safeLayout.subtitle) lines.push(rule(width));
  if (safeLayout.showDate) lines.push(formatDateTime(date));
  lines.push("");

  items.forEach((item, index) => {
    const qty = Number(item.qty || 1);
    const price = Number(item.price || 0);
    const name = receiptClean(item.name || "Artikel", safeLayout);
    const right = money(price * qty);
    let left = name;

    if (safeLayout.showItemQuantity && qty > 1) {
      left = `${qty}x ${name}`;
    }

    lines.push(twoCols(left, right, width, safeLayout));

    if (safeLayout.showUnitPrice && qty > 1) {
      lines.push(receiptClean(`  à CHF ${money(price)}`, safeLayout));
    }

    if (safeLayout.itemSpacing === "wide" && index < items.length - 1) {
      lines.push("");
    }
  });

  if (safeLayout.itemSpacing === "normal") lines.push("");
  lines.push(rule(width));
  lines.push(twoCols("Total CHF", money(total), width, safeLayout));
  lines.push("");

  if (safeLayout.showPayment && paymentMode) lines.push(receiptClean(`Zahlung: ${paymentLabel(paymentMode)}`, safeLayout));
  if (safeLayout.showCustomer && customerName) lines.push(receiptClean(`Kunde: ${customerName}`, safeLayout));
  if (safeLayout.showBalance && newBalance !== undefined && newBalance !== null && !Number.isNaN(Number(newBalance))) {
    lines.push(receiptClean(`Restguthaben: CHF ${money(Number(newBalance))}`, safeLayout));
  }

  if (safeLayout.footerText) {
    lines.push("");
    lines.push(center(safeLayout.footerText, width, safeLayout));
  }
  lines.push("");
  return lines.join("\n");
}

function sanitizeReceiptLayout(layout = {}) {
  const lineWidth = Number(layout.lineWidth);
  const previewFontSize = ["small", "normal", "large"].includes(layout.previewFontSize)
    ? layout.previewFontSize
    : DEFAULT_RECEIPT_LAYOUT.previewFontSize;
  const itemSpacing = ["compact", "normal", "wide"].includes(layout.itemSpacing)
    ? layout.itemSpacing
    : DEFAULT_RECEIPT_LAYOUT.itemSpacing;
  const printMode = PRINT_MODES.includes(layout.printMode)
    ? layout.printMode
    : DEFAULT_RECEIPT_LAYOUT.printMode;
  const textStyle = TEXT_STYLES.includes(layout.textStyle)
    ? layout.textStyle
    : DEFAULT_RECEIPT_LAYOUT.textStyle;
  const codePage = CODE_PAGES.includes(layout.codePage)
    ? layout.codePage
    : DEFAULT_RECEIPT_LAYOUT.codePage;
  const imagePaddingPx = [0, 4, 8, 12, 16].includes(Number(layout.imagePaddingPx))
    ? Number(layout.imagePaddingPx)
    : DEFAULT_RECEIPT_LAYOUT.imagePaddingPx;
  const logoWidthPx = [240, 280, 320, 360, 384].includes(Number(layout.logoWidthPx))
    ? Number(layout.logoWidthPx)
    : DEFAULT_RECEIPT_LAYOUT.logoWidthPx;
  const logoMaxHeightPx = [130, 180, 220, 260, 320, 384].includes(Number(layout.logoMaxHeightPx))
    ? Number(layout.logoMaxHeightPx)
    : DEFAULT_RECEIPT_LAYOUT.logoMaxHeightPx;

  return {
    ...DEFAULT_RECEIPT_LAYOUT,
    ...layout,
    shopName: String(layout.shopName ?? DEFAULT_RECEIPT_LAYOUT.shopName).slice(0, 40),
    subtitle: String(layout.subtitle ?? DEFAULT_RECEIPT_LAYOUT.subtitle).slice(0, 40),
    footerText: String(layout.footerText ?? DEFAULT_RECEIPT_LAYOUT.footerText).slice(0, 60),
    lineWidth: [28, 30, 32].includes(lineWidth) ? lineWidth : DEFAULT_LINE_WIDTH,
    previewFontSize,
    itemSpacing,
    printMode,
    imagePaddingPx,
    textStyle,
    codePage,
    printLogo: Boolean(layout.printLogo ?? DEFAULT_RECEIPT_LAYOUT.printLogo),
    logoDataUrl: String(layout.logoDataUrl ?? "").startsWith("data:image/")
      ? String(layout.logoDataUrl ?? "")
      : "",
    logoWidthPx,
    logoMaxHeightPx,
    showDate: Boolean(layout.showDate ?? DEFAULT_RECEIPT_LAYOUT.showDate),
    showPayment: Boolean(layout.showPayment ?? DEFAULT_RECEIPT_LAYOUT.showPayment),
    showCustomer: Boolean(layout.showCustomer ?? DEFAULT_RECEIPT_LAYOUT.showCustomer),
    showBalance: Boolean(layout.showBalance ?? DEFAULT_RECEIPT_LAYOUT.showBalance),
    showItemQuantity: Boolean(layout.showItemQuantity ?? DEFAULT_RECEIPT_LAYOUT.showItemQuantity),
    showUnitPrice: Boolean(layout.showUnitPrice ?? DEFAULT_RECEIPT_LAYOUT.showUnitPrice),
  };
}

function paymentLabel(mode) {
  const map = {
    nfc: "NFC-Karte",
    qr: "QR-Code",
    bleNfc: "NFC-Box",
    manual: "Name manuell",
  };
  return map[mode] || String(mode || "");
}

function formatDateTime(date) {
  try {
    return date.toLocaleString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date().toLocaleString();
  }
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function rule(width = DEFAULT_LINE_WIDTH) {
  return "-".repeat(width);
}

function center(text, width = DEFAULT_LINE_WIDTH, layout = getReceiptLayoutSettings()) {
  const clean = clip(receiptClean(text, layout), width);
  const pad = Math.max(0, Math.floor((width - clean.length) / 2));
  return `${" ".repeat(pad)}${clean}`;
}

function twoCols(left, right, width = DEFAULT_LINE_WIDTH, layout = getReceiptLayoutSettings()) {
  const cleanRight = receiptClean(right, layout);
  const maxLeft = Math.max(1, width - cleanRight.length - 1);
  const cleanLeft = clip(receiptClean(left, layout), maxLeft);
  const spaces = Math.max(1, width - cleanLeft.length - cleanRight.length);
  return `${cleanLeft}${" ".repeat(spaces)}${cleanRight}`;
}

function clip(text, max) {
  const clean = String(text || "");
  if (clean.length <= max) return clean;
  if (max <= 3) return clean.slice(0, max);
  return clean.slice(0, Math.max(0, max - 3)) + "...";
}

function receiptClean(value, layout = getReceiptLayoutSettings()) {
  const safeLayout = sanitizeReceiptLayout(layout);
  const basic = String(value || "")
    .replace(/–|—/g, "-")
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/CHF\s*/gi, "CHF ")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "");
  return safeLayout.codePage === "replace" ? asciiClean(basic) : basic;
}

function asciiClean(value) {
  return String(value || "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/é/g, "e").replace(/è/g, "e").replace(/ê/g, "e")
    .replace(/à/g, "a").replace(/á/g, "a")
    .replace(/€/g, "EUR")
    .replace(/–|—/g, "-")
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/CHF\s*/gi, "CHF ");
}

function normalizeReceiptForPrinter(text, layout = getReceiptLayoutSettings()) {
  const safeLayout = sanitizeReceiptLayout(layout);
  return receiptClean(text, safeLayout)
    .split("\n")
    .map((line) => line.length > DEFAULT_LINE_WIDTH ? line.slice(0, DEFAULT_LINE_WIDTH) : line)
    .join("\n");
}

function effectivePrinterCodePage(layout = getReceiptLayoutSettings()) {
  const safeLayout = sanitizeReceiptLayout(layout);
  if (safeLayout.codePage === "auto") return "cp858";
  if (safeLayout.codePage === "replace") return "cp437";
  if (safeLayout.codePage === "gb18030") return "pc936";
  if (safeLayout.codePage === "iso885915") return "iso885915";
  return safeLayout.codePage;
}

function codePageLabel(codePage) {
  const labels = {
    auto: "Automatisch (CP858)",
    iso885915: "ISO-8859-15",
    cp858: "CP858 Euro",
    cp850: "CP850 Multilingual",
    windows1252: "Windows-1252",
    pc936: "PC936 / GB18030",
    gb18030: "GB18030",
    replace: "Umlaute ersetzen",
  };
  return labels[codePage] || codePage;
}

function textStyleLabel(textStyle) {
  const labels = {
    normal: "Normal",
    small: "Klein",
    bold: "Fett",
    large: "Gross",
    largeBold: "Gross + Fett",
  };
  return labels[textStyle] || textStyle;
}
