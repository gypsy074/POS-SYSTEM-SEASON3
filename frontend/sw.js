const CACHE_NAME = "season3-pwa-v3";
const APP_SHELL = [
    "/",
    "/login.html",
    "/login.css",
    "/login.js",
    "/manifest.webmanifest",
    "/assets/logo.png",
    "/assets/pwa-icon-180.png",
    "/assets/pwa-icon-192.png",
    "/assets/pwa-icon-512.png",
    "/js/pwa.js",
    "/js/pwa.css",
    "/js/passwordToggle.js",
    "/js/peekCup.js",
    "/js/logoutTransition.js",
    "/css/cup-transition.css",
    "/CASHIER/pos.html",
    "/CASHIER/pos.css",
    "/CASHIER/pos.js",
    "/CASHIER/sw.js",
    "/ADMIN/admin.html",
    "/ADMIN/admin.css",
    "/ADMIN/js/account.js",
    "/js/lottie-anim.js",
    "/vendor/lottie.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css"
];

function isApiRequest(url) {
    return url.pathname.startsWith("/api/");
}

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.allSettled(APP_SHELL.map(asset => cache.add(asset))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key.startsWith("season3-pwa-") && key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin
        && !url.href.startsWith("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/")) return;

    if (isApiRequest(url)) {
        event.respondWith(
            fetch(request).then(response => {
                if (response.ok && url.pathname === "/api/products") {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            }).catch(() => caches.match(request))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request).then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            }).catch(() => cached);
            return cached || network;
        })
    );
});
