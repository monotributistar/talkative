/**
 * Service Worker — Seguridad Cariló PWA
 *
 * Strategy: Cache static assets for instant loading.
 * API calls always go to network (no offline data cache).
 */

const CACHE_NAME = "seguridad-carilo-v1";

const STATIC_ASSETS = [
  "/resident.html",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls — always network
  if (url.pathname.startsWith("/community/") || url.pathname.startsWith("/api/")) {
    return;
  }

  // Static assets — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache JS/CSS bundles on first load
        if (response.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
