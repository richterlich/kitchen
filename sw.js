// Offline-Cache: App funktioniert nach dem ersten Öffnen ohne Internet.
const CACHE = 'rezeptkartei-v6';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js', 'lib/tesseract/lang/deu.traineddata.gz'];
// Texterkennungs-Kern (je nach Gerät eine der beiden Varianten) – im Hintergrund nachladen
const LATER = ['lib/tesseract/core/tesseract-core-simd-lstm.wasm.js', 'lib/tesseract/core/tesseract-core-lstm.wasm.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => {
    c.addAll(LATER).catch(() => {});
    return c.addAll(FILES);
  }).then(() => self.skipWaiting()));
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
  const fromNet = () => fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  if (url.pathname.includes('/lib/')) {
    e.respondWith(fromCache().then((hit) => hit || fromNet()));
  } else {
    e.respondWith(fromNet().catch(() => fromCache().then((hit) => hit || caches.match('index.html'))));
  }
});
