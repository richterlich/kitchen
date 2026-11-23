// Offline-Cache: App funktioniert nach dem ersten Öffnen ohne Internet.
// Bei jeder Veröffentlichung erhöhen, damit Handys das Update sofort erkennen
const CACHE = 'rezeptkartei-v0.1.1.2';
// Nur das Nötigste vorab speichern. Der große PDF-Leser-Teil wird erst bei der
// ersten Benutzung geladen und dann offline gespeichert.
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'lib/pdf.min.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// App-Dateien: zuerst online (damit Updates ankommen), sonst aus dem Cache. Große Bibliotheken: Cache zuerst.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const fromCache = () => caches.match(e.request, { ignoreSearch: true });
  // App-Dateien immer beim Server nachfragen (Browser-Zwischenspeicher umgehen)
  const fromNet = () => fetch(e.request, { cache: url.pathname.includes('/lib/') ? 'default' : 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  if (url.pathname.includes('/lib/')) {
    e.respondWith(fromCache().then((hit) => hit || fromNet()));
  } else {
    e.respondWith(fromNet().catch(() => fromCache().then((hit) => hit || caches.match('index.html'))));
  }
});
