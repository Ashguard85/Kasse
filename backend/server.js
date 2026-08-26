const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3801;
const DB_PATH = "/app/data/kasse.db";
const UPLOADS_PATH = "/app/data/uploads";

fs.mkdirSync(UPLOADS_PATH, { recursive: true });

// Diagnose-Logging beim Start — hilft beim Debuggen von Volume-Mount-Problemen
console.log(`UPLOADS_PATH: ${UPLOADS_PATH}`);
try {
  const existingUploads = fs.readdirSync(UPLOADS_PATH);
  console.log(`  Enthält bereits ${existingUploads.length} Datei(en)`);
} catch (err) {
  console.log(`  WARNUNG: konnte UPLOADS_PATH nicht lesen: ${err.message}`);
}

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "CF-Access-Client-Id",
    "CF-Access-Client-Secret",
    "Cf-Access-Jwt-Assertion",
    "X-Kasse-Profile-Id",
  ],
}));
app.use(express.json({ limit: "8mb" }));
app.use("/uploads", express.static(UPLOADS_PATH));

// ── Database ──────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON"); // ohne das ignoriert SQLite ON DELETE CASCADE

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    theme_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id),
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT DEFAULT NULL,
    emoji TEXT DEFAULT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Kunden sind profilübergreifend. Aktivierung und Guthaben stehen in customer_profiles.
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customer_profiles (
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(customer_id, profile_id)
  );

  CREATE TABLE IF NOT EXISTS payment_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('nfc','qr')),
    value TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id),
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    article_id INTEGER,
    article_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    sold_at TEXT DEFAULT (datetime('now'))
  );

  -- Profilabhängige Einstellungen (Zahlung, Drucker, Bonlayout).
  CREATE TABLE IF NOT EXISTS profile_settings (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY(profile_id, key)
  );

  -- Legacy-Tabelle bleibt für Abwärtskompatibilität bestehen.
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sale_items_sold_at ON sale_items(sold_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_article_name ON sale_items(article_name);
    CREATE INDEX IF NOT EXISTS idx_transactions_customer_created ON transactions(customer_id, created_at);
  `);
} catch (e) { console.log("Index-Migration skip:", e.message); }


// ── Mehrprofil-Grundlage / kompatible Schema-Erweiterung ─────────────────────
const DEFAULT_THEME = {
  primaryColor: "#1a7a3c",
  primaryDark: "#145c2d",
  accentColor: "#f5c400",
  pageBackground: "#f3f4f6",
  registerBackground: "#f3f4f6",
  bannerBackground: "#1a7a3c",
  bannerTextColor: "#ffffff",
  bannerText: "Willkommen!",
  bannerImageDataUrl: "",
  logoImageDataUrl: "",
  appearanceMode: "light",
  autoContrast: true,
};

function ensureColumn(table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`Migration: ${table}.${column} ergänzt`);
    }
  } catch (e) { console.log(`Migration ${table}.${column} skip:`, e.message); }
}

const profileCount = db.prepare("SELECT COUNT(*) AS c FROM profiles").get();
if (profileCount.c === 0) {
  db.prepare("INSERT INTO profiles (id, name, active, theme_json) VALUES (1, ?, 1, ?)")
    .run("Einkaufsladen", JSON.stringify(DEFAULT_THEME));
}
ensureColumn("articles", "profile_id", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("transactions", "profile_id", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("sale_items", "profile_id", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("customers", "system", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("customers", "payment_pin_hash", "TEXT");
ensureColumn("customers", "payment_pin_salt", "TEXT");
ensureColumn("customers", "payment_pin_mode", "TEXT NOT NULL DEFAULT 'off'");
ensureColumn("customers", "payment_pin_threshold", "REAL NOT NULL DEFAULT 0");

try {
  db.exec(`
    UPDATE articles SET profile_id = 1 WHERE profile_id IS NULL;
    UPDATE transactions SET profile_id = 1 WHERE profile_id IS NULL;
    UPDATE sale_items SET profile_id = 1 WHERE profile_id IS NULL;
    INSERT OR IGNORE INTO customer_profiles (customer_id, profile_id, active, balance)
      SELECT id, 1, 1, COALESCE(balance, 0) FROM customers;
    CREATE INDEX IF NOT EXISTS idx_articles_profile_name ON articles(profile_id, name);
    CREATE INDEX IF NOT EXISTS idx_transactions_profile_created ON transactions(profile_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_profile_sold ON sale_items(profile_id, sold_at);
    CREATE INDEX IF NOT EXISTS idx_customer_profiles_profile ON customer_profiles(profile_id, active);
  `);
} catch (e) { console.log("Mehrprofil-Migration skip:", e.message); }

// Interner Kunde für Barverkäufe. Er wird in der Kundenverwaltung ausgeblendet,
// erlaubt aber weiterhin die bestehende Transaktions-/Statistikstruktur zu nutzen.
try {
  db.prepare("INSERT OR IGNORE INTO customers (id, name, balance, system) VALUES (-1, 'Barverkauf', 0, 1)").run();
} catch (e) { console.log("Barverkauf-Systemkunde skip:", e.message); }

function hashPaymentPin(pin, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return { salt: salt.toString("hex"), hash };
}
function pinRequiredForCustomer(customer, total) {
  if (!customer?.payment_pin_hash || customer.payment_pin_mode === "off") return false;
  if (customer.payment_pin_mode === "always") return true;
  if (customer.payment_pin_mode === "threshold") return Number(total) >= Number(customer.payment_pin_threshold || 0);
  return false;
}
function verifyPaymentPin(customer, pin) {
  if (!customer?.payment_pin_hash || !customer?.payment_pin_salt) return false;
  if (!/^\d{4,8}$/.test(String(pin || ""))) return false;
  const candidate = hashPaymentPin(String(pin), customer.payment_pin_salt).hash;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(customer.payment_pin_hash, "hex"));
  } catch { return false; }
}

function sanitizeProfileId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getDefaultProfile() {
  return db.prepare("SELECT * FROM profiles WHERE active = 1 ORDER BY id LIMIT 1").get()
    || db.prepare("SELECT * FROM profiles ORDER BY id LIMIT 1").get();
}

function getProfileId(req) {
  const requested = sanitizeProfileId(req.get("X-Kasse-Profile-Id") || req.query.profile_id || req.body?.profile_id);
  if (requested) {
    const found = db.prepare("SELECT id FROM profiles WHERE id = ? AND active = 1").get(requested);
    if (found) return found.id;
  }
  return getDefaultProfile()?.id || 1;
}

// ── Migration von altem Schema (nfc_cards) falls vorhanden ───────────────────
try {
  const oldTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='nfc_cards'"
  ).get();
  if (oldTableExists) {
    const old = db.prepare("SELECT * FROM nfc_cards").all();
    const insCustomer = db.prepare("INSERT INTO customers (name, balance) VALUES (?, ?)");
    const insToken = db.prepare("INSERT INTO payment_tokens (customer_id, type, value, active) VALUES (?, ?, ?, 1)");
    old.forEach(row => {
      const cust = insCustomer.run(row.label, row.balance);
      db.prepare("INSERT OR IGNORE INTO customer_profiles (customer_id, profile_id, active, balance) VALUES (?, 1, 1, ?)").run(cust.lastInsertRowid, row.balance || 0);
      if (row.uid) insToken.run(cust.lastInsertRowid, "nfc", row.uid);
      if (row.qr_code) insToken.run(cust.lastInsertRowid, "qr", row.qr_code);
    });
    db.exec("ALTER TABLE nfc_cards RENAME TO nfc_cards_old_migrated");
    console.log(`Migrated ${old.length} old cards into customers/payment_tokens`);
  }
} catch (e) { console.log("Migration skip:", e.message); }

// ── Migration: emoji-Spalte ergänzen, falls eine ältere DB ohne sie existiert ──
try {
  const cols = db.prepare("PRAGMA table_info(articles)").all();
  const hasEmoji = cols.some((c) => c.name === "emoji");
  if (!hasEmoji) {
    db.exec("ALTER TABLE articles ADD COLUMN emoji TEXT DEFAULT NULL");
    console.log("Migration: Spalte 'emoji' zu articles hinzugefügt");
  }
} catch (e) { console.log("Emoji-Migration skip:", e.message); }

// ── Migration: hidden-Spalte ergänzen, falls eine ältere DB ohne sie existiert ──
try {
  const cols = db.prepare("PRAGMA table_info(articles)").all();
  const hasHidden = cols.some((c) => c.name === "hidden");
  if (!hasHidden) {
    db.exec("ALTER TABLE articles ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
    console.log("Migration: Spalte 'hidden' zu articles hinzugefügt");
  }
} catch (e) { console.log("Hidden-Migration skip:", e.message); }

// Seed demo articles
const count = db.prepare("SELECT COUNT(*) as c FROM articles WHERE profile_id = 1").get();
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO articles (profile_id, name, price, image, emoji) VALUES (1, ?, ?, ?, ?)");
  const demos = [
    ["Apfel", 0.50, "🍎"], ["Banane", 0.30, "🍌"], ["Erdbeeren", 1.80, "🍓"], ["Trauben", 2.20, "🍇"],
    ["Orange", 0.70, "🍊"], ["Zitrone", 0.40, "🍋"], ["Birne", 0.60, "🍐"], ["Mango", 1.50, "🥭"],
    ["Wassermelone", 3.90, "🍉"], ["Kiwi", 0.80, "🥝"], ["Rüebli", 0.40, "🥕"], ["Tomate", 0.50, "🍅"],
    ["Gurke", 0.90, "🥒"], ["Peperoni", 0.80, "🫑"], ["Broccoli", 1.20, "🥦"], ["Salat", 1.10, "🥬"],
    ["Zwiebel", 0.30, "🧅"], ["Knoblauch", 0.50, "🧄"], ["Mais", 0.70, "🌽"], ["Kartoffel", 0.60, "🥔"],
    ["Milch", 1.10, "🥛"], ["Butter", 1.80, "🧈"], ["Käse", 2.50, "🧀"], ["Joghurt", 0.90, "🥣"],
    ["Eier (6 Stk)", 2.00, "🥚"], ["Rahm", 1.20, "🍦"], ["Brot", 1.20, "🍞"], ["Brötli", 0.30, "🥖"],
    ["Gipfeli", 1.00, "🥐"], ["Kuchen", 2.80, "🍰"], ["Wasser", 0.50, "💧"], ["Apfelsaft", 1.50, "🧃"],
    ["Orangensaft", 1.80, "🍹"], ["Cola", 1.20, "🥤"], ["Tee", 2.50, "🍵"], ["Schoggi", 1.30, "🍫"],
    ["Gummibärli", 0.90, "🐻"], ["Guetzli", 1.50, "🍪"], ["Pommes Chips", 1.50, "🥔"], ["Glace", 1.20, "🍡"],
    ["Zucker", 1.00, "🍬"], ["Salz", 0.80, "🧂"], ["Mehl", 0.90, "🌾"], ["Reis", 1.40, "🍚"],
    ["Hörnli", 1.10, "🍝"], ["Olivenöl", 4.50, "🫒"], ["Honig", 3.50, "🍯"], ["Konfitüre", 2.20, "🍓"],
    ["Müesli", 2.80, "🥣"], ["Cornflakes", 2.40, "🥣"], ["Ketchup", 1.60, "🍅"],
  ];
  demos.forEach(([name, price, emoji]) => insert.run(name, price, null, emoji));
  console.log("Seeded 51 demo articles mit Emojis");
}

// ── Emojis nachtragen ──────────────────────────────────────────────────────────
// Falls Artikel schon existieren (alte DB), aber noch kein Emoji haben, wird es
// hier anhand des Namens nachgetragen. Läuft bei jedem Start, überschreibt aber
// keine bereits gesetzten Emojis oder hochgeladene Bilder.
const emojiByName = {
  "Apfel": "🍎", "Banane": "🍌", "Erdbeeren": "🍓", "Trauben": "🍇",
  "Orange": "🍊", "Zitrone": "🍋", "Birne": "🍐", "Mango": "🥭",
  "Wassermelone": "🍉", "Kiwi": "🥝", "Rüebli": "🥕", "Tomate": "🍅",
  "Gurke": "🥒", "Peperoni": "🫑", "Broccoli": "🥦", "Salat": "🥬",
  "Zwiebel": "🧅", "Knoblauch": "🧄", "Mais": "🌽", "Kartoffel": "🥔",
  "Milch": "🥛", "Butter": "🧈", "Käse": "🧀", "Joghurt": "🥣",
  "Eier (6 Stk)": "🥚", "Rahm": "🍦", "Brot": "🍞", "Brötli": "🥖",
  "Gipfeli": "🥐", "Kuchen": "🍰", "Wasser": "💧", "Apfelsaft": "🧃",
  "Orangensaft": "🍹", "Cola": "🥤", "Tee": "🍵", "Schoggi": "🍫",
  "Gummibärli": "🐻", "Guetzli": "🍪", "Pommes Chips": "🥔", "Glace": "🍡",
  "Zucker": "🍬", "Salz": "🧂", "Mehl": "🌾", "Reis": "🍚",
  "Hörnli": "🍝", "Olivenöl": "🫒", "Honig": "🍯", "Konfitüre": "🍓",
  "Müesli": "🥣", "Cornflakes": "🥣", "Ketchup": "🍅",
};

// Migration für bestehende DBs: deutsche Bezeichnungen auf Schweizer Begriffe
// umbenennen. Nur exakte Treffer, und nur wenn der Schweizer Name noch nicht
// existiert (verhindert Duplikate, falls die Migration mehrfach läuft).
const germanToSwiss = {
  "Karotte": "Rüebli", "Paprika": "Peperoni", "Brokkoli": "Broccoli",
  "Sahne": "Rahm", "Brötchen": "Brötli", "Croissant": "Gipfeli",
  "Schokolade": "Schoggi", "Gummibären": "Gummibärli", "Kekse": "Guetzli",
  "Chips": "Pommes Chips", "Eis am Stiel": "Glace", "Nudeln": "Hörnli",
  "Marmelade": "Konfitüre", "Müsli": "Müesli",
};
try {
  const renameStmt = db.prepare("UPDATE articles SET name = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM articles a2 WHERE a2.name = ?)");
  let renamed = 0;
  for (const [de, ch] of Object.entries(germanToSwiss)) {
    const res = renameStmt.run(ch, de, ch);
    renamed += res.changes;
  }
  if (renamed > 0) console.log(`Artikel auf Schweizer Bezeichnungen umbenannt: ${renamed}`);
} catch (e) { console.log("Umbenennung skip:", e.message); }

try {
  const updateEmoji = db.prepare("UPDATE articles SET emoji = ? WHERE name = ? AND (emoji IS NULL OR emoji = '')");
  let emojiPatched = 0;
  for (const [name, emoji] of Object.entries(emojiByName)) {
    const res = updateEmoji.run(emoji, name);
    emojiPatched += res.changes;
  }
  if (emojiPatched > 0) console.log(`Emojis nachgetragen: ${emojiPatched} Artikel`);
} catch (e) { console.log("Emoji-Nachtrag skip:", e.message); }

// ── Image upload ──────────────────────────────────────────────────────────────
// Erlaubt sind alle gängigen Foto-Formate, auch HEIC/HEIF (iPhone-Kamera-
// Standardformat). HEIC kann von Chrome/den meisten Browsern nicht direkt
// angezeigt werden, daher wird JEDES hochgeladene Bild serverseitig zu JPEG
// konvertiert und auf ein einheitliches Quadrat zugeschnitten — das Foto wird
// dabei nicht gestreckt/verzerrt, sondern mittig eingepasst; an den Rändern
// (oben/unten oder links/rechts, je nach Seitenverhältnis) wird eine
// vergrösserte, weichgezeichnete Version desselben Bildes als Hintergrund
// genutzt, ähnlich wie bei Instagram-Story-Hintergründen.
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "image/heic",
  "image/heif",
]);

// iPhones schicken den MIME-Type nicht immer zuverlässig mit — teils kommt
// "application/octet-stream" oder ein leerer Typ. Daher akzeptieren wir
// solche Uploads auch anhand der Dateiendung.
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".heic", ".heif",
]);

// Memory-Storage statt Disk-Storage: sharp braucht den rohen Buffer zur
// Verarbeitung, bevor irgendetwas auf die Festplatte geschrieben wird.
const storage = multer.memoryStorage();

function imageFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mimeOk = ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype);
  const extOk = ALLOWED_IMAGE_EXTENSIONS.has(ext);
  // akzeptieren, wenn ENTWEDER der MIME-Type ODER die Dateiendung passt —
  // deckt auch iPhone-Uploads mit unzuverlässigem MIME-Type ab.
  if (mimeOk || extOk) {
    cb(null, true);
  } else {
    cb(new Error("UNSUPPORTED_IMAGE_TYPE"));
  }
}

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // etwas grosszügiger, da HEIC-Originale grösser sein können
});

// Erkennt HEIC/HEIF anhand der Datei-Signatur (magic bytes), unabhängig vom
// (oft unzuverlässigen) MIME-Type. HEIC-Dateien haben ab Byte 4 die Kennung
// "ftyp" gefolgt von einer Marke wie "heic", "heix", "mif1", "heif".
function isHeicBuffer(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const ftyp = buffer.toString("ascii", 4, 8);
  if (ftyp !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12).toLowerCase();
  return ["heic", "heix", "heif", "mif1", "hevc", "heim", "heis"].includes(brand);
}

// iPhone-Fotos sind oft HEIC (HEVC-Codec). Das vorgebaute sharp-Binary enthält
// aus Lizenzgründen KEINEN HEVC-Decoder — der Versuch, ein HEIC direkt mit
// sharp zu öffnen, schlägt fehl oder hängt. Daher dekodieren wir HEIC zuerst
// mit der reinen-JS-Bibliothek heic-convert zu JPEG, bevor sharp übernimmt.
async function decodeHeicIfNeeded(buffer, mimetype) {
  const looksHeic = mimetype === "image/heic" || mimetype === "image/heif" || isHeicBuffer(buffer);
  if (looksHeic) {
    const heicConvert = require("heic-convert");
    const jpegBuffer = await heicConvert({
      buffer: buffer,
      format: "JPEG",
      quality: 0.92,
    });
    return jpegBuffer;
  }
  return buffer;
}

// Verarbeitet ein hochgeladenes Bild: konvertiert HEIC/HEIF/alles zu JPEG und
// verkleinert es auf eine vernünftige Maximalgrösse, BEHÄLT aber das originale
// Seitenverhältnis bei (kein Beschnitt, kein Strecken). Die Darstellung in der
// Kachel (komplett sichtbar + Blur-Hintergrund) übernimmt das Frontend, damit
// sie sich dynamisch an die jeweilige Kachelform anpasst.
async function processArticleImage(buffer, mimetype) {
  const sharp = require("sharp");

  // HEIC zuerst zu JPEG dekodieren (sharp kann iPhone-HEIC sonst nicht lesen)
  const inputBuffer = await decodeHeicIfNeeded(buffer, mimetype);

  // Auf max. 800px lange Kante verkleinern (ohne Vergrösserung kleiner Bilder),
  // EXIF-Rotation anwenden, als JPEG speichern. Seitenverhältnis bleibt erhalten.
  const processed = await sharp(inputBuffer)
    .rotate()
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return processed;
}

// Zentrale Fehlerbehandlung für Multer-Fehler (falscher Dateityp, zu gross),
// damit das Frontend eine klare, verständliche Meldung statt eines rohen
// Server-Fehlers bekommt.
function handleUploadError(err, req, res, next) {
  if (err) {
    if (err.message === "UNSUPPORTED_IMAGE_TYPE") {
      return res.status(400).json({ error: "Dieses Bildformat wird nicht unterstützt. Erlaubt: JPEG, PNG, WebP, GIF, SVG, AVIF, HEIC." });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Bild ist zu gross (maximal 8 MB)." });
    }
    return res.status(400).json({ error: "Bild konnte nicht hochgeladen werden." });
  }
  next();
}

// Speichert ein verarbeitetes Bild (immer als .jpg, unabhängig vom
// Originalformat) und gibt den relativen Pfad zurück.
async function saveProcessedImage(file) {
  if (!file) return null;
  const processed = await processArticleImage(file.buffer, file.mimetype);
  const filename = `${uuidv4()}.jpg`;
  fs.writeFileSync(path.join(UPLOADS_PATH, filename), processed);
  return `/uploads/${filename}`;
}

// ── Profile und profilabhängige Einstellungen ────────────────────────────────
const VALID_PAY_MODES = ["nfc", "qr", "bleNfc", "manual", "cash"];
const PAYMENT_SETTINGS_KEY = "payment_methods";
const PRINTER_SETTINGS_KEY = "printer_settings";
const RECEIPT_LAYOUT_SETTINGS_KEY = "receipt_layout_settings";
const DRAWER_SETTINGS_KEY = "drawer_settings";

const DEFAULT_PAYMENT_SETTINGS = {
  enabled: { nfc: true, qr: true, bleNfc: true, manual: true, cash: true },
  default: "nfc",
  cashBreakdownEnabled: false,
  customerDisplayEnabled: false,
  customerDisplayType: "esp32",
};
const DEFAULT_PRINTER_SETTINGS = { enabled: false, address: "", name: "", autoConnect: true };
const DEFAULT_DRAWER_SETTINGS = { enabled: false, openOnCash: true };
const DEFAULT_RECEIPT_LAYOUT_SETTINGS = {
  shopName: "Noemi's Lädeli", subtitle: "Kassenzettel", footerText: "Danke fürs Einkaufen!",
  lineWidth: 32, previewFontSize: "large", itemSpacing: "compact", printMode: "image",
  imagePaddingPx: 0, textStyle: "bold", codePage: "auto", printLogo: false, logoDataUrl: "",
  logoWidthPx: 320, logoMaxHeightPx: 320, showDate: true, showPayment: true,
  showCustomer: true, showBalance: true, showItemQuantity: true, showUnitPrice: true,
};

function color(value, fallback) {
  const v = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}
function sanitizeTheme(input = {}) {
  const merged = { ...DEFAULT_THEME, ...(input || {}) };
  return {
    primaryColor: color(merged.primaryColor, DEFAULT_THEME.primaryColor),
    primaryDark: color(merged.primaryDark, DEFAULT_THEME.primaryDark),
    accentColor: color(merged.accentColor, DEFAULT_THEME.accentColor),
    pageBackground: color(merged.pageBackground, DEFAULT_THEME.pageBackground),
    registerBackground: color(merged.registerBackground, DEFAULT_THEME.registerBackground),
    bannerBackground: color(merged.bannerBackground, DEFAULT_THEME.bannerBackground),
    bannerTextColor: color(merged.bannerTextColor, DEFAULT_THEME.bannerTextColor),
    bannerText: String(merged.bannerText || "").slice(0, 120),
    bannerImageDataUrl: String(merged.bannerImageDataUrl || "").startsWith("data:image/") ? String(merged.bannerImageDataUrl) : "",
    logoImageDataUrl: String(merged.logoImageDataUrl || "").startsWith("data:image/") ? String(merged.logoImageDataUrl) : "",
    appearanceMode: merged.appearanceMode === "dark" ? "dark" : "light",
    autoContrast: merged.autoContrast !== false,
  };
}
function profileToJson(row) {
  if (!row) return null;
  let theme = DEFAULT_THEME;
  try { theme = sanitizeTheme(JSON.parse(row.theme_json || "{}")); } catch {}
  return { id: row.id, name: row.name, active: Boolean(row.active), theme, created_at: row.created_at };
}

app.get("/api/profiles", (req, res) => {
  const includeArchived = req.query.includeArchived === "1";
  const rows = db.prepare(`SELECT * FROM profiles ${includeArchived ? "" : "WHERE active = 1"} ORDER BY active DESC, name COLLATE NOCASE`).all();
  res.json(rows.map(profileToJson));
});
app.get("/api/profiles/current", (req, res) => {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(getProfileId(req));
  res.json(profileToJson(row));
});
app.post("/api/profiles", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Profilname ist erforderlich" });
  const theme = sanitizeTheme(req.body?.theme || { ...DEFAULT_THEME, bannerText: name });
  const result = db.prepare("INSERT INTO profiles (name, active, theme_json) VALUES (?, 1, ?)").run(name.slice(0, 80), JSON.stringify(theme));
  saveJsonSetting(result.lastInsertRowid, RECEIPT_LAYOUT_SETTINGS_KEY, { ...DEFAULT_RECEIPT_LAYOUT_SETTINGS, shopName: name.slice(0, 40) });
  res.status(201).json(profileToJson(db.prepare("SELECT * FROM profiles WHERE id = ?").get(result.lastInsertRowid)));
});
app.put("/api/profiles/:id", (req, res) => {
  const id = sanitizeProfileId(req.params.id);
  const row = id && db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Profil nicht gefunden" });
  const name = req.body?.name == null ? row.name : String(req.body.name).trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Profilname ist erforderlich" });
  const active = req.body?.active == null ? row.active : (req.body.active ? 1 : 0);
  if (!active) {
    const other = db.prepare("SELECT COUNT(*) AS c FROM profiles WHERE active = 1 AND id <> ?").get(id);
    if (!other.c) return res.status(400).json({ error: "Mindestens ein Profil muss aktiv bleiben" });
  }
  let currentTheme = DEFAULT_THEME;
  try { currentTheme = JSON.parse(row.theme_json || "{}"); } catch {}
  const theme = sanitizeTheme(req.body?.theme == null ? currentTheme : req.body.theme);
  db.prepare("UPDATE profiles SET name = ?, active = ?, theme_json = ? WHERE id = ?").run(name, active, JSON.stringify(theme), id);
  res.json(profileToJson(db.prepare("SELECT * FROM profiles WHERE id = ?").get(id)));
});

function getJsonSetting(profileId, key, fallback) {
  const row = db.prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = ?").get(profileId, key);
  if (!row && profileId === 1) {
    const legacy = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    if (legacy) {
      try { return { ...fallback, ...JSON.parse(legacy.value) }; } catch {}
    }
  }
  if (!row) return fallback;
  try { return { ...fallback, ...JSON.parse(row.value) }; } catch { return fallback; }
}
function saveJsonSetting(profileId, key, value) {
  const json = JSON.stringify(value);
  db.prepare("INSERT INTO profile_settings (profile_id, key, value) VALUES (?, ?, ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value")
    .run(profileId, key, json);
  return value;
}
function getPaymentSettings(profileId) {
  const parsed = getJsonSetting(profileId, PAYMENT_SETTINGS_KEY, DEFAULT_PAYMENT_SETTINGS);
  const enabled = {};
  for (const m of VALID_PAY_MODES) enabled[m] = typeof parsed?.enabled?.[m] === "boolean" ? parsed.enabled[m] : true;
  let def = VALID_PAY_MODES.includes(parsed?.default) ? parsed.default : "nfc";
  if (!enabled[def]) def = VALID_PAY_MODES.find((m) => enabled[m]) || "manual";
  return {
    enabled,
    default: def,
    cashBreakdownEnabled: parsed?.cashBreakdownEnabled === true,
    customerDisplayEnabled: parsed?.customerDisplayEnabled === true,
    customerDisplayType: parsed?.customerDisplayType === "device" ? "device" : "esp32",
  };
}
function sanitizeDrawerSettings(input = {}) {
  return { enabled: input.enabled === true, openOnCash: input.openOnCash !== false };
}
function sanitizePrinterSettings(input = {}) {
  return { enabled: input.enabled === true, address: String(input.address || "").slice(0, 120), name: String(input.name || "").slice(0, 120), autoConnect: input.autoConnect !== false };
}
function sanitizeReceiptLayoutSettings(input = {}) {
  const merged = { ...DEFAULT_RECEIPT_LAYOUT_SETTINGS, ...(input || {}) };
  const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  const numOneOf = (value, allowed, fallback) => { const n = Number(value); return allowed.includes(n) ? n : fallback; };
  return {
    ...merged,
    shopName: String(merged.shopName || "").slice(0, 40), subtitle: String(merged.subtitle || "").slice(0, 40),
    footerText: String(merged.footerText || "").slice(0, 60),
    lineWidth: numOneOf(merged.lineWidth, [28,30,32], DEFAULT_RECEIPT_LAYOUT_SETTINGS.lineWidth),
    previewFontSize: oneOf(merged.previewFontSize, ["small","normal","large"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.previewFontSize),
    itemSpacing: oneOf(merged.itemSpacing, ["compact","normal","wide"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.itemSpacing),
    printMode: oneOf(merged.printMode, ["image","text"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.printMode),
    imagePaddingPx: numOneOf(merged.imagePaddingPx, [0,4,8,12,16], DEFAULT_RECEIPT_LAYOUT_SETTINGS.imagePaddingPx),
    textStyle: oneOf(merged.textStyle, ["normal","small","bold","large","largeBold"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.textStyle),
    codePage: oneOf(merged.codePage, ["auto","iso885915","cp858","cp850","windows1252","pc936","gb18030","replace"], DEFAULT_RECEIPT_LAYOUT_SETTINGS.codePage),
    printLogo: merged.printLogo === true,
    logoDataUrl: String(merged.logoDataUrl || "").startsWith("data:image/") ? String(merged.logoDataUrl) : "",
    logoWidthPx: numOneOf(merged.logoWidthPx, [240,280,320,360,384], DEFAULT_RECEIPT_LAYOUT_SETTINGS.logoWidthPx),
    logoMaxHeightPx: numOneOf(merged.logoMaxHeightPx, [130,180,220,260,320,384], DEFAULT_RECEIPT_LAYOUT_SETTINGS.logoMaxHeightPx),
    showDate: merged.showDate !== false, showPayment: merged.showPayment !== false,
    showCustomer: merged.showCustomer !== false, showBalance: merged.showBalance !== false,
    showItemQuantity: merged.showItemQuantity !== false, showUnitPrice: merged.showUnitPrice !== false,
  };
}

app.get("/api/settings/payment", (req, res) => res.json(getPaymentSettings(getProfileId(req))));
app.put("/api/settings/payment", (req, res) => {
  const { enabled, default: def } = req.body || {};
  if (!enabled || typeof enabled !== "object") return res.status(400).json({ error: "enabled-Objekt fehlt" });
  const cleanEnabled = {}; for (const m of VALID_PAY_MODES) cleanEnabled[m] = enabled[m] === true;
  if (!Object.values(cleanEnabled).some(Boolean)) return res.status(400).json({ error: "Mindestens eine Zahlungsmethode muss aktiv sein." });
  if (!VALID_PAY_MODES.includes(def) || !cleanEnabled[def]) return res.status(400).json({ error: "Die Standard-Methode muss aktiviert sein." });
  res.json(saveJsonSetting(getProfileId(req), PAYMENT_SETTINGS_KEY, {
    enabled: cleanEnabled,
    default: def,
    cashBreakdownEnabled: req.body?.cashBreakdownEnabled === true,
    customerDisplayEnabled: req.body?.customerDisplayEnabled === true,
    customerDisplayType: req.body?.customerDisplayType === "device" ? "device" : "esp32",
  }));
});
app.get("/api/settings/drawer", (req, res) => res.json(sanitizeDrawerSettings(getJsonSetting(getProfileId(req), DRAWER_SETTINGS_KEY, DEFAULT_DRAWER_SETTINGS))));
app.put("/api/settings/drawer", (req, res) => res.json(saveJsonSetting(getProfileId(req), DRAWER_SETTINGS_KEY, sanitizeDrawerSettings(req.body || {}))));

app.get("/api/settings/printer", (req, res) => res.json(sanitizePrinterSettings(getJsonSetting(getProfileId(req), PRINTER_SETTINGS_KEY, DEFAULT_PRINTER_SETTINGS))));
app.put("/api/settings/printer", (req, res) => res.json(saveJsonSetting(getProfileId(req), PRINTER_SETTINGS_KEY, sanitizePrinterSettings(req.body || {}))));
app.get("/api/settings/receipt-layout", (req, res) => res.json(sanitizeReceiptLayoutSettings(getJsonSetting(getProfileId(req), RECEIPT_LAYOUT_SETTINGS_KEY, DEFAULT_RECEIPT_LAYOUT_SETTINGS))));
app.put("/api/settings/receipt-layout", (req, res) => res.json(saveJsonSetting(getProfileId(req), RECEIPT_LAYOUT_SETTINGS_KEY, sanitizeReceiptLayoutSettings(req.body || {}))));


// ── Articles (profilabhängig) ───────────────────────────────────────────────
app.get("/api/articles", (req, res) => {
  const profileId = getProfileId(req);
  const { letter, includeHidden } = req.query;
  const conditions = ["profile_id = ?"];
  const params = [profileId];
  if (letter && letter !== "ALL") { conditions.push("UPPER(name) LIKE ?"); params.push(`${letter.toUpperCase()}%`); }
  if (includeHidden !== "1") conditions.push("hidden = 0");
  const query = `SELECT * FROM articles WHERE ${conditions.join(" AND ")} ORDER BY name COLLATE NOCASE ASC`;
  res.json(db.prepare(query).all(...params));
});
app.put("/api/articles/:id/visibility", (req, res) => {
  const profileId = getProfileId(req);
  const article = db.prepare("SELECT * FROM articles WHERE id = ? AND profile_id = ?").get(req.params.id, profileId);
  if (!article) return res.status(404).json({ error: "not found" });
  const hidden = req.body?.hidden ? 1 : 0;
  db.prepare("UPDATE articles SET hidden = ? WHERE id = ? AND profile_id = ?").run(hidden, req.params.id, profileId);
  res.json({ id: Number(req.params.id), hidden });
});
app.post("/api/articles", upload.single("image"), handleUploadError, async (req, res) => {
  const profileId = getProfileId(req);
  const { name, price } = req.body;
  const validPrice = positiveNumber(price);
  if (!name || validPrice === null) return res.status(400).json({ error: "Name und ein gültiger Preis (> 0) sind erforderlich" });
  try {
    const image = await saveProcessedImage(req.file);
    const result = db.prepare("INSERT INTO articles (profile_id, name, price, image) VALUES (?, ?, ?, ?)").run(profileId, name, validPrice, image);
    res.json({ id: result.lastInsertRowid, profile_id: profileId, name, price: validPrice, image });
  } catch (err) { console.error("Bildverarbeitung fehlgeschlagen:", err.message); res.status(400).json({ error: "Bild konnte nicht verarbeitet werden. Bitte ein anderes Foto versuchen." }); }
});
app.put("/api/articles/:id", upload.single("image"), handleUploadError, async (req, res) => {
  const profileId = getProfileId(req);
  const { name, price } = req.body;
  const article = db.prepare("SELECT * FROM articles WHERE id = ? AND profile_id = ?").get(req.params.id, profileId);
  if (!article) return res.status(404).json({ error: "not found" });
  let newPrice = article.price;
  if (price != null) { const validPrice = positiveNumber(price); if (validPrice === null) return res.status(400).json({ error: "Ungültiger Preis (muss > 0 sein)" }); newPrice = validPrice; }
  try {
    const image = req.file ? await saveProcessedImage(req.file) : article.image;
    db.prepare("UPDATE articles SET name = ?, price = ?, image = ? WHERE id = ? AND profile_id = ?").run(name ?? article.name, newPrice, image, req.params.id, profileId);
    res.json({ success: true });
  } catch (err) { console.error("Bildverarbeitung fehlgeschlagen:", err.message); res.status(400).json({ error: "Bild konnte nicht verarbeitet werden. Bitte ein anderes Foto versuchen." }); }
});
app.delete("/api/articles/:id", (req, res) => {
  db.prepare("DELETE FROM articles WHERE id = ? AND profile_id = ?").run(req.params.id, getProfileId(req));
  res.json({ success: true });
});

// ── Helpers / Kunden (global, Status + Guthaben pro Profil) ───────────────────
function positiveNumber(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function nonNegativeNumber(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function money(value) { return Math.round(Number(value) * 100) / 100; }

function ensureCustomerProfile(customerId, profileId, { active = 0, balance = 0 } = {}) {
  db.prepare("INSERT OR IGNORE INTO customer_profiles (customer_id, profile_id, active, balance) VALUES (?, ?, ?, ?)")
    .run(customerId, profileId, active ? 1 : 0, money(balance));
}
function getCustomerWithTokens(customerId, profileId = 1) {
  const customer = db.prepare(`
    SELECT c.id, c.name, c.created_at,
           c.payment_pin_mode, c.payment_pin_threshold,
           CASE WHEN c.payment_pin_hash IS NOT NULL AND c.payment_pin_hash <> '' THEN 1 ELSE 0 END AS payment_pin_configured,
           COALESCE(cp.balance, 0) AS balance,
           COALESCE(cp.active, 0) AS profile_active
    FROM customers c
    LEFT JOIN customer_profiles cp ON cp.customer_id = c.id AND cp.profile_id = ?
    WHERE c.id = ?
  `).get(profileId, customerId);
  if (!customer) return null;
  const tokens = db.prepare("SELECT * FROM payment_tokens WHERE customer_id = ? ORDER BY created_at, id").all(customerId);
  return {
    ...customer,
    profile_active: Boolean(customer.profile_active),
    payment_pin_configured: Boolean(customer.payment_pin_configured),
    payment_pin_mode: ["always","threshold"].includes(customer.payment_pin_mode) ? customer.payment_pin_mode : "off",
    payment_pin_threshold: money(customer.payment_pin_threshold || 0),
    tokens,
  };
}
function findCustomerByToken(value, profileId) {
  const exact = db.prepare("SELECT * FROM payment_tokens WHERE value = ? AND active = 1").get(value);
  const token = exact || db.prepare("SELECT * FROM payment_tokens WHERE type = 'nfc' AND UPPER(value) = UPPER(?) AND active = 1").get(value);
  if (!token) return null;
  const customer = getCustomerWithTokens(token.customer_id, profileId);
  return customer?.profile_active ? customer : null;
}
function lookupCustomer(identifier, profileId) {
  const id = String(identifier || "");
  let customer = findCustomerByToken(id, profileId);
  if (!customer && /^\d+$/.test(id)) customer = getCustomerWithTokens(Number(id), profileId);
  if (!customer) {
    const row = db.prepare("SELECT id FROM customers WHERE name = ? COLLATE NOCASE").get(id);
    if (row) customer = getCustomerWithTokens(row.id, profileId);
  }
  return customer?.profile_active ? customer : null;
}

app.get("/api/customers", (req, res) => {
  const profileId = getProfileId(req);
  const rows = db.prepare("SELECT id FROM customers WHERE COALESCE(system, 0) = 0 ORDER BY name COLLATE NOCASE").all();
  res.json(rows.map((r) => getCustomerWithTokens(r.id, profileId)));
});
app.post("/api/customers", (req, res) => {
  const profileId = getProfileId(req);
  const { name, balance = 0, nfc_uid, qr_code } = req.body;
  if (!name) return res.status(400).json({ error: "Name ist erforderlich" });
  const startBalance = nonNegativeNumber(balance);
  if (startBalance === null) return res.status(400).json({ error: "Ungültiges Startguthaben" });
  try {
    const customer = db.transaction(() => {
      const result = db.prepare("INSERT INTO customers (name, balance) VALUES (?, 0)").run(String(name).trim());
      const id = result.lastInsertRowid;
      db.prepare("INSERT INTO customer_profiles (customer_id, profile_id, active, balance) VALUES (?, ?, 1, ?)").run(id, profileId, money(startBalance));
      if (nfc_uid) db.prepare("INSERT INTO payment_tokens (customer_id, type, value) VALUES (?, 'nfc', ?)").run(id, String(nfc_uid).toUpperCase());
      if (qr_code) db.prepare("INSERT INTO payment_tokens (customer_id, type, value) VALUES (?, 'qr', ?)").run(id, qr_code);
      return getCustomerWithTokens(id, profileId);
    })();
    res.json(customer);
  } catch (e) { res.status(409).json({ error: "NFC-UID oder QR-Code wird bereits verwendet" }); }
});
app.get("/api/customers/:id", (req, res) => {
  const customer = getCustomerWithTokens(req.params.id, getProfileId(req));
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  res.json(customer);
});
app.put("/api/customers/:id", (req, res) => {
  const profileId = getProfileId(req);
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  db.prepare("UPDATE customers SET name = ? WHERE id = ?").run(req.body?.name ?? customer.name, req.params.id);
  res.json(getCustomerWithTokens(req.params.id, profileId));
});
app.put("/api/customers/:id/payment-pin", (req, res) => {
  const profileId = getProfileId(req);
  const customer = db.prepare("SELECT * FROM customers WHERE id = ? AND COALESCE(system,0)=0").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  const mode = ["off","always","threshold"].includes(req.body?.mode) ? req.body.mode : "off";
  const threshold = mode === "threshold" ? nonNegativeNumber(req.body?.threshold) : 0;
  if (mode === "threshold" && threshold === null) return res.status(400).json({ error: "Ungültiger PIN-Grenzbetrag" });

  if (mode === "off") {
    db.prepare("UPDATE customers SET payment_pin_mode='off', payment_pin_hash=NULL, payment_pin_salt=NULL, payment_pin_threshold=0 WHERE id=?").run(customer.id);
  } else {
    const pin = String(req.body?.pin || "");
    if (pin && !/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: "PIN muss aus 4 bis 8 Ziffern bestehen" });
    if (!pin && !customer.payment_pin_hash) return res.status(400).json({ error: "Bitte einen PIN festlegen" });
    if (pin) {
      const secured = hashPaymentPin(pin);
      db.prepare("UPDATE customers SET payment_pin_mode=?, payment_pin_threshold=?, payment_pin_hash=?, payment_pin_salt=? WHERE id=?")
        .run(mode, money(threshold || 0), secured.hash, secured.salt, customer.id);
    } else {
      db.prepare("UPDATE customers SET payment_pin_mode=?, payment_pin_threshold=? WHERE id=?")
        .run(mode, money(threshold || 0), customer.id);
    }
  }
  res.json(getCustomerWithTokens(customer.id, profileId));
});

app.put("/api/customers/:id/profile", (req, res) => {
  const profileId = getProfileId(req);
  const customer = db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  ensureCustomerProfile(customer.id, profileId);
  if (req.body?.active != null) db.prepare("UPDATE customer_profiles SET active = ? WHERE customer_id = ? AND profile_id = ?").run(req.body.active ? 1 : 0, customer.id, profileId);
  if (req.body?.balance != null) {
    const balance = nonNegativeNumber(req.body.balance);
    if (balance === null) return res.status(400).json({ error: "Ungültiges Guthaben" });
    db.prepare("UPDATE customer_profiles SET balance = ? WHERE customer_id = ? AND profile_id = ?").run(money(balance), customer.id, profileId);
  }
  res.json(getCustomerWithTokens(customer.id, profileId));
});
app.delete("/api/customers/:id", (req, res) => { db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id); res.json({ success: true }); });
app.delete("/api/customers/:id/transactions", (req, res) => {
  const profileId = getProfileId(req);
  if (!db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "Kunde nicht gefunden" });
  db.prepare("DELETE FROM transactions WHERE customer_id = ? AND profile_id = ?").run(req.params.id, profileId);
  res.json({ success: true });
});

app.post("/api/customers/:id/tokens", (req, res) => {
  const profileId = getProfileId(req);
  const { type, value } = req.body;
  if (!["nfc","qr"].includes(type) || !value) return res.status(400).json({ error: "type und value sind erforderlich" });
  if (!db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "Kunde nicht gefunden" });
  const normalized = type === "nfc" ? String(value).toUpperCase() : String(value);
  try { db.prepare("INSERT INTO payment_tokens (customer_id, type, value) VALUES (?, ?, ?)").run(req.params.id, type, normalized); res.json(getCustomerWithTokens(req.params.id, profileId)); }
  catch { res.status(409).json({ error: "Dieser Wert wird bereits verwendet" }); }
});
app.post("/api/tokens/:tokenId/deactivate", (req, res) => {
  const token = db.prepare("SELECT * FROM payment_tokens WHERE id = ?").get(req.params.tokenId);
  if (!token) return res.status(404).json({ error: "Token nicht gefunden" });
  db.prepare("UPDATE payment_tokens SET active = 0 WHERE id = ?").run(req.params.tokenId);
  res.json(getCustomerWithTokens(token.customer_id, getProfileId(req)));
});
app.post("/api/tokens/:tokenId/reactivate", (req, res) => {
  const token = db.prepare("SELECT * FROM payment_tokens WHERE id = ?").get(req.params.tokenId);
  if (!token) return res.status(404).json({ error: "Token nicht gefunden" });
  db.prepare("UPDATE payment_tokens SET active = 1 WHERE id = ?").run(req.params.tokenId);
  res.json(getCustomerWithTokens(token.customer_id, getProfileId(req)));
});
app.delete("/api/tokens/:tokenId", (req, res) => {
  const token = db.prepare("SELECT * FROM payment_tokens WHERE id = ?").get(req.params.tokenId);
  if (!token) return res.status(404).json({ error: "Token nicht gefunden" });
  db.prepare("DELETE FROM payment_tokens WHERE id = ?").run(req.params.tokenId);
  res.json(getCustomerWithTokens(token.customer_id, getProfileId(req)));
});
app.get("/api/lookup/:identifier", (req, res) => {
  const customer = lookupCustomer(req.params.identifier, getProfileId(req));
  if (!customer) return res.status(404).json({ error: "Kunde ist in diesem Profil nicht aktiv oder wurde nicht gefunden" });
  res.json(customer);
});
app.post("/api/customer-selfservice/pin", (req, res) => {
  const profileId = getProfileId(req);
  const identifier = String(req.body?.identifier || "");
  const action = String(req.body?.action || "");
  const customer = lookupCustomer(identifier, profileId);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  const raw = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
  if (!raw) return res.status(404).json({ error: "Kunde nicht gefunden" });

  const currentPin = String(req.body?.current_pin || "");
  const newPin = String(req.body?.new_pin || "");

  if (action === "set") {
    if (raw.payment_pin_hash && !verifyPaymentPin(raw, currentPin)) {
      return res.status(403).json({ error: "Aktueller PIN ist falsch", pin_invalid: true });
    }
    if (!/^\d{4,8}$/.test(newPin)) return res.status(400).json({ error: "Neuer PIN muss 4–8 Ziffern haben" });
    const secured = hashPaymentPin(newPin);
    const mode = ["always","threshold"].includes(raw.payment_pin_mode) ? raw.payment_pin_mode : "always";
    db.prepare("UPDATE customers SET payment_pin_mode=?, payment_pin_hash=?, payment_pin_salt=? WHERE id=?")
      .run(mode, secured.hash, secured.salt, raw.id);
  } else if (action === "disable") {
    if (!raw.payment_pin_hash) return res.status(409).json({ error: "Für diesen Kunden ist kein PIN eingerichtet" });
    if (!verifyPaymentPin(raw, currentPin)) return res.status(403).json({ error: "Aktueller PIN ist falsch", pin_invalid: true });
    db.prepare("UPDATE customers SET payment_pin_mode='off', payment_pin_hash=NULL, payment_pin_salt=NULL, payment_pin_threshold=0 WHERE id=?").run(raw.id);
  } else {
    return res.status(400).json({ error: "Unbekannte Aktion" });
  }

  res.json(getCustomerWithTokens(raw.id, profileId));
});

app.post("/api/customers/:id/topup", (req, res) => {
  const profileId = getProfileId(req);
  const amount = positiveNumber(req.body.amount);
  if (amount === null) return res.status(400).json({ error: "Ungültiger Betrag" });
  const customer = getCustomerWithTokens(req.params.id, profileId);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  if (!customer.profile_active) return res.status(409).json({ error: "Kunde ist in diesem Profil nicht aktiv" });
  db.transaction(() => {
    db.prepare("UPDATE customer_profiles SET balance = ROUND((balance + ?) * 100) / 100 WHERE customer_id = ? AND profile_id = ?").run(money(amount), req.params.id, profileId);
    db.prepare("INSERT INTO transactions (profile_id, customer_id, amount, type, note) VALUES (?, ?, ?, 'topup', 'Aufladung')").run(profileId, req.params.id, money(amount));
  })();
  res.json(getCustomerWithTokens(req.params.id, profileId));
});


function normalizeCheckoutItems(body) {
  const raw = Array.isArray(body?.line_items) ? body.line_items : [];
  if (raw.length) {
    return raw
      .map((item) => {
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
      })
      .filter((item) => item.quantity > 0 && item.article_name);
  }

  // Fallback für ältere APK/Webapp-Versionen: "Apfel x2, Saft x1" aus dem Notiztext lesen.
  return String(body?.items || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s+x(\d+)$/i);
      const articleName = (m ? m[1] : part).trim() || "Artikel";
      const quantity = m ? Math.max(1, Number(m[2])) : 1;
      return { article_id: null, article_name: articleName.slice(0, 120), quantity, unit_price: 0, total: 0 };
    });
}

// ── Checkout — accepts NFC uid, QR code, or customer id ──────────────────────
// atomare DB-Transaktion mit erneuter Balance-Prüfung innerhalb der Transaktion,
// damit zwei nahezu gleichzeitige Zahlungen nicht doppelt abbuchen können.
app.post("/api/checkout", (req, res) => {
  const profileId = getProfileId(req);
  const { card_uid, items } = req.body;
  const rawTotal = positiveNumber(req.body.total);
  if (!card_uid || rawTotal === null) return res.status(400).json({ error: "card_uid und ein gültiger Betrag (> 0) sind erforderlich" });
  const total = money(rawTotal);
  const customer = lookupCustomer(card_uid, profileId);
  if (!customer) return res.status(404).json({ error: "Kunde ist in diesem Profil nicht aktiv oder wurde nicht gefunden" });
  const rawPinCustomer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
  if (pinRequiredForCustomer(rawPinCustomer, total) && !verifyPaymentPin(rawPinCustomer, req.body?.payment_pin)) {
    return res.status(428).json({
      error: req.body?.payment_pin ? "PIN falsch" : "PIN erforderlich",
      pin_required: true,
      pin_invalid: Boolean(req.body?.payment_pin),
      customer_name: customer.name,
      customer_id: customer.id,
    });
  }
  try {
    const newBalance = db.transaction(() => {
      const fresh = db.prepare("SELECT balance, active FROM customer_profiles WHERE customer_id = ? AND profile_id = ?").get(customer.id, profileId);
      if (!fresh?.active) throw Object.assign(new Error("INACTIVE_CUSTOMER"), { balance: fresh?.balance || 0 });
      if (fresh.balance < total) throw Object.assign(new Error("INSUFFICIENT_BALANCE"), { balance: fresh.balance });
      const nextBalance = money(fresh.balance - total);
      db.prepare("UPDATE customer_profiles SET balance = ? WHERE customer_id = ? AND profile_id = ?").run(nextBalance, customer.id, profileId);
      const lineItems = normalizeCheckoutItems(req.body);
      const noteItems = lineItems.length ? lineItems.map((item) => `${item.article_name} x${item.quantity}`).join(", ") : String(items || "");
      const tx = db.prepare("INSERT INTO transactions (profile_id, customer_id, amount, type, note) VALUES (?, ?, ?, 'purchase', ?)").run(profileId, customer.id, total, `Einkauf: ${noteItems}`);
      const ins = db.prepare("INSERT INTO sale_items (profile_id, transaction_id, customer_id, article_id, article_name, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      lineItems.forEach((item) => ins.run(profileId, tx.lastInsertRowid, customer.id, item.article_id, item.article_name, item.quantity, item.unit_price, item.total));
      return nextBalance;
    })();
    res.json({ success: true, new_balance: newBalance, customer_name: customer.name });
  } catch (e) {
    if (e.message === "INSUFFICIENT_BALANCE") return res.status(402).json({ error: "Guthaben zu niedrig", balance: e.balance });
    if (e.message === "INACTIVE_CUSTOMER") return res.status(409).json({ error: "Kunde ist in diesem Profil nicht aktiv", balance: e.balance });
    throw e;
  }
});


// ── Kassenschublade (flüchtiger OPEN-Befehl) ────────────────────────────────
let drawerCommandVersion = 0;
app.post("/api/drawer/open", (req, res) => {
  const settings = sanitizeDrawerSettings(getJsonSetting(getProfileId(req), DRAWER_SETTINGS_KEY, DEFAULT_DRAWER_SETTINGS));
  if (!settings.enabled) return res.status(409).json({ error: "Kassenschublade ist deaktiviert" });
  drawerCommandVersion += 1;
  res.json({ success: true, version: drawerCommandVersion, command: "OPEN" });
});
app.get("/api/drawer/command", (req, res) => {
  res.json({ version: drawerCommandVersion, command: drawerCommandVersion > 0 ? "OPEN" : "" });
});

// ── Barzahlung ────────────────────────────────────────────────────────────────
app.post("/api/checkout/cash", (req, res) => {
  const profileId = getProfileId(req);
  const rawTotal = positiveNumber(req.body?.total);
  const rawTendered = Number(req.body?.tendered);
  if (rawTotal === null) return res.status(400).json({ error: "Ein gültiger Betrag (> 0) ist erforderlich" });
  if (!Number.isFinite(rawTendered) || rawTendered < rawTotal) return res.status(400).json({ error: "Gegebener Betrag ist zu klein" });
  const total = money(rawTotal);
  const tendered = money(rawTendered);
  const change = money(tendered - total);
  const lineItems = normalizeCheckoutItems(req.body);
  const itemsText = lineItems.length ? lineItems.map((item) => `${item.article_name} x${item.quantity}`).join(", ") : String(req.body?.items || "");

  const txId = db.transaction(() => {
    const tx = db.prepare("INSERT INTO transactions (profile_id, customer_id, amount, type, note) VALUES (?, -1, ?, 'purchase', ?)")
      .run(profileId, total, `Einkauf: ${itemsText}`);
    const ins = db.prepare("INSERT INTO sale_items (profile_id, transaction_id, customer_id, article_id, article_name, quantity, unit_price, total) VALUES (?, ?, -1, ?, ?, ?, ?, ?)");
    lineItems.forEach((item) => ins.run(profileId, tx.lastInsertRowid, item.article_id, item.article_name, item.quantity, item.unit_price, item.total));
    return tx.lastInsertRowid;
  })();

  res.json({ success: true, transaction_id: txId, tendered, change, payment_mode: "cash" });
});

// ── Kundenanzeige (flüchtiger Live-Zustand pro Profil) ────────────────────────
// Der aktuelle Warenkorb muss keinen Server-Neustart überleben; Verkaufsdaten
// werden weiterhin ausschliesslich über die normalen Checkout-Endpunkte gespeichert.
let customerDisplayState = null;
function cleanDisplayPayload(input = {}) {
  const items = Array.isArray(input.items) ? input.items.slice(0, 100).map((item) => ({
    name: String(item?.name || "Artikel").slice(0, 120),
    qty: Math.max(1, Math.min(999, Number(item?.qty) || 1)),
    price: money(Number(item?.price) || 0),
  })) : [];
  const theme = input?.profile?.theme && typeof input.profile.theme === "object" ? input.profile.theme : {};
  return {
    profile: {
      name: String(input?.profile?.name || "KinderKasse").slice(0, 80),
      theme: {
        primaryColor: String(theme.primaryColor || "#1a7a3c").slice(0, 20),
        pageBackground: String(theme.pageBackground || "#f3f4f6").slice(0, 20),
        registerBackground: String(theme.registerBackground || "#f3f4f6").slice(0, 20),
        bannerBackground: String(theme.bannerBackground || "#1a7a3c").slice(0, 20),
        bannerTextColor: String(theme.bannerTextColor || "#ffffff").slice(0, 20),
        bannerText: String(theme.bannerText || "Willkommen!").slice(0, 100),
      },
    },
    status: ["shop", "payment", "pin", "account", "success", "error"].includes(input.status) ? input.status : "shop",
    paymentMode: String(input.paymentMode || "").slice(0, 30),
    total: money(Number(input.total) || 0),
    tendered: Number.isFinite(Number(input.tendered)) ? money(Number(input.tendered)) : null,
    change: Number.isFinite(Number(input.change)) ? money(Number(input.change)) : null,
    message: String(input.message || "").slice(0, 160),
    pinRequest: input?.pinRequest?.required ? {
      required: true,
      customerName: String(input.pinRequest.customerName || "").slice(0, 80),
      invalid: input.pinRequest.invalid === true,
    } : null,
    account: input?.account ? {
      customerName: String(input.account.customerName || "").slice(0,80),
      balance: money(Number(input.account.balance) || 0),
      pinConfigured: input.account.pinConfigured === true,
      pinMode: ["always","threshold"].includes(input.account.pinMode) ? input.account.pinMode : "off",
      pinThreshold: money(Number(input.account.pinThreshold) || 0),
      message: String(input.account.message || "").slice(0,160),
      error: String(input.account.error || "").slice(0,160),
    } : null,
    items,
    updatedAt: new Date().toISOString(),
  };
}
app.get("/api/customer-display", (req, res) => {
  res.json(customerDisplayState || cleanDisplayPayload({}));
});
app.put("/api/customer-display", (req, res) => {
  // Absichtlich global: Bei einer einzelnen Kasse soll das Display immer exakt
  // den gerade aktiven Kassenstand zeigen, ohne selbst eine Profil-ID zu kennen.
  const settings = getPaymentSettings(getProfileId(req));
  if (!settings.customerDisplayEnabled) return res.status(409).json({ error: "Kundenanzeige ist für dieses Profil deaktiviert" });
  customerDisplayState = cleanDisplayPayload(req.body || {});
  res.json(customerDisplayState);
});
let customerDisplayInput = null;
app.post("/api/customer-display/input", (req, res) => {
  const pin = String(req.body?.pin || "");
  const action = String(req.body?.action || "");
  const currentPin = String(req.body?.currentPin || "");
  const newPin = String(req.body?.newPin || "");
  if (pin && !/^\d{1,8}$/.test(pin)) return res.status(400).json({ error: "Ungültige PIN-Eingabe" });
  if (currentPin && !/^\d{4,8}$/.test(currentPin)) return res.status(400).json({ error: "Ungültiger aktueller PIN" });
  if (newPin && !/^\d{4,8}$/.test(newPin)) return res.status(400).json({ error: "Ungültiger neuer PIN" });
  customerDisplayInput = {
    pin,
    action: action.slice(0, 40),
    currentPin,
    newPin,
    createdAt: Date.now(),
  };
  res.json({ success: true });
});
app.get("/api/customer-display/input", (req, res) => {
  const value = customerDisplayInput;
  customerDisplayInput = null;
  res.json(value || {});
});


// ── Transactions / Statistik (profilabhängig) ────────────────────────────────
app.get("/api/transactions", (req, res) => {
  const profileId = getProfileId(req);
  const { customer_id } = req.query;
  let q = "SELECT * FROM transactions WHERE profile_id = ?";
  const params = [profileId];
  if (customer_id) { q += " AND customer_id = ?"; params.push(customer_id); }
  q += " ORDER BY created_at DESC, id DESC LIMIT 100";
  res.json(db.prepare(q).all(...params));
});

function parseItemsFromTransactionNote(note) {
  const raw = String(note || "").replace(/^Einkauf:\s*/i, "");
  if (!raw.trim()) return [];
  return raw.split(",").map((part) => { const clean = part.trim(); const m = clean.match(/^(.*?)\s+x(\d+)$/i); return { article_name: (m ? m[1] : clean).trim() || "Artikel", quantity: m ? Math.max(1, Number(m[2])) : 1, unit_price: 0, total: 0, legacy: true }; }).filter((x) => x.article_name);
}
app.get("/api/statistics/sales", (req, res) => {
  const profileId = getProfileId(req);
  const days = Number(req.query.days || 0);
  const params = [profileId];
  let where = "WHERE t.profile_id = ? AND t.type = 'purchase'";
  if (Number.isFinite(days) && days > 0) { where += " AND datetime(t.created_at) >= datetime('now', ?)"; params.push(`-${Math.round(days)} days`); }
  const transactions = db.prepare(`SELECT t.id, t.customer_id, c.name AS customer_name, t.amount, t.note, t.created_at FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT 500`).all(...params);
  const txIds = transactions.map((t) => t.id);
  let itemRows = [];
  if (txIds.length) { const placeholders = txIds.map(() => "?").join(","); itemRows = db.prepare(`SELECT * FROM sale_items WHERE profile_id = ? AND transaction_id IN (${placeholders}) ORDER BY sold_at DESC, id ASC`).all(profileId, ...txIds); }
  const byTx = new Map(); itemRows.forEach((item) => { if (!byTx.has(item.transaction_id)) byTx.set(item.transaction_id, []); byTx.get(item.transaction_id).push(item); });
  const summaryMap = new Map(); let totalQuantity = 0;
  transactions.forEach((tx) => {
    const items = byTx.get(tx.id)?.length ? byTx.get(tx.id) : parseItemsFromTransactionNote(tx.note); tx.items = items;
    items.forEach((item) => {
      const key = String(item.article_id || item.article_name || "Artikel").toLowerCase();
      const prev = summaryMap.get(key) || { article_id: item.article_id || null, article_name: item.article_name || "Artikel", quantity: 0, total_amount: 0, sales_count: 0, first_sold_at: tx.created_at, last_sold_at: tx.created_at };
      const qty = Math.max(0, Number(item.quantity || 0)); prev.quantity += qty; prev.total_amount = money(prev.total_amount + Number(item.total || 0)); prev.sales_count += 1;
      if (String(tx.created_at) < String(prev.first_sold_at)) prev.first_sold_at = tx.created_at; if (String(tx.created_at) > String(prev.last_sold_at)) prev.last_sold_at = tx.created_at;
      summaryMap.set(key, prev); totalQuantity += qty;
    });
  });
  const summary = [...summaryMap.values()].sort((a,b) => b.quantity-a.quantity || String(a.article_name).localeCompare(String(b.article_name), "de-CH"));
  res.json({ totals: { sales_count: transactions.length, article_quantity: totalQuantity, revenue: money(transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)) }, summary, sales: transactions });
});

// ── Kassenmodus-Notfallreset ─────────────────────────────────────────────────
// Der Wert wird absichtlich nur gelesen. Zurücksetzen erfolgt direkt im Docker-
// Container auf der SQLite-DB, sodass kein öffentlicher Reset-Endpunkt existiert.
app.get("/api/admin/kiosk-reset-version", (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'kiosk_reset_version'").get();
  res.json({ version: Number(row?.value || 0) || 0 });
});

app.get("/api/status", (req, res) => {
  const profile = profileToJson(db.prepare("SELECT * FROM profiles WHERE id = ?").get(getProfileId(req)));
  res.json({ app: "KinderKasse", version: "2.8.1", profile });
});

app.listen(PORT, () => console.log(`Kasse backend running on :${PORT}`));
