const CACHE_NAME = 'citybike-pwa-v2';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './js/state.js',
    './js/chart-builder.js',
    './js/ui-core.js',
    './js/journey.js',
    './js/mqtt-client.js',
    './icon.svg',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('citybike-pwa-') && key !== CACHE_NAME)
            .map(key => caches.delete(key))
    )));
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
    // Prefer current source so a deployed fix is not hidden by stale cached JavaScript.
    event.respondWith(fetch(event.request).then(async response => {
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
        }
        return response;
    }).catch(async () => {
        const cached = await (await caches.open(CACHE_NAME)).match(event.request);
        return cached || Response.error();
    }));
});
