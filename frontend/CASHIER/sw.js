/* ==========================================================================
   Season 3 POS — Service Worker (PWA offline support)
   Caches the cashier app shell so the POS can open without internet.
   Orders placed offline are queued by pos.js and synced when the
   connection returns.
   ========================================================================== */

const CACHE_NAME = 'pos-shell-v1';

const APP_SHELL = [
    './pos.html',
    './pos.css',
    './pos.js',
    './sw.js',
    '../assets/logo.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// The API must stay live-first: cached copies only serve as offline fallback.
function isApiRequest(url) {
    return url.pathname.startsWith('/api/');
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.allSettled(APP_SHELL.map(asset => cache.add(asset))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') {
        return; // POST /api/orders etc. pass straight to the network.
    }

    const url = new URL(request.url);

    // Out-of-scope requests (other origins) are left untouched, except the
    // icon library used by the cashier theme.
    if (url.origin !== self.location.origin
        && !url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/')) {
        return;
    }

    if (isApiRequest(url)) {
        event.respondWith(
            fetch(request).catch(() => caches.match(request))
        );
        return;
    }

    // App shell: cache-first with a background refresh so updates land
    // silently on the next visit.
    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request)
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});