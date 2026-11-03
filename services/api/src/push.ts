/**
 * 판매자 웹 푸시(T24) — 판매자 페이지를 닫아 둬도 "사러 오는 차가 있어요"를 받게 한다.
 * 보내는 쪽은 주입한다: Node 서버는 web-push(VAPID), 브라우저 시연에는 없다(서비스 워커가 안 되는 환경).
 */
export interface PushSubscriptionJson {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** 같은 거래 알림은 같은 tag로 묶어 최신 것만 보인다 */
  tag: string;
  url: string;
  /** 차가 오는 요청처럼 놓치면 안 되는 알림 */
  urgent?: boolean;
}

export interface PushSender {
  /** 브라우저 pushManager.subscribe에 넣는 VAPID 공개 키(base64url) */
  publicKey(): string;
  /** "gone"이면 구독이 끝난 것(브라우저가 해지) → 저장소에서 지운다 */
  send(sub: PushSubscriptionJson, payload: PushPayload): Promise<"ok" | "gone" | "error">;
}

export function isPushSubscription(x: unknown): x is PushSubscriptionJson {
  const s = x as PushSubscriptionJson;
  return !!s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && !!s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
}
