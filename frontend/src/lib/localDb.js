const DB_KEY = "kasseLocalDbV1";

const DEFAULT_PAYMENT_SETTINGS = {
  enabled: { nfc: false, qr: true, bleNfc: true, manual: true },
  default: "bleNfc",
};

const DEFAULT_PRINTER_SETTINGS = { enabled: false, address: "", name: "" };

const DEFAULT_RECEIPT_LAYOUT_SETTINGS = {
  shopName: "Noemi's Lädeli",
  subtitle: "Kassenzettel",
  footerText: "Danke fürs Einkaufen!",
  lineWidth: 32,
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

const DEMO_ARTICLES = [
  ["Apfel", 0.50, "🍎"], ["Banane", 0.30, "🍌"], ["Erdbeeren", 1.80, "🍓"], ["Trauben", 2.20, "🍇"],
  ["Orange", 0.70, "🍊"], ["Zitrone", 0.40, "🍋"], ["Birne", 0.60, "🍐"], ["Mango", 1.50, "🥭"],
  ["Wassermelone", 3.90, "🍉"], ["Kiwi", 0.80, "🥝"], ["Rüebli", 0.40, "🥕"], ["Tomate", 0.50, "🍅"],
  ["Gurke", 0.90, "🥒"], ["Peperoni", 0.80, "🫑"], ["Broccoli", 1.20, "🥦"], ["Salat", 1.10, "🥬"],
  ["Milch", 1.10, "🥛"], ["Butter", 1.80, "🧈"], ["Käse", 2.50, "🧀"], ["Joghurt", 0.90, "🥣"],
  ["Brot", 1.20, "🍞"], ["Brötli", 0.30, "🥖"], ["Gipfeli", 1.00, "🥐"], ["Kuchen", 2.80, "🍰"],
  ["Wasser", 0.50, "💧"], ["Apfelsaft", 1.50, "🧃"], ["Schoggi", 1.30, "🍫"], ["Gummibärli", 0.90, "🐻"],
  ["Guetzli", 1.50, "🍪"], ["Glace", 1.20, "🍡"], ["Honig", 3.50, "🍯"], ["Konfitüre", 2.20, "🍓"],
];

function nowIso() {
  return new Date().toISOString();
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function makeInitialDb() {
  const articles = DEMO_ARTICLES.map(([name, price, emoji], index) => ({
    id: index + 1,
    name,
    price,
    image: null,
    emoji,
    hidden: 0,
    created_at: nowIso(),
  }));

  return {
    version: 1,
    nextIds: {
      article: articles.length + 1,
      customer: 1,
      token: 1,
      transaction: 1,
      saleItem: 1,
    },
    articles,
    customers: [],
    tokens: [],
    transactions: [],
    saleItems: [],
    settings: {
      payment: DEFAULT_PAYMENT_SETTINGS,
      printer: DEFAULT_PRINTER_SETTINGS,
      receiptLayout: DEFAULT_RECEIPT_LAYOUT_SETTINGS,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normalizeDb(parsed);
    }
  } catch {}
  const fresh = makeInitialDb();
  writeDb(fresh);
  return fresh;
}

function normalizeDb(db) {
  const fresh = makeInitialDb();
  const next = {
    ...fresh,
    ...db,
    nextIds: { ...fresh.nextIds, ...(db?.nextIds || {}) },
    settings: { ...fresh.settings, ...(db?.settings || {}) },
  };
  next.articles = Array.isArray(next.articles) ? next.articles : [];
  next.customers = Array.isArray(next.customers) ? next.customers : [];
  next.tokens = Array.isArray(next.tokens) ? next.tokens : [];
  next.transactions = Array.isArray(next.transactions) ? next.transactions : [];
  next.saleItems = Array.isArray(next.saleItems) ? next.saleItems : [];
  if (!next.settings.payment) next.settings.payment = DEFAULT_PAYMENT_SETTINGS;
  if (!next.settings.printer) next.settings.printer = DEFAULT_PRINTER_SETTINGS;
  if (!next.settings.receiptLayout) next.settings.receiptLayout = DEFAULT_RECEIPT_LAYOUT_SETTINGS;
  if (!next.nextIds.saleItem) {
    next.nextIds.saleItem = Math.max(0, ...next.saleItems.map((x) => Number(x.id) || 0)) + 1;
  }
  return next;
}

function writeDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function withDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getCustomerWithTokens(db, customerId) {
  const id = Number(customerId);
  const customer = db.customers.find((c) => Number(c.id) === id);
  if (!customer) return null;
  const tokens = db.tokens
    .filter((t) => Number(t.customer_id) === id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
  return { ...clone(customer), tokens: clone(tokens) };
}

function findCustomerByToken(db, value) {
  const raw = String(value || "");
  const exact = db.tokens.find((t) => t.active && t.value === raw);
  if (exact) return getCustomerWithTokens(db, exact.customer_id);

  const upper = raw.toUpperCase();
  const nfc = db.tokens.find((t) => t.active && t.type === "nfc" && String(t.value).toUpperCase() === upper);
  if (nfc) return getCustomerWithTokens(db, nfc.customer_id);

  return null;
}

function lookupCustomer(db, identifier) {
  const id = decodeURIComponent(String(identifier || ""));
  let customer = findCustomerByToken(db, id);
  if (!customer && /^\d+$/.test(id)) customer = getCustomerWithTokens(db, Number(id));
  if (!customer) {
    const byName = db.customers.find((c) => String(c.name).toLowerCase() === id.toLowerCase());
    if (byName) customer = getCustomerWithTokens(db, byName.id);
  }
  return customer;
}

function tokenExists(db, type, value, exceptTokenId = null) {
  const normalized = type === "nfc" ? String(value).toUpperCase() : String(value);
  return db.tokens.some((t) => {
    if (exceptTokenId && Number(t.id) === Number(exceptTokenId)) return false;
    if (type === "nfc" && t.type === "nfc") return String(t.value).toUpperCase() === normalized;
    return t.value === normalized;
  });
}

async function fileToDataUrl(file) {
  if (!file || typeof FileReader === "undefined" || typeof Blob === "undefined" || !(file instanceof Blob)) return null;
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function parseBody(options = {}) {
  if (!options.body) return {};
  if (typeof FormData !== "undefined" && options.body instanceof FormData) {
    const imageFile = options.body.get("image");
    return {
      name: options.body.get("name"),
      price: options.body.get("price"),
      image: imageFile ? await fileToDataUrl(imageFile) : null,
    };
  }
  if (typeof options.body === "string") {
    try { return JSON.parse(options.body); } catch { return {}; }
  }
  return options.body || {};
}

function listArticles(db, params) {
  const includeHidden = params.get("includeHidden") === "1";
  const letter = params.get("letter");
  let articles = db.articles.slice();
  if (!includeHidden) articles = articles.filter((a) => !a.hidden);
  if (letter && letter !== "ALL") {
    articles = articles.filter((a) => String(a.name || "").toUpperCase().startsWith(letter.toUpperCase()));
  }
  articles.sort((a, b) => String(a.name).localeCompare(String(b.name), "de-CH", { sensitivity: "base" }));
  return clone(articles);
}

function listCustomers(db) {
  return db.customers
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "de-CH", { sensitivity: "base" }))
    .map((c) => getCustomerWithTokens(db, c.id));
}

function sanitizePrinterSettings(input = {}) {
  return {
    enabled: input.enabled === true,
    address: String(input.address || "").slice(0, 120),
    name: String(input.name || "").slice(0, 120),
  };
}

function sanitizeReceiptLayoutSettings(input = {}) {
  const merged = { ...DEFAULT_RECEIPT_LAYOUT_SETTINGS, ...(input || {}) };
  const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  const numOneOf = (value, allowed, fallback) => {
    const n = Number(value);
    return allowed.includes(n) ? n : fallback;
  };
  return {
    ...merged,
    shopName: String(merged.shopName || "").slice(0, 40),
    subtitle: String(merged.subtitle || "").slice(0, 40),
    footerText: String(merged.footerText || "").slice(0, 60),
    lineWidth: numOneOf(merged.lineWidth, [28, 30, 32], DEFAULT_RECEIPT_LAYOUT_SETTINGS.lineWidth),
    previewFontSize: oneOf(merged.previewFontSize, ["small", "normal", "large"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.previewFontSize),
    itemSpacing: oneOf(merged.itemSpacing, ["compact", "normal", "wide"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.itemSpacing),
    printMode: oneOf(merged.printMode, ["image", "text"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.printMode),
    imagePaddingPx: numOneOf(merged.imagePaddingPx, [0, 4, 8, 12, 16], DEFAULT_RECEIPT_LAYOUT_SETTINGS.imagePaddingPx),
    textStyle: oneOf(merged.textStyle, ["normal", "small", "bold", "large", "largeBold"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.textStyle),
    codePage: oneOf(merged.codePage, ["auto", "iso885915", "cp858", "cp850", "windows1252", "pc936", "gb18030", "replace"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.codePage),
    printLogo: merged.printLogo === true,
    logoDataUrl: String(merged.logoDataUrl || "").startsWith("data:image/") ? String(merged.logoDataUrl) : "",
    logoWidthPx: numOneOf(merged.logoWidthPx, [240, 280, 320, 360, 384], DEFAULT_RECEIPT_LAYOUT_SETTINGS.logoWidthPx),
    logoMaxHeightPx: numOneOf(merged.logoMaxHeightPx, [130, 180, 220, 260, 320, 384], DEFAULT_RECEIPT_LAYOUT_SETTINGS.logoMaxHeightPx),
    showDate: merged.showDate !== false,
    showPayment: merged.showPayment !== false,
    showCustomer: merged.showCustomer !== false,
    showBalance: merged.showBalance !== false,
    showItemQuantity: merged.showItemQuantity !== false,
    showUnitPrice: merged.showUnitPrice !== false,
  };
}

function normalizeCheckoutItems(body = {}) {
  const raw = Array.isArray(body.line_items) ? body.line_items : [];
  if (raw.length) {
    return raw.map((item) => {
      const quantity = Math.max(1, Math.round(Number(item.qty ?? item.quantity ?? 1)));
      const unitPrice = money(Number(item.unit_price ?? item.price ?? 0));
      const name = String(item.name || item.article_name || "Artikel").trim() || "Artikel";
      return {
        article_id: item.article_id != null ? Number(item.article_id) : null,
        article_name: name.slice(0, 120),
        quantity,
        unit_price: unitPrice,
        total: money(unitPrice * quantity),
      };
    }).filter((item) => item.article_name);
  }
  return String(body.items || "").split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^(.*?)\s+x(\d+)$/i);
    return {
      article_id: null,
      article_name: ((m ? m[1] : part).trim() || "Artikel").slice(0, 120),
      quantity: m ? Math.max(1, Number(m[2])) : 1,
      unit_price: 0,
      total: 0,
    };
  });
}

function parseItemsFromTransactionNote(note) {
  const raw = String(note || "").replace(/^Einkauf:\s*/i, "");
  if (!raw.trim()) return [];
  return raw.split(",").map((part) => {
    const clean = part.trim();
    const m = clean.match(/^(.*?)\s+x(\d+)$/i);
    return {
      article_name: ((m ? m[1] : clean).trim() || "Artikel"),
      quantity: m ? Math.max(1, Number(m[2])) : 1,
      unit_price: 0,
      total: 0,
      legacy: true,
    };
  }).filter((x) => x.article_name);
}

export function isLocalDbAvailable() {
  try {
    const test = "__kasse_local_test__";
    localStorage.setItem(test, "1");
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

export function exportLocalData() {
  return JSON.stringify(readDb(), null, 2);
}

export function importLocalData(jsonText) {
  const parsed = JSON.parse(jsonText);
  const normalized = normalizeDb(parsed);
  writeDb(normalized);
  return normalized;
}

export function resetLocalData() {
  const fresh = makeInitialDb();
  writeDb(fresh);
  return fresh;
}

export async function localApiFetch(path, options = {}) {
  const url = new URL(path.startsWith("http") ? path : `http://local${path}`);
  const pathname = url.pathname;
  const method = String(options.method || "GET").toUpperCase();

  try {
    // Einstellungen
    if (pathname === "/api/settings/payment" && method === "GET") {
      const db = readDb();
      return jsonResponse(db.settings.payment || DEFAULT_PAYMENT_SETTINGS);
    }

    if (pathname === "/api/settings/payment" && method === "PUT") {
      const body = await parseBody(options);
      const data = withDb((db) => {
        const enabled = { ...DEFAULT_PAYMENT_SETTINGS.enabled, ...(body.enabled || {}) };
        let def = body.default || DEFAULT_PAYMENT_SETTINGS.default;
        if (!enabled[def]) def = ["bleNfc", "qr", "manual", "nfc"].find((m) => enabled[m]) || "manual";
        db.settings.payment = { enabled, default: def };
        return db.settings.payment;
      });
      return jsonResponse(data);
    }

    if (pathname === "/api/settings/printer" && method === "GET") {
      const db = readDb();
      return jsonResponse(sanitizePrinterSettings(db.settings.printer || DEFAULT_PRINTER_SETTINGS));
    }

    if (pathname === "/api/settings/printer" && method === "PUT") {
      const body = await parseBody(options);
      const data = withDb((db) => {
        db.settings.printer = sanitizePrinterSettings(body);
        return db.settings.printer;
      });
      return jsonResponse(data);
    }

    if (pathname === "/api/settings/receipt-layout" && method === "GET") {
      const db = readDb();
      return jsonResponse(sanitizeReceiptLayoutSettings(db.settings.receiptLayout || DEFAULT_RECEIPT_LAYOUT_SETTINGS));
    }

    if (pathname === "/api/settings/receipt-layout" && method === "PUT") {
      const body = await parseBody(options);
      const data = withDb((db) => {
        db.settings.receiptLayout = sanitizeReceiptLayoutSettings(body);
        return db.settings.receiptLayout;
      });
      return jsonResponse(data);
    }

    // Artikel
    if (pathname === "/api/articles" && method === "GET") {
      const db = readDb();
      return jsonResponse(listArticles(db, url.searchParams));
    }

    if (pathname === "/api/articles" && method === "POST") {
      const body = await parseBody(options);
      const name = String(body.name || "").trim();
      const price = positiveNumber(body.price);
      if (!name || price === null) return jsonResponse({ error: "Name und ein gültiger Preis (> 0) sind erforderlich" }, 400);
      const article = withDb((db) => {
        const next = {
          id: db.nextIds.article++,
          name,
          price: money(price),
          image: body.image || null,
          emoji: body.image ? null : "🛍️",
          hidden: 0,
          created_at: nowIso(),
        };
        db.articles.push(next);
        return next;
      });
      return jsonResponse(article);
    }

    const articleMatch = pathname.match(/^\/api\/articles\/(\d+)$/);
    if (articleMatch && method === "PUT") {
      const id = Number(articleMatch[1]);
      const body = await parseBody(options);
      const result = withDb((db) => {
        const article = db.articles.find((a) => Number(a.id) === id);
        if (!article) return null;
        if (body.name != null) article.name = String(body.name).trim() || article.name;
        if (body.price != null) {
          const price = positiveNumber(body.price);
          if (price === null) return { error: "Ungültiger Preis (muss > 0 sein)", status: 400 };
          article.price = money(price);
        }
        if (body.image) article.image = body.image;
        return article;
      });
      if (!result) return jsonResponse({ error: "not found" }, 404);
      if (result.error) return jsonResponse({ error: result.error }, result.status || 400);
      return jsonResponse(result);
    }

    if (articleMatch && method === "DELETE") {
      const id = Number(articleMatch[1]);
      withDb((db) => { db.articles = db.articles.filter((a) => Number(a.id) !== id); });
      return jsonResponse({ success: true });
    }

    const visibilityMatch = pathname.match(/^\/api\/articles\/(\d+)\/visibility$/);
    if (visibilityMatch && method === "PUT") {
      const id = Number(visibilityMatch[1]);
      const body = await parseBody(options);
      const result = withDb((db) => {
        const article = db.articles.find((a) => Number(a.id) === id);
        if (!article) return null;
        article.hidden = body.hidden ? 1 : 0;
        return { id, hidden: article.hidden };
      });
      if (!result) return jsonResponse({ error: "not found" }, 404);
      return jsonResponse(result);
    }

    // Kunden
    if (pathname === "/api/customers" && method === "GET") {
      const db = readDb();
      return jsonResponse(listCustomers(db));
    }

    if (pathname === "/api/customers" && method === "POST") {
      const body = await parseBody(options);
      const name = String(body.name || "").trim();
      if (!name) return jsonResponse({ error: "Name ist erforderlich" }, 400);
      const startBalance = nonNegativeNumber(body.balance || 0);
      if (startBalance === null) return jsonResponse({ error: "Ungültiges Startguthaben" }, 400);

      const result = withDb((db) => {
        const tokensToAdd = [];
        if (body.nfc_uid) tokensToAdd.push({ type: "nfc", value: String(body.nfc_uid).toUpperCase() });
        if (body.qr_code) tokensToAdd.push({ type: "qr", value: String(body.qr_code) });
        if (tokensToAdd.some((t) => tokenExists(db, t.type, t.value))) return { error: "NFC-UID oder QR-Code wird bereits verwendet", status: 409 };

        const customer = { id: db.nextIds.customer++, name, balance: money(startBalance), created_at: nowIso() };
        db.customers.push(customer);
        tokensToAdd.forEach((t) => db.tokens.push({
          id: db.nextIds.token++, customer_id: customer.id, type: t.type, value: t.value, active: 1, created_at: nowIso(),
        }));
        return getCustomerWithTokens(db, customer.id);
      });
      if (result.error) return jsonResponse({ error: result.error }, result.status || 400);
      return jsonResponse(result);
    }

    const customerMatch = pathname.match(/^\/api\/customers\/(\d+)$/);
    if (customerMatch && method === "GET") {
      const db = readDb();
      const customer = getCustomerWithTokens(db, Number(customerMatch[1]));
      if (!customer) return jsonResponse({ error: "Kunde nicht gefunden" }, 404);
      return jsonResponse(customer);
    }

    if (customerMatch && method === "PUT") {
      const id = Number(customerMatch[1]);
      const body = await parseBody(options);
      const customer = withDb((db) => {
        const c = db.customers.find((x) => Number(x.id) === id);
        if (!c) return null;
        if (body.name) c.name = String(body.name).trim();
        return getCustomerWithTokens(db, id);
      });
      if (!customer) return jsonResponse({ error: "Kunde nicht gefunden" }, 404);
      return jsonResponse(customer);
    }

    if (customerMatch && method === "DELETE") {
      const id = Number(customerMatch[1]);
      withDb((db) => {
        db.customers = db.customers.filter((c) => Number(c.id) !== id);
        db.tokens = db.tokens.filter((t) => Number(t.customer_id) !== id);
        const txIds = new Set(db.transactions.filter((t) => Number(t.customer_id) === id).map((t) => Number(t.id)));
        db.transactions = db.transactions.filter((t) => Number(t.customer_id) !== id);
        db.saleItems = db.saleItems.filter((item) => !txIds.has(Number(item.transaction_id)));
      });
      return jsonResponse({ success: true });
    }

    const clearTransactionsMatch = pathname.match(/^\/api\/customers\/(\d+)\/transactions$/);
    if (clearTransactionsMatch && method === "DELETE") {
      const id = Number(clearTransactionsMatch[1]);
      const result = withDb((db) => {
        if (!db.customers.some((c) => Number(c.id) === id)) return null;
        const txIds = new Set(db.transactions.filter((t) => Number(t.customer_id) === id).map((t) => Number(t.id)));
        db.transactions = db.transactions.filter((t) => Number(t.customer_id) !== id);
        db.saleItems = db.saleItems.filter((item) => !txIds.has(Number(item.transaction_id)));
        return { success: true };
      });
      if (!result) return jsonResponse({ error: "Kunde nicht gefunden" }, 404);
      return jsonResponse(result);
    }

    const tokenAddMatch = pathname.match(/^\/api\/customers\/(\d+)\/tokens$/);
    if (tokenAddMatch && method === "POST") {
      const customerId = Number(tokenAddMatch[1]);
      const body = await parseBody(options);
      const type = body.type;
      const value = type === "nfc" ? String(body.value || "").toUpperCase() : String(body.value || "");
      if (!["nfc", "qr"].includes(type) || !value) return jsonResponse({ error: "type und value sind erforderlich" }, 400);
      const result = withDb((db) => {
        if (!db.customers.some((c) => Number(c.id) === customerId)) return { error: "Kunde nicht gefunden", status: 404 };
        if (tokenExists(db, type, value)) return { error: "Dieser Wert wird bereits verwendet", status: 409 };
        db.tokens.push({ id: db.nextIds.token++, customer_id: customerId, type, value, active: 1, created_at: nowIso() });
        return getCustomerWithTokens(db, customerId);
      });
      if (result.error) return jsonResponse({ error: result.error }, result.status || 400);
      return jsonResponse(result);
    }

    const deactivateMatch = pathname.match(/^\/api\/tokens\/(\d+)\/deactivate$/);
    if (deactivateMatch && method === "POST") {
      const tokenId = Number(deactivateMatch[1]);
      const result = withDb((db) => {
        const token = db.tokens.find((t) => Number(t.id) === tokenId);
        if (!token) return null;
        token.active = 0;
        return getCustomerWithTokens(db, token.customer_id);
      });
      if (!result) return jsonResponse({ error: "Token nicht gefunden" }, 404);
      return jsonResponse(result);
    }

    const reactivateMatch = pathname.match(/^\/api\/tokens\/(\d+)\/reactivate$/);
    if (reactivateMatch && method === "POST") {
      const tokenId = Number(reactivateMatch[1]);
      const result = withDb((db) => {
        const token = db.tokens.find((t) => Number(t.id) === tokenId);
        if (!token) return null;
        if (tokenExists(db, token.type, token.value, token.id)) return { error: "Dieser Wert wird bereits verwendet", status: 409 };
        token.active = 1;
        return getCustomerWithTokens(db, token.customer_id);
      });
      if (!result) return jsonResponse({ error: "Token nicht gefunden" }, 404);
      if (result.error) return jsonResponse({ error: result.error }, result.status || 400);
      return jsonResponse(result);
    }

    const deleteTokenMatch = pathname.match(/^\/api\/tokens\/(\d+)$/);
    if (deleteTokenMatch && method === "DELETE") {
      const tokenId = Number(deleteTokenMatch[1]);
      const result = withDb((db) => {
        const token = db.tokens.find((t) => Number(t.id) === tokenId);
        if (!token) return null;
        db.tokens = db.tokens.filter((t) => Number(t.id) !== tokenId);
        return getCustomerWithTokens(db, token.customer_id);
      });
      if (!result) return jsonResponse({ error: "Token nicht gefunden" }, 404);
      return jsonResponse(result);
    }

    const lookupMatch = pathname.match(/^\/api\/lookup\/(.+)$/);
    if (lookupMatch && method === "GET") {
      const db = readDb();
      const customer = lookupCustomer(db, lookupMatch[1]);
      if (!customer) return jsonResponse({ error: "Kein Kunde mit dieser Karte/QR-Code/Name gefunden" }, 404);
      return jsonResponse(customer);
    }

    const topupMatch = pathname.match(/^\/api\/customers\/(\d+)\/topup$/);
    if (topupMatch && method === "POST") {
      const customerId = Number(topupMatch[1]);
      const body = await parseBody(options);
      const amount = positiveNumber(body.amount);
      if (amount === null) return jsonResponse({ error: "Ungültiger Betrag" }, 400);
      const result = withDb((db) => {
        const customer = db.customers.find((c) => Number(c.id) === customerId);
        if (!customer) return null;
        const rounded = money(amount);
        customer.balance = money(customer.balance + rounded);
        db.transactions.push({
          id: db.nextIds.transaction++, customer_id: customerId, amount: rounded, type: "topup", note: "Aufladung", created_at: nowIso(),
        });
        return getCustomerWithTokens(db, customerId);
      });
      if (!result) return jsonResponse({ error: "Kunde nicht gefunden" }, 404);
      return jsonResponse(result);
    }

    if (pathname === "/api/checkout" && method === "POST") {
      const body = await parseBody(options);
      const identifier = body.card_uid;
      const total = positiveNumber(body.total);
      if (!identifier || total === null) return jsonResponse({ error: "card_uid und ein gültiger Betrag (> 0) sind erforderlich" }, 400);
      const result = withDb((db) => {
        const customer = lookupCustomer(db, identifier);
        if (!customer) return { error: "Karte nicht gefunden", status: 404 };
        const fresh = db.customers.find((c) => Number(c.id) === Number(customer.id));
        const rounded = money(total);
        if (fresh.balance < rounded) return { error: "Guthaben zu niedrig", status: 402, balance: fresh.balance };
        fresh.balance = money(fresh.balance - rounded);
        const lineItems = normalizeCheckoutItems(body);
        const noteItems = lineItems.length ? lineItems.map((item) => `${item.article_name} x${item.quantity}`).join(", ") : String(body.items || "");
        const createdAt = nowIso();
        const tx = {
          id: db.nextIds.transaction++, customer_id: fresh.id, amount: rounded, type: "purchase", note: `Einkauf: ${noteItems}`, created_at: createdAt,
        };
        db.transactions.push(tx);
        lineItems.forEach((item) => {
          db.saleItems.push({
            id: db.nextIds.saleItem++,
            transaction_id: tx.id,
            customer_id: fresh.id,
            article_id: item.article_id,
            article_name: item.article_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
            sold_at: createdAt,
          });
        });
        return { success: true, new_balance: fresh.balance, customer_name: fresh.name };
      });
      if (result.error) return jsonResponse({ error: result.error, balance: result.balance }, result.status || 400);
      return jsonResponse(result);
    }

    if (pathname === "/api/transactions" && method === "GET") {
      const db = readDb();
      const customerId = url.searchParams.get("customer_id");
      let rows = db.transactions.slice();
      if (customerId) rows = rows.filter((t) => Number(t.customer_id) === Number(customerId));
      rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id));
      return jsonResponse(clone(rows.slice(0, 100)));
    }

    if (pathname === "/api/statistics/sales" && method === "GET") {
      const db = readDb();
      const days = Number(url.searchParams.get("days") || 0);
      const since = Number.isFinite(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
      let sales = db.transactions.filter((t) => t.type === "purchase");
      if (since) sales = sales.filter((t) => new Date(t.created_at).getTime() >= since);
      sales.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id));
      sales = sales.slice(0, 500).map((tx) => {
        const customer = db.customers.find((c) => Number(c.id) === Number(tx.customer_id));
        const items = db.saleItems.filter((item) => Number(item.transaction_id) === Number(tx.id));
        return {
          ...clone(tx),
          customer_name: customer?.name || "Gelöschter Kunde",
          items: clone(items.length ? items : parseItemsFromTransactionNote(tx.note)),
        };
      });

      const summaryMap = new Map();
      let totalQuantity = 0;
      sales.forEach((tx) => {
        (tx.items || []).forEach((item) => {
          const key = String(item.article_id || item.article_name || "Artikel").toLowerCase();
          const prev = summaryMap.get(key) || {
            article_id: item.article_id || null,
            article_name: item.article_name || "Artikel",
            quantity: 0,
            total_amount: 0,
            sales_count: 0,
            first_sold_at: tx.created_at,
            last_sold_at: tx.created_at,
          };
          const qty = Math.max(0, Number(item.quantity || 0));
          prev.quantity += qty;
          prev.total_amount = money(prev.total_amount + Number(item.total || 0));
          prev.sales_count += 1;
          if (String(tx.created_at) < String(prev.first_sold_at)) prev.first_sold_at = tx.created_at;
          if (String(tx.created_at) > String(prev.last_sold_at)) prev.last_sold_at = tx.created_at;
          summaryMap.set(key, prev);
          totalQuantity += qty;
        });
      });
      const summary = [...summaryMap.values()].sort((a, b) => b.quantity - a.quantity || String(a.article_name).localeCompare(String(b.article_name), "de-CH"));
      return jsonResponse({
        totals: { sales_count: sales.length, article_quantity: totalQuantity, revenue: money(sales.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)) },
        summary,
        sales,
      });
    }

    return jsonResponse({ error: `Lokaler Endpunkt nicht unterstützt: ${method} ${pathname}` }, 404);
  } catch (err) {
    return jsonResponse({ error: err?.message || "Lokaler Datenfehler" }, 500);
  }
}
