const API_BASE_KEY = "kasseApiBase";
const CF_CLIENT_ID_KEY = "kasseCloudflareAccessClientId";
const CF_CLIENT_SECRET_KEY = "kasseCloudflareAccessClientSecret";

function safeGet(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function safeSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage kann blockiert sein.
  }
}

export function getApiBase() {
  return safeGet(API_BASE_KEY).replace(/\/$/, "");
}

export function setApiBase(value) {
  const clean = (value || "").trim().replace(/\/$/, "");
  safeSet(API_BASE_KEY, clean);
  return clean;
}

export function getCloudflareAccessConfig() {
  return {
    clientId: safeGet(CF_CLIENT_ID_KEY).trim(),
    clientSecret: safeGet(CF_CLIENT_SECRET_KEY).trim(),
  };
}

export function setCloudflareAccessConfig({ clientId = "", clientSecret = "" } = {}) {
  const cleanClientId = (clientId || "").trim();
  const cleanClientSecret = (clientSecret || "").trim();
  safeSet(CF_CLIENT_ID_KEY, cleanClientId);
  safeSet(CF_CLIENT_SECRET_KEY, cleanClientSecret);
  return { clientId: cleanClientId, clientSecret: cleanClientSecret };
}

export function hasCloudflareAccessConfig() {
  const { clientId, clientSecret } = getCloudflareAccessConfig();
  return Boolean(clientId && clientSecret);
}

export function api(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}${p}`;
}

export function apiHeaders(extraHeaders = {}) {
  const headers = new Headers(extraHeaders || {});
  const { clientId, clientSecret } = getCloudflareAccessConfig();

  if (clientId && clientSecret) {
    headers.set("CF-Access-Client-Id", clientId);
    headers.set("CF-Access-Client-Secret", clientSecret);
  }

  return headers;
}

export function apiFetch(path, options = {}) {
  const { headers, ...rest } = options;
  return fetch(api(path), {
    ...rest,
    headers: apiHeaders(headers),
  });
}

export function assetUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  return api(path);
}

export function needsAuthenticatedAssetFetch(path) {
  if (!path) return false;
  if (/^data:/i.test(path)) return false;
  // Externe Bilder lassen wir unangetastet. Eigene Uploads können bei Cloudflare Access Header brauchen.
  if (/^https?:\/\//i.test(path)) return hasCloudflareAccessConfig();
  return hasCloudflareAccessConfig();
}

export async function loadAssetUrl(path) {
  if (!path) return path;
  if (!needsAuthenticatedAssetFetch(path)) return assetUrl(path);

  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Bild konnte nicht geladen werden: HTTP ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
