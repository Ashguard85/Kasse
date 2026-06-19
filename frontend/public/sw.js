// Service Worker — minimal, aber MIT fetch-Handler.
//
// Chrome verlangt für die "echte" PWA-Installierbarkeit (statt nur
// "Zur Startseite hinzufügen") einen registrierten Service Worker MIT
// fetch-Event-Handler. Ohne fetch-Handler zeigt Chrome nur die einfache
// Verknüpfungs-Option, nicht "App installieren".
//
// Gleichzeitig darf der Handler Cloudflare Access nicht stören: das
// CF_Authorization-Cookie muss bei jedem Request mitgeschickt werden
// (credentials: 'include'), und Redirects/Fehler dürfen nicht
// "verschluckt" werden, sonst entstehen wieder 404s bei Bildern.
//
// Strategie: reiner Passthrough mit explizit korrekten Credentials.
// Kein Caching, keine eigene Fehlerbehandlung, kein Eingriff in Redirects
// — der Service Worker tut im Endeffekt fast nichts inhaltlich, erfüllt
// aber formal Chromes Installierbarkeits-Kriterium.

const CACHE = 'kasse-v2';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  // credentials: 'include' stellt sicher, dass das CF_Authorization-Cookie
  // bei JEDEM Request mitgeschickt wird, auch für Bilder/Subresources —
  // das ist der Teil, der vorher beim normalen fetch() durch den SW
  // manchmal verloren ging und zu Cloudflare-Access-Redirects führte.
  e.respondWith(
    fetch(e.request, { credentials: 'include' })
  );
  // Kein .catch(), kein Cache-Fallback, keine Sonderbehandlung von
  // response.type === 'opaqueredirect' — der Browser bekommt exakt das,
  // was das Netzwerk zurückgibt, als wäre kein Service Worker involviert.
});
