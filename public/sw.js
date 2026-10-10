// Sprout service worker: offline app shell + network-first API with cached fallback.
const VERSION = "sprout-v1";
const SHELL = [
  "/",
  "/css/app.css",
  "/js/theme.js",
  "/js/app.js",
  "/js/api.js",
  "/js/ui.js",
  "/js/views/home.js",
  "/js/views/article.js",
  "/js/views/auth.js",
  "/js/views/studio.js",
  "/img/logo.png",
  "/icons/icon-192.png",
  "/icons/favicon-32.png",
  "/manifest.webmanifest",
  "/fonts/geist-mono-latin-600-normal.woff2",
  "/fonts/geist-mono-latin-700-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(fallbackUrl || request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(fallbackUrl || request);
    if (hit) return hit;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;

  // Page navigations: always try the network, fall back to the cached shell.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/").catch(() => caches.match("/")));
    return;
  }

  // Public article data: fresh when online, last-seen copy when offline.
  if (url.pathname.startsWith("/api/articles")) {
    event.respondWith(
      networkFirst(request).catch(
        () => new Response(JSON.stringify({ error: "You're offline." }), { status: 503, headers: { "content-type": "application/json" } })
      )
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // auth, studio, etc. — never cached

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
