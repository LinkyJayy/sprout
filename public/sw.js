// Sprout service worker: offline app shell + network-first API with cached fallback.
const VERSION = "sprout-v4";
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
  "/js/views/updates.js",
  "/js/views/about.js",
  "/js/push.js",
  "/img/logo-v2.png",
  "/icons/icon-192-v2.png",
  "/icons/favicon-32-v2.png",
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

// ───────── Push notifications ─────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Sprout", body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Sprout", {
      body: data.body || "",
      icon: "/icons/icon-192-v2.png",
      badge: "/icons/badge-96-v2.png",
      tag: data.tag,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.location.origin));
      if (win) return win.navigate(url).then((w) => (w || win).focus());
      return self.clients.openWindow(url);
    })
  );
});
