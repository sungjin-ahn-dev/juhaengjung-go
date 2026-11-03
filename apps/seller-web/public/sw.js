/* 주행중GO! 판매자 알림 서비스 워커 — 서버가 보낸 웹 푸시를 알림으로 띄우고, 누르면 판매자 화면을 연다. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = { title: "주행중GO!", body: "", tag: "jhgo", url: "./", urgent: false };
  try {
    d = { ...d, ...e.data.json() };
  } catch (_) {
    if (e.data) d.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      tag: d.tag,
      renotify: true,
      requireInteraction: !!d.urgent,
      icon: "icon-192.png",
      badge: "icon-192.png",
      vibrate: d.urgent ? [300, 120, 300, 120, 300] : [200],
      data: { url: d.url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
