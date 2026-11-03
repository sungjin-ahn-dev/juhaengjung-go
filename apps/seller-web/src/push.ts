/**
 * 판매자 웹 푸시(T24) — 페이지를 닫아 둬도 "사러 오는 차가 있어요"를 받게 한다.
 * 서비스 워커는 https(또는 localhost)에서만 돈다. 아이폰은 홈 화면에 추가한 앱에서만 웹 푸시를 받는다.
 */
import type { ApiClient } from "@jhgo/api";

export type PushState =
  | { kind: "off" }
  | { kind: "on" }
  | { kind: "unavailable"; why: string }
  | { kind: "denied" }
  | { kind: "busy" };

function b64urlToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** 이 브라우저에서 웹 푸시를 받을 수 있는지 — 안 되면 이유 */
export function pushSupport(serverHasPush: boolean): { ok: true } | { ok: false; why: string } {
  if (!serverHasPush) return { ok: false, why: "이 서버는 웹 푸시를 쓰지 않아요" };
  if (!window.isSecureContext) return { ok: false, why: "알림은 https 주소에서 열었을 때만 받을 수 있어요" };
  if (isIos() && !isStandalone()) return { ok: false, why: "아이폰은 공유 버튼으로 홈 화면에 추가한 뒤, 그 아이콘으로 열면 알림을 받을 수 있어요" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { ok: false, why: "이 브라우저는 웹 푸시를 지원하지 않아요" };
  return { ok: true };
}

/** 알림 권한 — 권한 API가 있으면 그 값을 쓴다(Notification.permission만 늘 'denied'로 답하는 브라우저가 있다) */
async function notifPermission(): Promise<NotificationPermission> {
  try {
    const q = await navigator.permissions?.query({ name: "notifications" as PermissionName });
    if (q) return q.state === "prompt" ? "default" : (q.state as NotificationPermission);
  } catch {
    /* 권한 API가 알림을 모르면 아래로 */
  }
  return Notification.permission;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  return reg;
}

/** 지금 구독 상태(권한이 이미 있으면 서버에도 다시 알려 둔다 — 시연 초기화·재로그인 뒤에도 이어지게) */
export async function currentPush(client: ApiClient, serverHasPush: boolean): Promise<PushState> {
  const sup = pushSupport(serverHasPush);
  if (!sup.ok) return { kind: "unavailable", why: sup.why };
  const perm = await notifPermission();
  if (perm === "denied") return { kind: "denied" };
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || perm !== "granted") return { kind: "off" };
  try {
    await client.call("POST", "/v1/push/subscribe", { subscription: sub.toJSON() });
    return { kind: "on" };
  } catch {
    return { kind: "off" };
  }
}

export async function enablePush(client: ApiClient): Promise<PushState> {
  const asked = await Notification.requestPermission();
  const perm = asked === "granted" ? asked : await notifPermission();
  if (perm !== "granted") return perm === "denied" ? { kind: "denied" } : { kind: "off" };
  const { publicKey } = await client.call<{ publicKey: string }>("GET", "/v1/push/key");
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) as unknown as BufferSource }));
  await client.call("POST", "/v1/push/subscribe", { subscription: sub.toJSON() });
  return { kind: "on" };
}

export async function disablePush(client: ApiClient): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await client.call("POST", "/v1/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => false);
  }
  return { kind: "off" };
}
