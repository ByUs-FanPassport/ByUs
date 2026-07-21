const CACHE_NAME = "byus-shell-v1";
const PUBLIC_SHELL = ["/", "/manifest.webmanifest", "/byus-app-icon-192.png", "/byus-app-icon-512.png", "/images/guest-home/byus-wordmark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !PUBLIC_SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request)));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const notificationId = typeof payload.notificationId === "string" && /^[0-9a-f-]{36}$/.test(payload.notificationId) ? payload.notificationId : null;
  const title = typeof payload.title === "string" ? payload.title : "ByUs 알림";
  const body = typeof payload.body === "string" ? payload.body : "새 알림을 확인해 주세요.";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "/byus-app-icon-192.png", badge: "/byus-app-icon-192.png",
    tag: notificationId ? `notification:${notificationId}` : "byus-notification",
    data: { notificationId },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.notificationId;
  const path = id && /^[0-9a-f-]{36}$/.test(id) ? `/notifications?open=${encodeURIComponent(id)}` : "/notifications";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const target = new URL(path, self.location.origin).href;
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        client.navigate(target); return client.focus();
      }
    }
    return clients.openWindow(target);
  }));
});
