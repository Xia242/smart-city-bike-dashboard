const CACHE_NAME = 'citybike-pwa-v1';
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

self.addEventListener('fetch', (e) => {
    // For MQTT connections (wss://), bypass cache
    if (e.request.url.includes('broker.hivemq.com')) {
        return;
    }
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
