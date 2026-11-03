/** Node 전용 웹 푸시(web-push, VAPID). 키는 저장소에 한 번 만들어 두고 계속 쓴다(바꾸면 기존 구독이 다 끊긴다). */
import webpush from "web-push";
import type { Store } from "./infra.ts";
import type { PushPayload, PushSender, PushSubscriptionJson } from "./push.ts";

interface VapidDoc {
  id: string;
  publicKey: string;
  privateKey: string;
}

export function createWebPushSender(store: Store, opts: { subject?: string; publicKey?: string; privateKey?: string } = {}): PushSender {
  let keys: VapidDoc | undefined = opts.publicKey && opts.privateKey ? { id: "vapid", publicKey: opts.publicKey, privateKey: opts.privateKey } : store.get<VapidDoc>("config", "vapid");
  if (!keys) {
    const k = webpush.generateVAPIDKeys();
    keys = { id: "vapid", publicKey: k.publicKey, privateKey: k.privateKey };
    store.put("config", keys);
  }
  // 푸시 서비스가 연락처로 보는 값. 실제 운영에서는 JHGO_VAPID_SUBJECT로 서비스 연락처를 넣는다
  webpush.setVapidDetails(opts.subject ?? "mailto:push@example.com", keys.publicKey, keys.privateKey);
  const pub = keys.publicKey;
  return {
    publicKey: () => pub,
    async send(sub: PushSubscriptionJson, payload: PushPayload) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: payload.urgent ? 600 : 3600, urgency: payload.urgent ? "high" : "normal" });
        return "ok";
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) return "gone";
        console.warn("push 실패", code ?? (e as Error).message);
        return "error";
      }
    },
  };
}
