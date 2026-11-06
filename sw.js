// Service worker: makes the app work offline.
// Strategy: serve from cache instantly, refresh the cache from the network in the background.
// => After you publish an update, open the app, then close and reopen it to see the new version.
// Bump CACHE whenever you change the list of files below.
const CACHE = 'gym-tracker-v1.1.1';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './seed.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' = skip the phone's HTTP cache so a new version always gets fresh files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req, { cache: 'no-cache' }) // always check GitHub for a newer file
      .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    e.waitUntil(net);
    return hit || (await net) || (await cache.match('./index.html')) || Response.error();
  })());
});
