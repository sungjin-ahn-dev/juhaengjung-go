/**
 * 거래 상태 머신 — T9 요청, T10 수락·대금 보관, T11 도착 예정·도착, T12 현장 확인, T13 정산·환불·취소·노쇼.
 * 순수 함수: (거래, 이벤트, 시각) → (새 거래, 효과 목록). 서버는 효과를 저장·알림·신뢰도에 반영한다.
 */
export type TradeStatus =
  | "requested"
  | "accepted"
  | "arrived"
  | "completed"
  | "settled"
  | "declined"
  | "expired"
  | "canceled"
  | "declined_mismatch"
  | "no_show";

export const TRADE_STATUS_KO: Record<TradeStatus, string> = {
  requested: "판매자 응답 대기",
  accepted: "수락됨 · 오는 중",
  arrived: "도착",
  completed: "건넴 확인 · 정산 대기",
  settled: "정산 완료",
  declined: "판매자가 거절",
  expired: "응답 시간 지남",
  canceled: "취소",
  declined_mismatch: "현장에서 거절 · 환불",
  no_show: "구매자 미도착 · 환불",
};

export const ACTIVE_STATUSES: TradeStatus[] = ["requested", "accepted", "arrived"];
export const TERMINAL_STATUSES: TradeStatus[] = ["settled", "declined", "expired", "canceled", "declined_mismatch", "no_show"];

export type PaymentStatus = "none" | "held" | "captured" | "refunded";

export interface Trade {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  title: string;
  category: string;
  price: number;
  status: TradeStatus;
  source: "drive" | "briefing";
  createdAt: number;
  /** 요청 유효 시각 — 구매자가 우회 지점을 지나기 전까지 */
  expiresAt: number;
  /** 갈림 지점(기준 경로 누적 거리) — 지나치면 요청 만료 */
  branchAlongM: number | null;
  etaAt: number | null;
  lastEtaNotifiedAt: number | null;
  detourMin: number;
  fitLabel: string;
  vehicleModel: string;
  autoAccepted: boolean;
  acceptedAt?: number;
  declinedAt?: number;
  waypointConfirmedAt?: number;
  comeOutSentAt?: number;
  arrivedAt?: number;
  handedAt?: number;
  receivedAt?: number;
  completedAt?: number;
  autoConfirmed?: boolean;
  settleAt?: number;
  settledAt?: number;
  canceledAt?: number;
  canceledBy?: "buyer" | "seller" | "system";
  reason?: string;
  mismatch?: { reason: string; note?: string; at: number };
  payment: { status: PaymentStatus; amount: number; heldAt?: number; capturedAt?: number; refundedAt?: number };
  ratings: { buyerToSeller?: number; sellerToBuyer?: number };
  /** 판매자가 미리 정해 둔 자동 수락 */
  listingAutoAccept: boolean;
  fragile: boolean;
}

export interface TradeConfig {
  /** 도착 몇 초 전에 "나오세요" */
  comeOutBeforeS: number;
  /** 도착 예정에서 이만큼 지나도 안 오면 노쇼 */
  noShowGraceMs: number;
  /** 판매자가 건넨 뒤 구매자 확인이 없으면 자동 확인 */
  autoConfirmMs: number;
  /** 확인 뒤 이의 제기 기간 — 지나면 정산 */
  settleAfterMs: number;
  /** 도착 예정 갱신을 판매자에게 다시 알리는 최소 변화(ms) */
  etaNotifyDeltaMs: number;
  /** 요청 유효 시간 하한·상한 */
  minRequestTtlMs: number;
  maxRequestTtlMs: number;
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  comeOutBeforeS: 180,
  noShowGraceMs: 20 * 60 * 1000,
  autoConfirmMs: 30 * 60 * 1000,
  settleAfterMs: 30 * 60 * 1000,
  etaNotifyDeltaMs: 60 * 1000,
  minRequestTtlMs: 2 * 60 * 1000,
  maxRequestTtlMs: 20 * 60 * 1000,
};

export type TradeEvent =
  | { type: "SELLER_ACCEPT" }
  | { type: "AUTO_ACCEPT" }
  | { type: "SELLER_DECLINE"; reason?: string }
  | { type: "EXPIRE"; reason?: string }
  | { type: "WAYPOINT_CONFIRMED" }
  | { type: "ETA"; remainS: number }
  | { type: "ARRIVED" }
  | { type: "SELLER_HANDED" }
  | { type: "BUYER_RECEIVED" }
  | { type: "BUYER_DECLINE_MISMATCH"; reason: string; note?: string }
  | { type: "BUYER_CANCEL"; reason?: string }
  | { type: "SELLER_CANCEL"; reason?: string }
  | { type: "TICK" }
  | { type: "RATE"; by: "buyer" | "seller"; stars: number };

export type Effect =
  | { kind: "notify"; to: "buyer" | "seller"; type: string; data?: Record<string, unknown> }
  | { kind: "trust"; who: "buyer" | "seller"; field: "requests" | "responded" | "completed" | "canceled" | "noShow" | "mismatch" }
  | { kind: "rating"; who: "buyer" | "seller"; stars: number }
  | { kind: "payment"; action: "hold" | "capture" | "refund"; amount: number }
  | { kind: "listing"; status: "active" | "reserved" | "sold" }
  | { kind: "personalization_trade"; category: string };

export class TradeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface NewTradeInput {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  title: string;
  category: string;
  price: number;
  source: "drive" | "briefing";
  now: number;
  timeToBranchS: number | null;
  branchAlongM: number | null;
  etaAt: number;
  detourMin: number;
  fitLabel: string;
  vehicleModel: string;
  listingAutoAccept: boolean;
  fragile: boolean;
}

export function createTrade(i: NewTradeInput, cfg: TradeConfig = DEFAULT_TRADE_CONFIG): { trade: Trade; effects: Effect[] } {
  const ttl = Math.max(cfg.minRequestTtlMs, Math.min(cfg.maxRequestTtlMs, (i.timeToBranchS ?? 600) * 1000));
  const trade: Trade = {
    id: i.id,
    listingId: i.listingId,
    buyerId: i.buyerId,
    sellerId: i.sellerId,
    title: i.title,
    category: i.category,
    price: i.price,
    status: "requested",
    source: i.source,
    createdAt: i.now,
    expiresAt: i.now + ttl,
    branchAlongM: i.branchAlongM,
    etaAt: i.etaAt,
    lastEtaNotifiedAt: null,
    detourMin: i.detourMin,
    fitLabel: i.fitLabel,
    vehicleModel: i.vehicleModel,
    autoAccepted: false,
    payment: { status: "none", amount: i.price },
    ratings: {},
    listingAutoAccept: i.listingAutoAccept,
    fragile: i.fragile,
  };
  const effects: Effect[] = [
    { kind: "trust", who: "seller", field: "requests" },
    { kind: "notify", to: "seller", type: "request.new", data: { etaAt: trade.etaAt, expiresAt: trade.expiresAt } },
  ];
  return { trade, effects };
}

function need(t: Trade, ok: TradeStatus[], ev: string) {
  if (!ok.includes(t.status)) throw new TradeError("bad_state", `${TRADE_STATUS_KO[t.status]} 상태에서는 ${ev}할 수 없어요`);
}

function accept(t: Trade, now: number, auto: boolean): { trade: Trade; effects: Effect[] } {
  need(t, ["requested"], "수락");
  if (now >= t.expiresAt) throw new TradeError("expired", "응답 시간이 지났어요");
  const trade: Trade = {
    ...t,
    status: "accepted",
    acceptedAt: now,
    autoAccepted: auto,
    payment: { ...t.payment, status: "held", heldAt: now },
  };
  return {
    trade,
    effects: [
      { kind: "payment", action: "hold", amount: t.price },
      { kind: "listing", status: "reserved" },
      { kind: "trust", who: "seller", field: "responded" },
      { kind: "notify", to: "buyer", type: "trade.accepted", data: { auto } },
      { kind: "notify", to: "seller", type: "trade.accepted", data: { auto } },
    ],
  };
}

function refund(t: Trade, now: number): { payment: Trade["payment"]; effects: Effect[] } {
  if (t.payment.status === "held") {
    return { payment: { ...t.payment, status: "refunded", refundedAt: now }, effects: [{ kind: "payment", action: "refund", amount: t.price }] };
  }
  return { payment: t.payment, effects: [] };
}

export function applyTradeEvent(t: Trade, ev: TradeEvent, now: number, cfg: TradeConfig = DEFAULT_TRADE_CONFIG): { trade: Trade; effects: Effect[] } {
  switch (ev.type) {
    case "SELLER_ACCEPT":
      return accept(t, now, false);
    case "AUTO_ACCEPT":
      return accept(t, now, true);
    case "SELLER_DECLINE": {
      need(t, ["requested"], "거절");
      return {
        trade: { ...t, status: "declined", declinedAt: now, reason: ev.reason },
        effects: [
          { kind: "trust", who: "seller", field: "responded" },
          { kind: "notify", to: "buyer", type: "trade.declined", data: { reason: ev.reason } },
        ],
      };
    }
    case "EXPIRE": {
      need(t, ["requested"], "만료");
      return {
        trade: { ...t, status: "expired", reason: ev.reason ?? "응답 시간이 지났어요" },
        effects: [
          { kind: "notify", to: "buyer", type: "trade.expired", data: { reason: ev.reason } },
          { kind: "notify", to: "seller", type: "trade.expired", data: { reason: ev.reason } },
        ],
      };
    }
    case "WAYPOINT_CONFIRMED": {
      need(t, ["accepted"], "경유지 확인");
      if (t.waypointConfirmedAt) return { trade: t, effects: [] };
      return {
        trade: { ...t, waypointConfirmedAt: now },
        effects: [{ kind: "notify", to: "seller", type: "trade.on_the_way", data: { etaAt: t.etaAt } }],
      };
    }
    case "ETA": {
      need(t, ["accepted"], "도착 예정 갱신");
      const etaAt = now + Math.max(0, Math.round(ev.remainS * 1000));
      const effects: Effect[] = [];
      let trade: Trade = { ...t, etaAt };
      const changed = t.lastEtaNotifiedAt === null || t.etaAt === null || Math.abs(etaAt - t.etaAt) >= cfg.etaNotifyDeltaMs;
      if (changed) {
        trade.lastEtaNotifiedAt = now;
        effects.push({ kind: "notify", to: "seller", type: "trade.eta", data: { etaAt, remainS: ev.remainS } });
      }
      if (ev.remainS <= cfg.comeOutBeforeS && !t.comeOutSentAt) {
        trade = { ...trade, comeOutSentAt: now };
        effects.push({ kind: "notify", to: "seller", type: "trade.come_out", data: { etaAt, remainS: ev.remainS } });
      }
      return { trade, effects };
    }
    case "ARRIVED": {
      need(t, ["accepted"], "도착 처리");
      return {
        trade: { ...t, status: "arrived", arrivedAt: now, etaAt: now },
        effects: [{ kind: "notify", to: "seller", type: "trade.arrived" }],
      };
    }
    case "SELLER_HANDED": {
      need(t, ["accepted", "arrived"], "건넴 표시");
      return {
        trade: { ...t, handedAt: now },
        effects: [{ kind: "notify", to: "buyer", type: "trade.handed" }],
      };
    }
    case "BUYER_RECEIVED": {
      need(t, ["accepted", "arrived"], "받음 확인");
      return {
        trade: { ...t, status: "completed", receivedAt: now, completedAt: now, settleAt: now + cfg.settleAfterMs },
        effects: [
          { kind: "listing", status: "sold" },
          { kind: "personalization_trade", category: t.category },
          { kind: "notify", to: "seller", type: "trade.received", data: { settleAt: now + cfg.settleAfterMs } },
          { kind: "notify", to: "buyer", type: "trade.received", data: { settleAt: now + cfg.settleAfterMs } },
        ],
      };
    }
    case "BUYER_DECLINE_MISMATCH": {
      need(t, ["accepted", "arrived"], "현장 거절");
      const r = refund(t, now);
      return {
        trade: { ...t, status: "declined_mismatch", mismatch: { reason: ev.reason, note: ev.note, at: now }, payment: r.payment },
        effects: [
          ...r.effects,
          { kind: "listing", status: "active" },
          { kind: "trust", who: "seller", field: "mismatch" },
          { kind: "notify", to: "seller", type: "trade.mismatch", data: { reason: ev.reason, note: ev.note } },
          { kind: "notify", to: "buyer", type: "trade.refunded" },
        ],
      };
    }
    case "BUYER_CANCEL": {
      need(t, ["requested", "accepted", "arrived"], "취소");
      const r = refund(t, now);
      const effects: Effect[] = [...r.effects, { kind: "notify", to: "seller", type: "trade.canceled", data: { by: "buyer", reason: ev.reason } }];
      if (t.status !== "requested") effects.push({ kind: "trust", who: "buyer", field: "canceled" }, { kind: "listing", status: "active" });
      return { trade: { ...t, status: "canceled", canceledAt: now, canceledBy: "buyer", reason: ev.reason, payment: r.payment }, effects };
    }
    case "SELLER_CANCEL": {
      need(t, ["accepted", "arrived"], "취소");
      const r = refund(t, now);
      return {
        trade: { ...t, status: "canceled", canceledAt: now, canceledBy: "seller", reason: ev.reason, payment: r.payment },
        effects: [
          ...r.effects,
          { kind: "trust", who: "seller", field: "canceled" },
          { kind: "listing", status: "active" },
          { kind: "notify", to: "buyer", type: "trade.canceled", data: { by: "seller", reason: ev.reason } },
        ],
      };
    }
    case "RATE": {
      need(t, ["completed", "settled"], "평가");
      const stars = Math.max(1, Math.min(5, Math.round(ev.stars)));
      const ratings = { ...t.ratings };
      if (ev.by === "buyer") {
        if (ratings.buyerToSeller) return { trade: t, effects: [] };
        ratings.buyerToSeller = stars;
      } else {
        if (ratings.sellerToBuyer) return { trade: t, effects: [] };
        ratings.sellerToBuyer = stars;
      }
      return { trade: { ...t, ratings }, effects: [{ kind: "rating", who: ev.by === "buyer" ? "seller" : "buyer", stars }] };
    }
    case "TICK":
      return tick(t, now, cfg);
  }
}

function tick(t: Trade, now: number, cfg: TradeConfig): { trade: Trade; effects: Effect[] } {
  if (t.status === "requested" && now >= t.expiresAt) return applyTradeEvent(t, { type: "EXPIRE" }, now, cfg);
  if (t.status === "accepted" && t.etaAt !== null && !t.handedAt && now >= t.etaAt + cfg.noShowGraceMs) {
    const r = refund(t, now);
    return {
      trade: { ...t, status: "no_show", reason: "도착 예정 시각이 한참 지났어요", payment: r.payment },
      effects: [
        ...r.effects,
        { kind: "listing", status: "active" },
        { kind: "trust", who: "buyer", field: "noShow" },
        { kind: "notify", to: "seller", type: "trade.no_show" },
        { kind: "notify", to: "buyer", type: "trade.no_show" },
      ],
    };
  }
  if ((t.status === "accepted" || t.status === "arrived") && t.handedAt && !t.receivedAt && now >= t.handedAt + cfg.autoConfirmMs) {
    const r = applyTradeEvent(t, { type: "BUYER_RECEIVED" }, now, cfg);
    return { trade: { ...r.trade, autoConfirmed: true }, effects: r.effects };
  }
  if (t.status === "completed" && t.settleAt !== undefined && now >= t.settleAt) {
    return {
      trade: { ...t, status: "settled", settledAt: now, payment: { ...t.payment, status: "captured", capturedAt: now } },
      effects: [
        { kind: "payment", action: "capture", amount: t.price },
        { kind: "trust", who: "seller", field: "completed" },
        { kind: "trust", who: "buyer", field: "completed" },
        { kind: "notify", to: "seller", type: "trade.settled", data: { amount: t.price } },
        { kind: "notify", to: "buyer", type: "trade.settled", data: { amount: t.price } },
      ],
    };
  }
  return { trade: t, effects: [] };
}
