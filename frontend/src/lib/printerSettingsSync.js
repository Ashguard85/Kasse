import { apiFetch } from "./api";
import {
  getPrinterSettings,
  getReceiptLayoutSettings,
  setPrinterSettings,
  setReceiptLayoutSettings,
} from "./escposPrinter";

export async function loadPrinterSettingsFromApi() {
  const result = { printer: null, layout: null };
  try {
    const res = await apiFetch("/api/settings/printer");
    if (res.ok) {
      const data = await res.json();
      const current = getPrinterSettings();
      const hasServerPrinter = Boolean(data?.enabled || data?.address || data?.name);
      const hasLocalPrinter = Boolean(current?.enabled || current?.address || current?.name);
      if (hasServerPrinter || !hasLocalPrinter) {
        result.printer = setPrinterSettings(data);
      }
    }
  } catch {
    // offline / Server nicht erreichbar: lokale Werte behalten
  }

  try {
    const res = await apiFetch("/api/settings/receipt-layout");
    if (res.ok) {
      const data = await res.json();
      result.layout = setReceiptLayoutSettings(data);
    }
  } catch {
    // offline / Server nicht erreichbar: lokale Werte behalten
  }

  return result;
}

export async function savePrinterSettingsToApi(settings = getPrinterSettings()) {
  const local = setPrinterSettings(settings);
  try {
    const res = await apiFetch("/api/settings/printer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local),
    });
    if (res.ok) return setPrinterSettings(await res.json());
  } catch {
    // lokale Speicherung bleibt erhalten
  }
  return local;
}

export async function saveReceiptLayoutToApi(layout = getReceiptLayoutSettings()) {
  const local = setReceiptLayoutSettings(layout);
  try {
    const res = await apiFetch("/api/settings/receipt-layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local),
    });
    if (res.ok) return setReceiptLayoutSettings(await res.json());
  } catch {
    // lokale Speicherung bleibt erhalten
  }
  return local;
}
