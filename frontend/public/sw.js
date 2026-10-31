// KinderKasse 2.9.5 — network-only service worker.
// Keep PWA install support without caching app files or API responses.
// Retain Cloudflare Access credentials on same-origin requests.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;
  const startupFile = request.mode === 'navigate' ||
    url.pathname === '/' || url.pathname === '/index.html' ||
    url.pathname.startsWith('/assets/');
  event.respondWith(fetch(request, {
    credentials: 'include',
    cache: startupFile ? 'no-store' : 'default',
  }));
});
