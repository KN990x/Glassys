/* Cache name is rewritten at build to glassys-v${root package.json version}. */
const CACHE = "glassys-v0.1.0";
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

function shouldHandle(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (path.startsWith("/api") || path.startsWith("/ws") || path === "/health") return false;
  return true;
}

function isHtml(req, res) {
  if (new URL(req.url).pathname === "/" || req.url.endsWith(".html")) return true;
  const type = res?.headers.get("content-type") || "";
  return type.includes("text/html");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of PRECACHE) {
        try {
          await cache.add(url);
        } catch {
          /* skip missing assets so install can finish */
        }
      }
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();
  const title = data.title || "Glassys";
  const body = data.body || "";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.some((c) => c.focused)) return;
      return self.registration.showNotification(title, { body, icon: "/icon-192.png" });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const hit = clients.find((c) => "focus" in c);
      if (hit) return hit.focus();
      return self.clients.openWindow("/");
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!shouldHandle(url)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          caches.open(CACHE).then((cache) => {
            cache.put(req, res.clone());
            if (isHtml(req, res)) {
              cache.put("/", res.clone());
              cache.put("/index.html", res.clone());
            }
          });
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/") || caches.match("/index.html"))),
  );
});
