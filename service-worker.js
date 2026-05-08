/* ===== SERVICE WORKER — App Shell Cache Only ===== */
const CACHE_NAME = 'portfolio-os-v1';
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './data.js',
    './charts.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

/* Install: pre-cache app shell files */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
            .catch(err => console.warn('SW install cache failed:', err))
    );
});

/* Activate: clean up old caches */
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

/* Fetch: network-first for CDN resources, cache-first for app shell */
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests (e.g. POST)
    if (event.request.method !== 'GET') return;

    // For CDN resources (Chart.js, pdf.js, Google Fonts): network-first with no cache fallback
    // This avoids caching issues with versioned CDN resources
    if (url.origin !== self.location.origin) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // If CDN is offline and we have a cached copy, use it
                return caches.match(event.request);
            })
        );
        return;
    }

    // For local app shell files: cache-first, then network
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                // Return cache immediately, update in background
                const fetchPromise = fetch(event.request).then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                }).catch(() => cached);
                return cached;
            }
            return fetch(event.request);
        })
    );
});
