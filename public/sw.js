// Sprout service worker: offline app shell + network-first API with cached fallback.
// The server replaces __BUILD_ID__ with a hash of the app's files, so every deploy produces a new
// service worker. The browser installs it in the background and the page offers an "Update" button.
const BUILD = "__BUILD_ID__";
const VERSION = `sprout-${BUILD}`;
// Caches from versions before the update prompt existed ("sprout-v1" ... "sprout-v4").
const isLegacyCache = (key) => /^sprout-v\d+$/.test(key);
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
  "/js/updater.js",
  "/img/logo-v2.png",
  "/icons/icon-192-v2.png",
  "/icons/favicon-32-v2.png",
  "/manifest.webmanifest",
  "/fonts/geist-mono-latin-600-normal.woff2",
  "/fonts/geist-mono-latin-700-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // cache: "reload" skips the browser's HTTP cache so the new version never precaches stale files.
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })));
      // Pages from before the update prompt can't show it, so move them over right away (one time only).
      // Otherwise the new version waits until the reader taps "Update".
      if ((await caches.keys()).some(isLegacyCache)) await self.skipWaiting();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  let migrating = false;
  const activation = (async () => {
    const keys = await caches.keys();
    migrating = keys.some(isLegacyCache);
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })();
  event.waitUntil(activation);
  // Reload pages still running the old code so they pick up the new version. This must happen after
  // activation finishes: the reload's requests wait for this worker to be active, so awaiting the reload
  // inside waitUntil would deadlock.
  activation.then(async () => {
    if (!migrating) return;
    const wins = await self.clients.matchAll({ type: "window" });
    wins.forEach((w) => w.navigate(w.url).catch(() => {}));
  });
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
