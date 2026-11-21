// Caches the app shell so Home Base opens instantly and works offline.
// When you change app files, bump VERSION here and the ?v= number in index.html (and SHELL below).
const VERSION = "home-base-v12";
const SHELL = ["./", "index.html", "styles.css?v=12", "app.js?v=12", "config.js?v=12", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  // "reload" skips the browser's HTTP cache, so a new version never installs old files.
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// App files: network first, always checking with GitHub for a newer copy ("no-cache"),
// with the saved copy as the offline fallback. Requests to other sites pass through untouched.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))),
  );
});
