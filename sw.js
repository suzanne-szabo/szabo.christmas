// Minimal service worker: lets the site be installed on phones and opens
// the last-seen version when offline. Always tries the network first, so
// updates show up right away.
const CACHE = "wishlists-v1";
const SHELL = ["./", "index.html", "tailwind.css", "styles.css", "app.js", "config.js", "manifest.webmanifest",
    "icons/icon-192.png", "assets/backgroundMobile.jpg", "assets/backgroundDesk.jpg"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== "GET" || url.origin !== location.origin) return;
    e.respondWith(
        fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
        }).catch(() => caches.match(e.request).then((r) => r || caches.match("./")))
    );
});
