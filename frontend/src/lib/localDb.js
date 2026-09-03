import { getActiveProfileId } from "./profile";

const DB_KEY = "kasseLocalDbV2Profiles";

export const DEFAULT_THEME = {
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
const DEFAULT_PAYMENT_SETTINGS = {
  enabled: { nfc: false, qr: true, bleNfc: true, manual: true, cash: true },
  default: "bleNfc",
  cashBreakdownEnabled: false,
  customerDisplayEnabled: false,
  customerDisplayType: "esp32",
};
const DEFAULT_PRINTER_SETTINGS = { enabled: false, address: "", name: "", autoConnect: true };
const DEFAULT_DRAWER_SETTINGS = { enabled: false, openOnCash: true };
const DEFAULT_RECEIPT_LAYOUT_SETTINGS = {
  shopName: "Noemi's Lädeli", subtitle: "Kassenzettel", footerText: "Danke fürs Einkaufen!",
  lineWidth: 32, previewFontSize: "large", itemSpacing: "compact", printMode: "image", imagePaddingPx: 0,
  textStyle: "bold", codePage: "auto", printLogo: false, logoDataUrl: "", logoWidthPx: 320, logoMaxHeightPx: 320,
  showDate: true, showPayment: true, showCustomer: true, showBalance: true, showItemQuantity: true, showUnitPrice: true,
};
const DEMO_ARTICLES = [
  ["Apfel",.5,"🍎"],["Banane",.3,"🍌"],["Erdbeeren",1.8,"🍓"],["Trauben",2.2,"🍇"],["Orange",.7,"🍊"],
  ["Zitrone",.4,"🍋"],["Birne",.6,"🍐"],["Mango",1.5,"🥭"],["Wassermelone",3.9,"🍉"],["Kiwi",.8,"🥝"],
  ["Rüebli",.4,"🥕"],["Tomate",.5,"🍅"],["Gurke",.9,"🥒"],["Peperoni",.8,"🫑"],["Broccoli",1.2,"🥦"],
  ["Salat",1.1,"🥬"],["Milch",1.1,"🥛"],["Butter",1.8,"🧈"],["Käse",2.5,"🧀"],["Joghurt",.9,"🥣"],
  ["Brot",1.2,"🍞"],["Brötli",.3,"🥖"],["Gipfeli",1,"🥐"],["Kuchen",2.8,"🍰"],["Wasser",.5,"💧"],
  ["Apfelsaft",1.5,"🧃"],["Schoggi",1.3,"🍫"],["Gummibärli",.9,"🐻"],["Guetzli",1.5,"🍪"],["Glace",1.2,"🍡"],
  ["Honig",3.5,"🍯"],["Konfitüre",2.2,"🍓"],
];
const nowIso = () => new Date().toISOString();
const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const clone = (v) => JSON.parse(JSON.stringify(v));
const positiveNumber = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
const nonNegativeNumber = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;

function defaultProfileSettings() {
  return { payment: clone(DEFAULT_PAYMENT_SETTINGS), printer: clone(DEFAULT_PRINTER_SETTINGS), drawer: clone(DEFAULT_DRAWER_SETTINGS), receiptLayout: clone(DEFAULT_RECEIPT_LAYOUT_SETTINGS) };
}
function makeInitialDb() {
  const profile = { id: 1, name: "Einkaufsladen", active: true, theme: clone(DEFAULT_THEME), created_at: nowIso() };
  const articles = DEMO_ARTICLES.map(([name, price, emoji], i) => ({ id:i+1, profile_id:1, name, price, image:null, emoji, hidden:0, created_at:nowIso() }));
  return {
    version: 2,
    nextIds: { profile:2, article:articles.length+1, customer:1, token:1, transaction:1, saleItem:1 },
    profiles:[profile], articles, customers:[], customerProfiles:[], tokens:[], transactions:[], saleItems:[],
    settingsByProfile: { "1": defaultProfileSettings() },
  };
}
function normalizeDb(input) {
  const fresh = makeInitialDb();
  if (!input || Number(input.version) !== 2) return fresh;
  const db = { ...fresh, ...input, nextIds:{...fresh.nextIds,...(input.nextIds||{})}, settingsByProfile:{...fresh.settingsByProfile,...(input.settingsByProfile||{})} };
  for (const key of ["profiles","articles","customers","customerProfiles","tokens","transactions","saleItems"]) if (!Array.isArray(db[key])) db[key]=[];
  if (!db.profiles.length) db.profiles=[fresh.profiles[0]];
  return db;
}
function readDb() {
  try { const raw=localStorage.getItem(DB_KEY); if (raw) return normalizeDb(JSON.parse(raw)); } catch {}
  const db=makeInitialDb(); writeDb(db); return db;
}
function writeDb(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function withDb(fn) { const db=readDb(); const result=fn(db); writeDb(db); return result; }
function jsonResponse(body,status=200) { return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}); }
function profileId() { return getActiveProfileId(); }
function findProfile(db,id) { return db.profiles.find((p)=>Number(p.id)===Number(id)); }
function sanitizeColor(v,fallback) { return /^#[0-9a-f]{6}$/i.test(String(v||"")) ? String(v) : fallback; }
function sanitizeTheme(input={}) {
  const t={...DEFAULT_THEME,...input};
  return {
    primaryColor:sanitizeColor(t.primaryColor,DEFAULT_THEME.primaryColor), primaryDark:sanitizeColor(t.primaryDark,DEFAULT_THEME.primaryDark),
    accentColor:sanitizeColor(t.accentColor,DEFAULT_THEME.accentColor), pageBackground:sanitizeColor(t.pageBackground,DEFAULT_THEME.pageBackground),
    registerBackground:sanitizeColor(t.registerBackground,DEFAULT_THEME.registerBackground), bannerBackground:sanitizeColor(t.bannerBackground,DEFAULT_THEME.bannerBackground),
    bannerTextColor:sanitizeColor(t.bannerTextColor,DEFAULT_THEME.bannerTextColor), bannerText:String(t.bannerText||"").slice(0,120),
    bannerImageDataUrl:String(t.bannerImageDataUrl||"").startsWith("data:image/")?String(t.bannerImageDataUrl):"",
    logoImageDataUrl:String(t.logoImageDataUrl||"").startsWith("data:image/")?String(t.logoImageDataUrl):"",
    appearanceMode:t.appearanceMode==="dark"?"dark":"light", autoContrast:t.autoContrast!==false,
  };
}
function ensureSettings(db,pid) { const key=String(pid); if(!db.settingsByProfile[key]) db.settingsByProfile[key]=defaultProfileSettings(); return db.settingsByProfile[key]; }
function ensureCustomerProfile(db,customerId,pid,{active=false,balance=0}={}) {
  let row=db.customerProfiles.find((x)=>Number(x.customer_id)===Number(customerId)&&Number(x.profile_id)===Number(pid));
  if(!row){ row={customer_id:Number(customerId),profile_id:Number(pid),active:Boolean(active),balance:money(balance),created_at:nowIso()}; db.customerProfiles.push(row); }
  return row;
}
function customerWithTokens(db,customerId,pid) {
  const c=db.customers.find((x)=>Number(x.id)===Number(customerId)); if(!c)return null;
  const cp=db.customerProfiles.find((x)=>Number(x.customer_id)===Number(customerId)&&Number(x.profile_id)===Number(pid));
  return {
    ...clone(c),
    payment_pin_hash: undefined,
    payment_pin_salt: undefined,
    payment_pin_configured: Boolean(c.payment_pin_hash),
    payment_pin_mode: ["always","threshold"].includes(c.payment_pin_mode) ? c.payment_pin_mode : "off",
    payment_pin_threshold: money(c.payment_pin_threshold||0),
    balance:money(cp?.balance||0),
    profile_active:Boolean(cp?.active),
    tokens:clone(db.tokens.filter((t)=>Number(t.customer_id)===Number(customerId)).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))))
  };
}
function lookupCustomer(db,identifier,pid) {
  const raw=decodeURIComponent(String(identifier||""));
  let token=db.tokens.find((t)=>t.active&&t.value===raw) || db.tokens.find((t)=>t.active&&t.type==="nfc"&&String(t.value).toUpperCase()===raw.toUpperCase());
  let c=token?customerWithTokens(db,token.customer_id,pid):null;
  if(!c&&/^\d+$/.test(raw)) c=customerWithTokens(db,Number(raw),pid);
  if(!c){const found=db.customers.find((x)=>String(x.name).toLowerCase()===raw.toLowerCase()); if(found)c=customerWithTokens(db,found.id,pid);}
  return c?.profile_active?c:null;
}
function tokenExists(db,type,value,except=null) { const n=type==="nfc"?String(value).toUpperCase():String(value); return db.tokens.some((t)=>Number(t.id)!==Number(except)&&t.type===type&&(type==="nfc"?String(t.value).toUpperCase()===n:String(t.value)===n)); }
async function fileToDataUrl(file) { if(!file||typeof FileReader==="undefined")return null; return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);}); }
async function parseBody(options={}) {
  if(!options.body)return {};
  if(typeof FormData!=="undefined"&&options.body instanceof FormData){const image=options.body.get("image");return{name:options.body.get("name"),price:options.body.get("price"),image:image?await fileToDataUrl(image):null};}
  if(typeof options.body==="string"){try{return JSON.parse(options.body);}catch{return {};}}
  return options.body||{};
}
async function localHashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${String(pin)}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2,"0")).join("");
}
function localSalt() {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b)=>b.toString(16).padStart(2,"0")).join("");
}
function localPinRequired(customer,total) {
  if (!customer?.payment_pin_hash || customer.payment_pin_mode==="off") return false;
  if (customer.payment_pin_mode==="always") return true;
  return customer.payment_pin_mode==="threshold" && Number(total)>=Number(customer.payment_pin_threshold||0);
}
async function localVerifyPin(customer,pin) {
  if (!customer?.payment_pin_hash || !customer?.payment_pin_salt || !/^\d{4,8}$/.test(String(pin||""))) return false;
  return (await localHashPin(pin,customer.payment_pin_salt))===customer.payment_pin_hash;
}
function sanitizePrinterSettings(i={}) { return {enabled:i.enabled===true,address:String(i.address||"").slice(0,120),name:String(i.name||"").slice(0,120),autoConnect:i.autoConnect!==false}; }
function sanitizeReceiptLayoutSettings(i={}) { return {...DEFAULT_RECEIPT_LAYOUT_SETTINGS,...i,shopName:String(i.shopName??DEFAULT_RECEIPT_LAYOUT_SETTINGS.shopName).slice(0,40),subtitle:String(i.subtitle??DEFAULT_RECEIPT_LAYOUT_SETTINGS.subtitle).slice(0,40),footerText:String(i.footerText??DEFAULT_RECEIPT_LAYOUT_SETTINGS.footerText).slice(0,60),logoDataUrl:String(i.logoDataUrl||"").startsWith("data:image/")?String(i.logoDataUrl):""}; }
function normalizeCheckoutItems(body) {
  const raw=Array.isArray(body?.line_items)?body.line_items:[];
  if(raw.length)return raw.map((i)=>{const q=Math.max(1,Math.round(Number(i.qty??i.quantity??1)));const u=money(i.unit_price??i.price);return{article_id:i.article_id!=null?Number(i.article_id):null,article_name:String(i.name||i.article_name||"Artikel").slice(0,120),quantity:q,unit_price:u,total:money(q*u)}});
  return String(body?.items||"").split(",").map((x)=>x.trim()).filter(Boolean).map((x)=>{const m=x.match(/^(.*?)\s+x(\d+)$/i);return{article_id:null,article_name:(m?m[1]:x).trim(),quantity:m?Number(m[2]):1,unit_price:0,total:0}});
}
function parseItemsFromNote(note) { return normalizeCheckoutItems({items:String(note||"").replace(/^Einkauf:\s*/i,"")}); }

export function exportLocalData(){return JSON.stringify(readDb(),null,2);}
export function importLocalData(text){const parsed=normalizeDb(JSON.parse(text));writeDb(parsed);return clone(parsed);}
export function resetLocalData(){const db=makeInitialDb();writeDb(db);return clone(db);}

export async function localApiFetch(path,options={}) {
  try {
    const method=String(options.method||"GET").toUpperCase();
    const url=new URL(path,"http://local.kasse"); const pathname=url.pathname; const pid=profileId();
    if(pathname==="/api/admin/kiosk-reset-version"&&method==="GET") return jsonResponse({version:0});
    if(pathname==="/api/profiles"&&method==="GET"){const include=url.searchParams.get("includeArchived")==="1";return jsonResponse(clone(readDb().profiles.filter((p)=>include||p.active).sort((a,b)=>Number(b.active)-Number(a.active)||String(a.name).localeCompare(String(b.name)))));}
    if(pathname==="/api/profiles/current"&&method==="GET"){const db=readDb();return jsonResponse(clone(findProfile(db,pid)||db.profiles.find((p)=>p.active)||db.profiles[0]));}
    if(pathname==="/api/profiles"&&method==="POST"){const body=await parseBody(options);const name=String(body.name||"").trim();if(!name)return jsonResponse({error:"Profilname ist erforderlich"},400);const result=withDb((db)=>{const row={id:db.nextIds.profile++,name:name.slice(0,80),active:true,theme:sanitizeTheme(body.theme||{...DEFAULT_THEME,bannerText:name}),created_at:nowIso()};db.profiles.push(row);const settings=ensureSettings(db,row.id);settings.receiptLayout.shopName=name.slice(0,40);return clone(row);});return jsonResponse(result,201);}
    const profileMatch=pathname.match(/^\/api\/profiles\/(\d+)$/);
    if(profileMatch&&method==="PUT"){const body=await parseBody(options);const result=withDb((db)=>{const row=findProfile(db,profileMatch[1]);if(!row)return{error:"Profil nicht gefunden",status:404};const name=body.name==null?row.name:String(body.name).trim().slice(0,80);if(!name)return{error:"Profilname ist erforderlich",status:400};const active=body.active==null?row.active:Boolean(body.active);if(!active&&!db.profiles.some((p)=>p.active&&Number(p.id)!==Number(row.id)))return{error:"Mindestens ein Profil muss aktiv bleiben",status:400};row.name=name;row.active=active;row.theme=sanitizeTheme(body.theme==null?row.theme:body.theme);return clone(row);});return result.error?jsonResponse({error:result.error},result.status):jsonResponse(result);}

    if(pathname==="/api/settings/payment") { if(method==="GET"){const current=ensureSettings(readDb(),pid).payment||{};return jsonResponse({...clone(DEFAULT_PAYMENT_SETTINGS),...clone(current),enabled:{...clone(DEFAULT_PAYMENT_SETTINGS.enabled),...(current.enabled||{})}});} const body=await parseBody(options); if(!body.enabled||!Object.values(body.enabled).some(Boolean)||!body.enabled[body.default])return jsonResponse({error:"Mindestens eine Methode und ein aktiver Standard sind erforderlich"},400); const clean={...clone(DEFAULT_PAYMENT_SETTINGS),...clone(body),enabled:{...clone(DEFAULT_PAYMENT_SETTINGS.enabled),...(body.enabled||{})},cashBreakdownEnabled:body.cashBreakdownEnabled===true,customerDisplayEnabled:body.customerDisplayEnabled===true,customerDisplayType:body.customerDisplayType==="device"?"device":"esp32"};const r=withDb((db)=>ensureSettings(db,pid).payment=clean);return jsonResponse(r); }
    if(pathname==="/api/settings/drawer") { if(method==="GET")return jsonResponse({...clone(DEFAULT_DRAWER_SETTINGS),...(ensureSettings(readDb(),pid).drawer||{})});const body=await parseBody(options);const clean={enabled:body.enabled===true,openOnCash:body.openOnCash!==false};const r=withDb((db)=>ensureSettings(db,pid).drawer=clean);return jsonResponse(r); }
    if(pathname==="/api/settings/printer") { if(method==="GET")return jsonResponse(sanitizePrinterSettings(ensureSettings(readDb(),pid).printer));const body=await parseBody(options);const r=withDb((db)=>ensureSettings(db,pid).printer=sanitizePrinterSettings(body));return jsonResponse(r); }
    if(pathname==="/api/settings/receipt-layout") { if(method==="GET")return jsonResponse(sanitizeReceiptLayoutSettings(ensureSettings(readDb(),pid).receiptLayout));const body=await parseBody(options);const r=withDb((db)=>ensureSettings(db,pid).receiptLayout=sanitizeReceiptLayoutSettings(body));return jsonResponse(r); }

    if(pathname==="/api/articles"&&method==="GET"){const db=readDb();let rows=db.articles.filter((a)=>Number(a.profile_id)===pid);if(url.searchParams.get("includeHidden")!=="1")rows=rows.filter((a)=>!a.hidden);const letter=url.searchParams.get("letter");if(letter&&letter!=="ALL")rows=rows.filter((a)=>String(a.name).toUpperCase().startsWith(letter.toUpperCase()));rows.sort((a,b)=>String(a.name).localeCompare(String(b.name),"de-CH",{sensitivity:"base"}));return jsonResponse(clone(rows));}
    if(pathname==="/api/articles"&&method==="POST"){const body=await parseBody(options);const price=positiveNumber(body.price);if(!body.name||price===null)return jsonResponse({error:"Name und ein gültiger Preis (> 0) sind erforderlich"},400);const r=withDb((db)=>{const row={id:db.nextIds.article++,profile_id:pid,name:String(body.name),price:money(price),image:body.image||null,emoji:null,hidden:0,created_at:nowIso()};db.articles.push(row);return clone(row);});return jsonResponse(r);}
    const visibility=pathname.match(/^\/api\/articles\/(\d+)\/visibility$/);if(visibility&&method==="PUT"){const body=await parseBody(options);const r=withDb((db)=>{const a=db.articles.find((x)=>Number(x.id)===Number(visibility[1])&&Number(x.profile_id)===pid);if(!a)return null;a.hidden=body.hidden?1:0;return{id:a.id,hidden:a.hidden};});return r?jsonResponse(r):jsonResponse({error:"not found"},404);}
    const article=pathname.match(/^\/api\/articles\/(\d+)$/);if(article&&method==="PUT"){const body=await parseBody(options);const r=withDb((db)=>{const a=db.articles.find((x)=>Number(x.id)===Number(article[1])&&Number(x.profile_id)===pid);if(!a)return null;if(body.name!=null)a.name=String(body.name);if(body.price!=null){const price=positiveNumber(body.price);if(price===null)return{error:"Ungültiger Preis"};a.price=money(price);}if(body.image)a.image=body.image;return clone(a);});return !r?jsonResponse({error:"not found"},404):r.error?jsonResponse(r,400):jsonResponse(r);}
    if(article&&method==="DELETE"){withDb((db)=>db.articles=db.articles.filter((x)=>!(Number(x.id)===Number(article[1])&&Number(x.profile_id)===pid)));return jsonResponse({success:true});}

    if(pathname==="/api/customers"&&method==="GET"){const db=readDb();const rows=db.customers.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"de-CH",{sensitivity:"base"})).map((c)=>customerWithTokens(db,c.id,pid));return jsonResponse(rows);}
    if(pathname==="/api/customers"&&method==="POST"){const body=await parseBody(options);const bal=nonNegativeNumber(body.balance);if(!body.name||bal===null)return jsonResponse({error:"Name und gültiges Startguthaben sind erforderlich"},400);const r=withDb((db)=>{if((body.nfc_uid&&tokenExists(db,"nfc",body.nfc_uid))||(body.qr_code&&tokenExists(db,"qr",body.qr_code)))return{error:"NFC-UID oder QR-Code wird bereits verwendet",status:409};const c={id:db.nextIds.customer++,name:String(body.name),payment_pin_mode:"off",payment_pin_threshold:0,payment_pin_hash:null,payment_pin_salt:null,created_at:nowIso()};db.customers.push(c);ensureCustomerProfile(db,c.id,pid,{active:true,balance:bal});if(body.nfc_uid)db.tokens.push({id:db.nextIds.token++,customer_id:c.id,type:"nfc",value:String(body.nfc_uid).toUpperCase(),active:1,created_at:nowIso()});if(body.qr_code)db.tokens.push({id:db.nextIds.token++,customer_id:c.id,type:"qr",value:String(body.qr_code),active:1,created_at:nowIso()});return customerWithTokens(db,c.id,pid);});return r.error?jsonResponse({error:r.error},r.status):jsonResponse(r);}
    const customer=pathname.match(/^\/api\/customers\/(\d+)$/);if(customer&&method==="GET"){const r=customerWithTokens(readDb(),customer[1],pid);return r?jsonResponse(r):jsonResponse({error:"Kunde nicht gefunden"},404);}if(customer&&method==="PUT"){const body=await parseBody(options);const r=withDb((db)=>{const c=db.customers.find((x)=>Number(x.id)===Number(customer[1]));if(!c)return null;if(body.name!=null)c.name=String(body.name);return customerWithTokens(db,c.id,pid);});return r?jsonResponse(r):jsonResponse({error:"Kunde nicht gefunden"},404);}if(customer&&method==="DELETE"){withDb((db)=>{const id=Number(customer[1]);const txIds=new Set(db.transactions.filter((t)=>Number(t.customer_id)===id).map((t)=>Number(t.id)));db.customers=db.customers.filter((x)=>Number(x.id)!==id);db.customerProfiles=db.customerProfiles.filter((x)=>Number(x.customer_id)!==id);db.tokens=db.tokens.filter((x)=>Number(x.customer_id)!==id);db.transactions=db.transactions.filter((x)=>Number(x.customer_id)!==id);db.saleItems=db.saleItems.filter((x)=>!txIds.has(Number(x.transaction_id)));});return jsonResponse({success:true});}
    const pinMatch=pathname.match(/^\/api\/customers\/(\d+)\/payment-pin$/);if(pinMatch&&method==="PUT"){const body=await parseBody(options);const mode=["off","always","threshold"].includes(body.mode)?body.mode:"off";const threshold=mode==="threshold"?nonNegativeNumber(body.threshold):0;if(mode==="threshold"&&threshold===null)return jsonResponse({error:"Ungültiger PIN-Grenzbetrag"},400);const db=readDb();const c=db.customers.find((x)=>Number(x.id)===Number(pinMatch[1]));if(!c)return jsonResponse({error:"Kunde nicht gefunden"},404);if(mode==="off"){c.payment_pin_mode="off";c.payment_pin_threshold=0;c.payment_pin_hash=null;c.payment_pin_salt=null;}else{const pin=String(body.pin||"");if(pin&&!/^\d{4,8}$/.test(pin))return jsonResponse({error:"PIN muss aus 4 bis 8 Ziffern bestehen"},400);if(!pin&&!c.payment_pin_hash)return jsonResponse({error:"Bitte einen PIN festlegen"},400);if(pin){c.payment_pin_salt=localSalt();c.payment_pin_hash=await localHashPin(pin,c.payment_pin_salt);}c.payment_pin_mode=mode;c.payment_pin_threshold=money(threshold||0);}writeDb(db);return jsonResponse(customerWithTokens(db,c.id,pid));}
    const cpMatch=pathname.match(/^\/api\/customers\/(\d+)\/profile$/);if(cpMatch&&method==="PUT"){const body=await parseBody(options);const r=withDb((db)=>{if(!db.customers.some((x)=>Number(x.id)===Number(cpMatch[1])))return null;const cp=ensureCustomerProfile(db,Number(cpMatch[1]),pid);if(body.active!=null)cp.active=Boolean(body.active);if(body.balance!=null){const b=nonNegativeNumber(body.balance);if(b===null)return{error:"Ungültiges Guthaben"};cp.balance=money(b);}return customerWithTokens(db,cpMatch[1],pid);});return !r?jsonResponse({error:"Kunde nicht gefunden"},404):r.error?jsonResponse(r,400):jsonResponse(r);}
    const clearMatch=pathname.match(/^\/api\/customers\/(\d+)\/transactions$/);if(clearMatch&&method==="DELETE"){withDb((db)=>{const ids=new Set(db.transactions.filter((t)=>Number(t.customer_id)===Number(clearMatch[1])&&Number(t.profile_id)===pid).map((t)=>Number(t.id)));db.transactions=db.transactions.filter((t)=>!(Number(t.customer_id)===Number(clearMatch[1])&&Number(t.profile_id)===pid));db.saleItems=db.saleItems.filter((i)=>!ids.has(Number(i.transaction_id)));});return jsonResponse({success:true});}
    const addToken=pathname.match(/^\/api\/customers\/(\d+)\/tokens$/);if(addToken&&method==="POST"){const body=await parseBody(options);const value=body.type==="nfc"?String(body.value||"").toUpperCase():String(body.value||"");if(!["nfc","qr"].includes(body.type)||!value)return jsonResponse({error:"type und value sind erforderlich"},400);const r=withDb((db)=>{if(tokenExists(db,body.type,value))return{error:"Dieser Wert wird bereits verwendet",status:409};db.tokens.push({id:db.nextIds.token++,customer_id:Number(addToken[1]),type:body.type,value,active:1,created_at:nowIso()});return customerWithTokens(db,addToken[1],pid);});return r.error?jsonResponse({error:r.error},r.status):jsonResponse(r);}
    for(const [suffix,active] of [["deactivate",0],["reactivate",1]]){const m=pathname.match(new RegExp(`^/api/tokens/(\\d+)/${suffix}$`));if(m&&method==="POST"){const r=withDb((db)=>{const t=db.tokens.find((x)=>Number(x.id)===Number(m[1]));if(!t)return null;t.active=active;return customerWithTokens(db,t.customer_id,pid);});return r?jsonResponse(r):jsonResponse({error:"Token nicht gefunden"},404);}}
    const token=pathname.match(/^\/api\/tokens\/(\d+)$/);if(token&&method==="DELETE"){const r=withDb((db)=>{const t=db.tokens.find((x)=>Number(x.id)===Number(token[1]));if(!t)return null;db.tokens=db.tokens.filter((x)=>Number(x.id)!==Number(token[1]));return customerWithTokens(db,t.customer_id,pid);});return r?jsonResponse(r):jsonResponse({error:"Token nicht gefunden"},404);}
    const lookup=pathname.match(/^\/api\/lookup\/(.+)$/);if(lookup&&method==="GET"){const r=lookupCustomer(readDb(),lookup[1],pid);return r?jsonResponse(r):jsonResponse({error:"Kunde ist in diesem Profil nicht aktiv oder wurde nicht gefunden"},404);}
    const topup=pathname.match(/^\/api\/customers\/(\d+)\/topup$/);if(topup&&method==="POST"){const body=await parseBody(options);const amount=positiveNumber(body.amount);if(amount===null)return jsonResponse({error:"Ungültiger Betrag"},400);const r=withDb((db)=>{const c=customerWithTokens(db,topup[1],pid);if(!c?.profile_active)return{error:"Kunde ist in diesem Profil nicht aktiv",status:409};const cp=ensureCustomerProfile(db,c.id,pid);cp.balance=money(cp.balance+amount);db.transactions.push({id:db.nextIds.transaction++,profile_id:pid,customer_id:c.id,amount:money(amount),type:"topup",note:"Aufladung",created_at:nowIso()});return customerWithTokens(db,c.id,pid);});return r.error?jsonResponse({error:r.error},r.status):jsonResponse(r);}

    if(pathname==="/api/checkout/cash"&&method==="POST"){const body=await parseBody(options);const total=positiveNumber(body.total);const tendered=Number(body.tendered);if(total===null||!Number.isFinite(tendered)||tendered<total)return jsonResponse({error:"Ungültiger Barzahlungsbetrag"},400);const r=withDb((db)=>{const rounded=money(total);const items=normalizeCheckoutItems(body);const created=nowIso();const tx={id:db.nextIds.transaction++,profile_id:pid,customer_id:null,amount:rounded,type:"purchase",note:`Einkauf: ${items.map((i)=>`${i.article_name} x${i.quantity}`).join(", ")}`,created_at:created};db.transactions.push(tx);items.forEach((i)=>db.saleItems.push({id:db.nextIds.saleItem++,profile_id:pid,transaction_id:tx.id,customer_id:null,article_id:i.article_id,article_name:i.article_name,quantity:i.quantity,unit_price:i.unit_price,total:i.total,sold_at:created}));return{success:true,transaction_id:tx.id,tendered:money(tendered),change:money(tendered-rounded),payment_mode:"cash"};});return jsonResponse(r);}
    if(pathname==="/api/checkout"&&method==="POST"){const body=await parseBody(options);const total=positiveNumber(body.total);if(!body.card_uid||total===null)return jsonResponse({error:"card_uid und ein gültiger Betrag (> 0) sind erforderlich"},400);const db=readDb();const customer=lookupCustomer(db,body.card_uid,pid);if(!customer)return jsonResponse({error:"Kunde ist in diesem Profil nicht aktiv oder wurde nicht gefunden"},404);const rawCustomer=db.customers.find((x)=>Number(x.id)===Number(customer.id));if(localPinRequired(rawCustomer,total)&&!(await localVerifyPin(rawCustomer,body.payment_pin))){return jsonResponse({error:body.payment_pin?"PIN falsch":"PIN erforderlich",pin_required:true,pin_invalid:Boolean(body.payment_pin),customer_name:customer.name,customer_id:customer.id},428);}const r=withDb((db2)=>{const c=lookupCustomer(db2,body.card_uid,pid);const cp=ensureCustomerProfile(db2,c.id,pid);const rounded=money(total);if(cp.balance<rounded)return{error:"Guthaben zu niedrig",status:402,balance:cp.balance};cp.balance=money(cp.balance-rounded);const items=normalizeCheckoutItems(body);const created=nowIso();const tx={id:db2.nextIds.transaction++,profile_id:pid,customer_id:c.id,amount:rounded,type:"purchase",note:`Einkauf: ${items.map((i)=>`${i.article_name} x${i.quantity}`).join(", ")}`,created_at:created};db2.transactions.push(tx);items.forEach((i)=>db2.saleItems.push({id:db2.nextIds.saleItem++,profile_id:pid,transaction_id:tx.id,customer_id:c.id,article_id:i.article_id,article_name:i.article_name,quantity:i.quantity,unit_price:i.unit_price,total:i.total,sold_at:created}));return{success:true,new_balance:cp.balance,customer_name:c.name};});return r.error?jsonResponse({error:r.error,balance:r.balance},r.status):jsonResponse(r);}
    if(pathname==="/api/transactions"&&method==="GET"){const cid=url.searchParams.get("customer_id");let rows=readDb().transactions.filter((t)=>Number(t.profile_id)===pid);if(cid)rows=rows.filter((t)=>Number(t.customer_id)===Number(cid));rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||Number(b.id)-Number(a.id));return jsonResponse(clone(rows.slice(0,100)));}
    if(pathname==="/api/statistics/sales"&&method==="GET"){const db=readDb();const days=Number(url.searchParams.get("days")||0);const since=days>0?Date.now()-days*86400000:null;let sales=db.transactions.filter((t)=>Number(t.profile_id)===pid&&t.type==="purchase"&&(!since||new Date(t.created_at).getTime()>=since));sales.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));sales=sales.slice(0,500).map((tx)=>({...clone(tx),customer_name:db.customers.find((c)=>Number(c.id)===Number(tx.customer_id))?.name||"Gelöschter Kunde",items:clone(db.saleItems.filter((i)=>Number(i.transaction_id)===Number(tx.id)).length?db.saleItems.filter((i)=>Number(i.transaction_id)===Number(tx.id)):parseItemsFromNote(tx.note))}));const map=new Map();let qty=0;sales.forEach((tx)=>(tx.items||[]).forEach((i)=>{const key=String(i.article_id||i.article_name).toLowerCase();const v=map.get(key)||{article_id:i.article_id||null,article_name:i.article_name||"Artikel",quantity:0,total_amount:0,sales_count:0,first_sold_at:tx.created_at,last_sold_at:tx.created_at};v.quantity+=Number(i.quantity||0);v.total_amount=money(v.total_amount+Number(i.total||0));v.sales_count++;if(tx.created_at<v.first_sold_at)v.first_sold_at=tx.created_at;if(tx.created_at>v.last_sold_at)v.last_sold_at=tx.created_at;map.set(key,v);qty+=Number(i.quantity||0);}));return jsonResponse({totals:{sales_count:sales.length,article_quantity:qty,revenue:money(sales.reduce((sum,t)=>sum+Number(t.amount||0),0))},summary:[...map.values()].sort((a,b)=>b.quantity-a.quantity),sales});}
    if(pathname==="/api/status"&&method==="GET"){const db=readDb();return jsonResponse({app:"KinderKasse",version:"2.1.1",profile:clone(findProfile(db,pid)||db.profiles[0])});}
    return jsonResponse({error:`Lokaler Endpunkt nicht unterstützt: ${method} ${pathname}`},404);
  } catch(err){return jsonResponse({error:err?.message||"Lokaler Datenfehler"},500);}
}
