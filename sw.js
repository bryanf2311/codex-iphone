// sw.js — Codex service worker. Cache the shell so the PWA installs and
// launches offline; let everything else hit the network. Model weights
// are cached by transformers.js via the browser Cache API.

const CACHE = "codex-shell-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/db.js",
  "./js/editor.js",
  "./js/runner.js",
  "./js/chat.js",
  "./js/localModel.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Network-first for CDN assets (so editor / pyodide / transformers stay fresh);
  // cache-first for shell assets.
  if (url.origin === self.location.origin && SHELL.some((p) => url.pathname.endsWith(p.replace("./", "/")))) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match("./index.html"))));
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
});
