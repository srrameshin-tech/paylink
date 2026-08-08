const CACHE_NAME = "paylink-v4";
const ASSETS = [];

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// network-only strategy - always bypass HTTP cache too
const BYPASS = [
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebasedatabase.app",
  "gstatic.com",
  "workers.dev"
];

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const host = new URL(e.request.url).hostname;
  if (BYPASS.some((d) => host.endsWith(d) || host.indexOf(d) !== -1)) return;
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .catch(() => caches.match(e.request))
  );
});
