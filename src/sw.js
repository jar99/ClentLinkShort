/**
 * The service worker: after one visit, the page works with no connection at
 * all. That matters more here than for most sites — a Clent link contains
 * its whole destination, so decoding one needs no network, and the only
 * thing standing between an offline phone and its destination is this file.
 *
 * Strategy: network-first with cache fallback. A cached page is only ever
 * served when the network can't answer — because the page embeds the wire
 * tables, and a page cached before a deploy can mis-decode a link made
 * after it. Freshness is correctness here, not a nicety; the cache exists
 * for offline, and offline still works. The cache name carries the build
 * hash ("{{cacheVersion}}" is substituted by tools/build.mjs), so a new
 * deploy activates a fresh cache and the old one is deleted.
 *
 * This is a classic script, deliberately not part of the page bundle: a
 * service worker must be its own same-origin file.
 */

/* eslint-env serviceworker */

const CACHE = "clent-{{cacheVersion}}";
const PAGES = ["./", "./404.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  // The page itself must cache; the extras are best-effort (dev serving has
  // no 404.html, and failing the whole install over it would be silly).
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all([
        cache.add("./"),
        ...PAGES.slice(1).map((page) => cache.add(page).catch(() => {})),
      ]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Only same-origin navigations and our own assets; anything else (the
  // destination a link redirects to, for one) goes straight to the network.
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: request.mode === "navigate" })
          .then((cached) => cached ?? Response.error()),
      ),
  );
});
