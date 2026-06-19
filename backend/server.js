const express = require("express");
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
  ],
}));
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_PATH));

// ── Database ──────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON"); // Fix #3: ohne das ignoriert SQLite ON DELETE CASCADE

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT DEFAULT NULL,
    emoji TEXT DEFAULT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Kunde: trägt das Guthaben
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Zahlungsmittel: gehört zu genau einem Kunden, kann NFC oder QR sein
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
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- App-Einstellungen als einfache Key-Value-Ablage (gemeinsam für alle Geräte)
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

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
const count = db.prepare("SELECT COUNT(*) as c FROM articles").get();
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO articles (name, price, image, emoji) VALUES (?, ?, ?, ?)");
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

// ── Settings: Zahlungsmethoden (gemeinsam für alle Geräte) ───────────────────
const VALID_PAY_MODES = ["nfc", "qr", "bleNfc", "manual"];
const PAYMENT_SETTINGS_KEY = "payment_methods";

// Standardkonfiguration, falls noch nichts gespeichert wurde: alle aktiv, NFC Standard
const DEFAULT_PAYMENT_SETTINGS = {
  enabled: { nfc: true, qr: true, bleNfc: true, manual: true },
  default: "nfc",
};

function getPaymentSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(PAYMENT_SETTINGS_KEY);
  if (!row) return DEFAULT_PAYMENT_SETTINGS;
  try {
    const parsed = JSON.parse(row.value);
    // Defensive: fehlende Felder mit Defaults auffüllen
    const enabled = {};
    for (const m of VALID_PAY_MODES) {
      enabled[m] = typeof parsed?.enabled?.[m] === "boolean" ? parsed.enabled[m] : true;
    }
    let def = VALID_PAY_MODES.includes(parsed?.default) ? parsed.default : "nfc";
    // Standard muss aktiviert sein — sonst ersten aktiven nehmen
    if (!enabled[def]) {
      const firstEnabled = VALID_PAY_MODES.find((m) => enabled[m]);
      def = firstEnabled || "manual";
    }
    return { enabled, default: def };
  } catch {
    return DEFAULT_PAYMENT_SETTINGS;
  }
}

app.get("/api/settings/payment", (req, res) => {
  res.json(getPaymentSettings());
});

app.put("/api/settings/payment", (req, res) => {
  const { enabled, default: def } = req.body || {};

  // Validierung
  if (!enabled || typeof enabled !== "object") {
    return res.status(400).json({ error: "enabled-Objekt fehlt" });
  }
  const cleanEnabled = {};
  for (const m of VALID_PAY_MODES) {
    cleanEnabled[m] = enabled[m] === true;
  }
  // Mindestens eine Methode muss aktiv sein, sonst kann man nicht bezahlen
  if (!Object.values(cleanEnabled).some((v) => v)) {
    return res.status(400).json({ error: "Mindestens eine Zahlungsmethode muss aktiv sein." });
  }
  if (!VALID_PAY_MODES.includes(def)) {
    return res.status(400).json({ error: "Ungültige Standard-Methode." });
  }
  if (!cleanEnabled[def]) {
    return res.status(400).json({ error: "Die Standard-Methode muss aktiviert sein." });
  }

  const value = JSON.stringify({ enabled: cleanEnabled, default: def });
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
    .run(PAYMENT_SETTINGS_KEY, value, value);
  res.json({ enabled: cleanEnabled, default: def });
});

// ── Articles ──────────────────────────────────────────────────────────────────
// ?includeHidden=1 liefert auch ausgeblendete Artikel (für die Artikelverwaltung).
// Ohne den Parameter werden ausgeblendete Artikel weggelassen (für die Kasse).
app.get("/api/articles", (req, res) => {
  const { letter, includeHidden } = req.query;
  const conditions = [];
  const params = [];
  if (letter && letter !== "ALL") {
    conditions.push("UPPER(name) LIKE ?");
    params.push(`${letter.toUpperCase()}%`);
  }
  if (includeHidden !== "1") {
    conditions.push("hidden = 0");
  }
  let query = "SELECT * FROM articles";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY name COLLATE NOCASE ASC";
  res.json(db.prepare(query).all(...params));
});

// Sichtbarkeit eines Artikels umschalten (ein-/ausblenden)
app.put("/api/articles/:id/visibility", (req, res) => {
  const { hidden } = req.body || {};
  const article = db.prepare("SELECT * FROM articles WHERE id = ?").get(req.params.id);
  if (!article) return res.status(404).json({ error: "not found" });
  const newHidden = hidden ? 1 : 0;
  db.prepare("UPDATE articles SET hidden = ? WHERE id = ?").run(newHidden, req.params.id);
  res.json({ id: Number(req.params.id), hidden: newHidden });
});

app.post("/api/articles", upload.single("image"), handleUploadError, async (req, res) => {
  const { name, price } = req.body;
  // Fix #6 (Review 2): Preise müssen > 0 sein, sonst widerspricht es dem Checkout (total > 0)
  const validPrice = positiveNumber(price);
  if (!name || validPrice === null) return res.status(400).json({ error: "Name und ein gültiger Preis (> 0) sind erforderlich" });
  try {
    const image = await saveProcessedImage(req.file);
    const result = db.prepare("INSERT INTO articles (name, price, image) VALUES (?, ?, ?)").run(name, validPrice, image);
    res.json({ id: result.lastInsertRowid, name, price: validPrice, image });
  } catch (err) {
    console.error("Bildverarbeitung fehlgeschlagen:", err.message);
    res.status(400).json({ error: "Bild konnte nicht verarbeitet werden. Bitte ein anderes Foto versuchen." });
  }
});

app.put("/api/articles/:id", upload.single("image"), handleUploadError, async (req, res) => {
  const { name, price } = req.body;
  const article = db.prepare("SELECT * FROM articles WHERE id = ?").get(req.params.id);
  if (!article) return res.status(404).json({ error: "not found" });
  let newPrice = article.price;
  if (price != null) {
    const validPrice = positiveNumber(price);
    if (validPrice === null) return res.status(400).json({ error: "Ungültiger Preis (muss > 0 sein)" });
    newPrice = validPrice;
  }
  try {
    const image = req.file ? await saveProcessedImage(req.file) : article.image;
    db.prepare("UPDATE articles SET name = ?, price = ?, image = ? WHERE id = ?")
      .run(name ?? article.name, newPrice, image, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Bildverarbeitung fehlgeschlagen:", err.message);
    res.status(400).json({ error: "Bild konnte nicht verarbeitet werden. Bitte ein anderes Foto versuchen." });
  }
});

app.delete("/api/articles/:id", (req, res) => {
  db.prepare("DELETE FROM articles WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Fix #7 (Review 3): SQLite REAL kann bei vielen Additionen/Subtraktionen mit
// Centbeträgen Rundungsartefakte erzeugen (z.B. 2.220446049250313e-16). Nach
// jeder Guthaben-Änderung wird hart auf 2 Nachkommastellen gerundet.
function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function getCustomerWithTokens(customerId) {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
  if (!customer) return null;
  const tokens = db.prepare("SELECT * FROM payment_tokens WHERE customer_id = ? ORDER BY created_at").all(customerId);
  return { ...customer, tokens };
}

// Fix #4 (Review 3): case-insensitiver Fallback gilt NUR für NFC-Tokens.
// Vorher matchte UPPER(value) auch QR-Codes — das ist gefährlich, weil QR-Werte
// bewusst case-sensitiv sein können (z.B. Kunde A = "abc", Kunde B = "ABC" sind
// zwei unterschiedliche, gültige UNIQUE-Werte). Ein breiter case-insensitiver
// Treffer könnte sonst eine Zahlung dem falschen Kunden zuordnen.
function findCustomerByToken(value) {
  const exact = db.prepare("SELECT * FROM payment_tokens WHERE value = ? AND active = 1").get(value);
  if (exact) return getCustomerWithTokens(exact.customer_id);

  const nfcFallback = db.prepare(
    "SELECT * FROM payment_tokens WHERE type = 'nfc' AND UPPER(value) = UPPER(?) AND active = 1"
  ).get(value);
  if (!nfcFallback) return null;
  return getCustomerWithTokens(nfcFallback.customer_id);
}

// ── Customers ─────────────────────────────────────────────────────────────────

// List all customers with their active tokens
app.get("/api/customers", (req, res) => {
  const customers = db.prepare("SELECT * FROM customers ORDER BY name COLLATE NOCASE").all();
  const tokens = db.prepare("SELECT * FROM payment_tokens ORDER BY created_at").all();
  const result = customers.map(c => ({
    ...c,
    tokens: tokens.filter(t => t.customer_id === c.id),
  }));
  res.json(result);
});

// Create new customer, optionally with first token(s)
// Fix #2 (Review 3): Kunde + Tokens werden in einer einzigen DB-Transaktion angelegt.
// Vorher konnte bei "Beides" und einem bereits vergebenen QR-Code ein "Geisterkunde"
// ohne Tokens in der DB übrigbleiben, obwohl die API einen Fehler zurückgab.
app.post("/api/customers", (req, res) => {
  const { name, balance = 0, nfc_uid, qr_code } = req.body;
  if (!name) return res.status(400).json({ error: "Name ist erforderlich" });

  const startBalance = nonNegativeNumber(balance);
  if (startBalance === null) return res.status(400).json({ error: "Ungültiges Startguthaben" });

  try {
    const customer = db.transaction(() => {
      const result = db.prepare("INSERT INTO customers (name, balance) VALUES (?, ?)").run(name, startBalance);
      const customerId = result.lastInsertRowid;
      // Fix #5 (Review 2): NFC-UID serverseitig normalisieren (Großbuchstaben),
      // damit Groß-/Kleinschreibung nie zu "Karte nicht gefunden" führt
      if (nfc_uid) {
        db.prepare("INSERT INTO payment_tokens (customer_id, type, value) VALUES (?, 'nfc', ?)").run(customerId, String(nfc_uid).toUpperCase());
      }
      if (qr_code) {
        db.prepare("INSERT INTO payment_tokens (customer_id, type, value) VALUES (?, 'qr', ?)").run(customerId, qr_code);
      }
      return getCustomerWithTokens(customerId);
    })();
    res.json(customer);
  } catch (e) {
    res.status(409).json({ error: "NFC-UID oder QR-Code wird bereits verwendet" });
  }
});

app.get("/api/customers/:id", (req, res) => {
  const customer = getCustomerWithTokens(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  res.json(customer);
});

app.put("/api/customers/:id", (req, res) => {
  const { name } = req.body;
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  db.prepare("UPDATE customers SET name = ? WHERE id = ?").run(name ?? customer.name, req.params.id);
  res.json(getCustomerWithTokens(req.params.id));
});

app.delete("/api/customers/:id", (req, res) => {
  db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ── Payment Tokens (NFC-Karten / QR-Codes) ───────────────────────────────────

// Add a new token to an existing customer (e.g. "Mami bekommt jetzt auch einen QR-Code")
app.post("/api/customers/:id/tokens", (req, res) => {
  const { type, value } = req.body;
  if (!type || !value) return res.status(400).json({ error: "type und value sind erforderlich" });
  if (!["nfc", "qr"].includes(type)) return res.status(400).json({ error: "type muss 'nfc' oder 'qr' sein" });
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });
  // Fix #5 (Review 2): NFC-Werte serverseitig normalisieren, unabhängig davon, ob das Frontend das schon tat
  const normalizedValue = type === "nfc" ? String(value).toUpperCase() : value;
  try {
    db.prepare("INSERT INTO payment_tokens (customer_id, type, value) VALUES (?, ?, ?)").run(req.params.id, type, normalizedValue);
    res.json(getCustomerWithTokens(req.params.id));
  } catch (e) {
    res.status(409).json({ error: "Dieser Wert wird bereits verwendet" });
  }
});

// Deactivate a token (e.g. "Karte verloren") — keeps history, frees up nothing else
app.post("/api/tokens/:tokenId/deactivate", (req, res) => {
  const token = db.prepare("SELECT * FROM payment_tokens WHERE id = ?").get(req.params.tokenId);
  if (!token) return res.status(404).json({ error: "Token nicht gefunden" });
  db.prepare("UPDATE payment_tokens SET active = 0 WHERE id = ?").run(req.params.tokenId);
  res.json(getCustomerWithTokens(token.customer_id));
});

app.post("/api/tokens/:tokenId/reactivate", (req, res) => {
  const token = db.prepare("SELECT * FROM payment_tokens WHERE id = ?").get(req.params.tokenId);
  if (!token) return res.status(404).json({ error: "Token nicht gefunden" });
  db.prepare("UPDATE payment_tokens SET active = 1 WHERE id = ?").run(req.params.tokenId);
  res.json(getCustomerWithTokens(token.customer_id));
});

// Permanently delete a token (e.g. typo cleanup)
app.delete("/api/tokens/:tokenId", (req, res) => {
  const token = db.prepare("SELECT * FROM payment_tokens WHERE id = ?").get(req.params.tokenId);
  if (!token) return res.status(404).json({ error: "Token nicht gefunden" });
  db.prepare("DELETE FROM payment_tokens WHERE id = ?").run(req.params.tokenId);
  res.json(getCustomerWithTokens(token.customer_id));
});

// Lookup: find customer by any active token value, by customer id, or by name
app.get("/api/lookup/:identifier", (req, res) => {
  const id = req.params.identifier;
  let customer = findCustomerByToken(id);
  if (!customer && /^\d+$/.test(id)) customer = getCustomerWithTokens(id);
  // Fix: Name-Eingabe als Fallback erlauben, falls weder NFC/QR/ID passt.
  // Case-insensitive, exakter Match (kein "LIKE"-Teilstring-Match, damit
  // z.B. "Mia" nicht versehentlich auch "Miafamilie" treffen würde).
  if (!customer) {
    const byName = db.prepare("SELECT * FROM customers WHERE name = ? COLLATE NOCASE").get(id);
    if (byName) customer = getCustomerWithTokens(byName.id);
  }
  if (!customer) return res.status(404).json({ error: "Kein Kunde mit dieser Karte/QR-Code/Name gefunden" });
  res.json(customer);
});

// ── Topup ─────────────────────────────────────────────────────────────────────
app.post("/api/customers/:id/topup", (req, res) => {
  const rawAmount = positiveNumber(req.body.amount);
  if (rawAmount === null) return res.status(400).json({ error: "Ungültiger Betrag" });
  // Konsistenz mit dem Checkout-Fix: auch hier roh-Eingabe runden, bevor sie verbucht wird
  const amount = money(rawAmount);
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Kunde nicht gefunden" });

  const doTopup = db.transaction(() => {
    db.prepare("UPDATE customers SET balance = balance + ? WHERE id = ?").run(amount, req.params.id);
    // Fix #7 (Review 3): nach der Addition hart auf Centbetrag runden, gegen Float-Drift
    const fresh = db.prepare("SELECT balance FROM customers WHERE id = ?").get(req.params.id);
    db.prepare("UPDATE customers SET balance = ? WHERE id = ?").run(money(fresh.balance), req.params.id);
    db.prepare("INSERT INTO transactions (customer_id, amount, type, note) VALUES (?, ?, 'topup', 'Aufladung')").run(req.params.id, amount);
  });
  doTopup();

  res.json(getCustomerWithTokens(req.params.id));
});

// ── Checkout — accepts NFC uid, QR code, or customer id ──────────────────────
// Fix #5 (Review 2): atomare DB-Transaktion mit erneuter Balance-Prüfung innerhalb der Transaktion,
// damit zwei nahezu gleichzeitige Zahlungen nicht doppelt abbuchen können.
app.post("/api/checkout", (req, res) => {
  const { card_uid, items } = req.body;
  const rawTotal = positiveNumber(req.body.total);
  if (!card_uid || rawTotal === null) return res.status(400).json({ error: "card_uid und ein gültiger Betrag (> 0) sind erforderlich" });
  // Fix #1 (Review 4): total VOR dem Balance-Vergleich runden. Ohne das kann das
  // Frontend z.B. 0.30000000000000004 statt 0.30 schicken (0.1+0.2 in JS), und ein
  // Kunde mit exakt 0.30 CHF Guthaben würde fälschlich abgelehnt (0.3 < 0.30...4).
  const total = money(rawTotal);

  let customer = findCustomerByToken(card_uid);
  if (!customer && /^\d+$/.test(card_uid)) customer = getCustomerWithTokens(card_uid);
  // Name-Eingabe erlauben — derselbe Fallback wie im /api/lookup Endpoint
  if (!customer) {
    const byName = db.prepare("SELECT * FROM customers WHERE name = ? COLLATE NOCASE").get(card_uid);
    if (byName) customer = getCustomerWithTokens(byName.id);
  }
  if (!customer) return res.status(404).json({ error: "Karte nicht gefunden" });

  try {
    const newBalance = db.transaction(() => {
      // Erneut frisch aus der DB lesen, innerhalb der Transaktion — verhindert Race Conditions
      const fresh = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
      if (fresh.balance < total) {
        const err = new Error("INSUFFICIENT_BALANCE");
        err.balance = fresh.balance;
        throw err;
      }
      db.prepare("UPDATE customers SET balance = balance - ? WHERE id = ?").run(total, customer.id);
      // Fix #7 (Review 3): nach der Subtraktion hart auf Centbetrag runden
      const afterSub = db.prepare("SELECT balance FROM customers WHERE id = ?").get(customer.id);
      db.prepare("UPDATE customers SET balance = ? WHERE id = ?").run(money(afterSub.balance), customer.id);
      db.prepare("INSERT INTO transactions (customer_id, amount, type, note) VALUES (?, ?, 'purchase', ?)").run(customer.id, total, `Einkauf: ${items}`);
      return db.prepare("SELECT balance FROM customers WHERE id = ?").get(customer.id).balance;
    })();
    res.json({ success: true, new_balance: newBalance, customer_name: customer.name });
  } catch (e) {
    if (e.message === "INSUFFICIENT_BALANCE") {
      return res.status(402).json({ error: "Guthaben zu niedrig", balance: e.balance });
    }
    throw e;
  }
});

// ── Transactions ──────────────────────────────────────────────────────────────
app.get("/api/transactions", (req, res) => {
  const { customer_id } = req.query;
  let q = "SELECT * FROM transactions";
  const params = [];
  if (customer_id) { q += " WHERE customer_id = ?"; params.push(customer_id); }
  // Fix #8 (Review 3): datetime('now') hat nur Sekundenauflösung. id DESC als
  // Tiebreaker sorgt dafür, dass Transaktionen innerhalb derselben Sekunde
  // trotzdem in der korrekten Reihenfolge angezeigt werden.
  q += " ORDER BY created_at DESC, id DESC LIMIT 100";
  res.json(db.prepare(q).all(...params));
});

app.listen(PORT, () => console.log(`Kasse backend running on :${PORT}`));
