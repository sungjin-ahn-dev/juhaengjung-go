import { describe, expect, it } from "vitest";
import { applyTradeEvent, createTrade, DEFAULT_TRADE_CONFIG as C, TradeError, type Trade } from "../src/index.ts";

const T0 = 1_800_000_000_000;

function newTrade(over: Partial<Parameters<typeof createTrade>[0]> = {}) {
  return createTrade({
    id: "t1",
    listingId: "l1",
    buyerId: "b",
    sellerId: "s",
    title: "카시트",
    category: "car_seat",
    price: 35000,
    source: "drive",
    now: T0,
    timeToBranchS: 300,
    branchAlongM: 20000,
    etaAt: T0 + 600_000,
    detourMin: 6,
    fitLabel: "트렁크에 쏙",
    vehicleModel: "아이오닉 5",
    listingAutoAccept: false,
    fragile: false,
    ...over,
  });
}

const kinds = (e: { kind: string; type?: string }[]) => e.map((x) => (x.kind === "notify" ? `notify:${x.type}` : x.kind));

describe("T9 요청 — 판매자에게 알림, 우회 지점 전까지 유효", () => {
  it("유효 시간은 갈림 지점까지 남은 시간(2~20분으로 자름)", () => {
    expect(newTrade().trade.expiresAt).toBe(T0 + 300_000);
    expect(newTrade({ timeToBranchS: 30 }).trade.expiresAt).toBe(T0 + C.minRequestTtlMs);
    expect(newTrade({ timeToBranchS: 5000 }).trade.expiresAt).toBe(T0 + C.maxRequestTtlMs);
    expect(kinds(newTrade().effects)).toEqual(["trust", "notify:request.new"]);
  });

  it("응답이 없으면 만료, 만료 뒤에는 수락할 수 없다", () => {
    const { trade } = newTrade();
    const r = applyTradeEvent(trade, { type: "TICK" }, trade.expiresAt + 1);
    expect(r.trade.status).toBe("expired");
    expect(() => applyTradeEvent(trade, { type: "SELLER_ACCEPT" }, trade.expiresAt + 1)).toThrow(TradeError);
  });
});

describe("T10 수락 — 대금 보관, 매물 예약, 경유지 확인", () => {
  it("수락하면 대금이 보관되고 매물이 예약된다", () => {
    const { trade } = newTrade();
    const r = applyTradeEvent(trade, { type: "SELLER_ACCEPT" }, T0 + 10_000);
    expect(r.trade.status).toBe("accepted");
    expect(r.trade.payment).toMatchObject({ status: "held", heldAt: T0 + 10_000 });
    expect(kinds(r.effects)).toEqual(["payment", "listing", "trust", "notify:trade.accepted", "notify:trade.accepted"]);
  });

  it("자동 수락도 같은 흐름이고 표시가 남는다", () => {
    const r = applyTradeEvent(newTrade().trade, { type: "AUTO_ACCEPT" }, T0);
    expect(r.trade.autoAccepted).toBe(true);
  });

  it("경유지 확인은 한 번만 판매자에게 알린다", () => {
    const a = applyTradeEvent(newTrade().trade, { type: "SELLER_ACCEPT" }, T0).trade;
    const w1 = applyTradeEvent(a, { type: "WAYPOINT_CONFIRMED" }, T0 + 1);
    expect(kinds(w1.effects)).toEqual(["notify:trade.on_the_way"]);
    expect(applyTradeEvent(w1.trade, { type: "WAYPOINT_CONFIRMED" }, T0 + 2).effects).toEqual([]);
  });
});

describe("T11 도착 예정 공유 — 1분 이상 바뀔 때만 알리고, 3분 전 '나오세요'", () => {
  it("ETA 알림 빈도와 나오세요", () => {
    let t: Trade = applyTradeEvent(newTrade().trade, { type: "SELLER_ACCEPT" }, T0).trade;
    let r = applyTradeEvent(t, { type: "ETA", remainS: 600 }, T0);
    expect(kinds(r.effects)).toEqual(["notify:trade.eta"]);
    t = r.trade;
    r = applyTradeEvent(t, { type: "ETA", remainS: 590 }, T0 + 10_000); // 도착 시각 거의 그대로
    expect(r.effects).toEqual([]);
    t = r.trade;
    r = applyTradeEvent(t, { type: "ETA", remainS: 170 }, T0 + 420_000);
    expect(kinds(r.effects)).toContain("notify:trade.come_out");
    t = r.trade;
    r = applyTradeEvent(t, { type: "ETA", remainS: 100 }, T0 + 490_000);
    expect(kinds(r.effects)).not.toContain("notify:trade.come_out");
    r = applyTradeEvent(r.trade, { type: "ARRIVED" }, T0 + 590_000);
    expect(r.trade.status).toBe("arrived");
    expect(kinds(r.effects)).toEqual(["notify:trade.arrived"]);
  });
});

describe("T12 현장 확인 — 받았어요 / 안 살게요", () => {
  const arrived = () => {
    const a = applyTradeEvent(newTrade().trade, { type: "SELLER_ACCEPT" }, T0).trade;
    return applyTradeEvent(a, { type: "ARRIVED" }, T0 + 500_000).trade;
  };

  it("받았어요 → 판매 완료, 이의 제기 기간 뒤 정산 예정", () => {
    const r = applyTradeEvent(arrived(), { type: "BUYER_RECEIVED" }, T0 + 600_000);
    expect(r.trade.status).toBe("completed");
    expect(r.trade.settleAt).toBe(T0 + 600_000 + C.settleAfterMs);
    expect(kinds(r.effects)).toContain("listing");
    expect(kinds(r.effects)).toContain("personalization_trade");
  });

  it("등록 정보와 다르면 전액 환불, 매물은 다시 판매 중, 판매자 신뢰도 반영", () => {
    const r = applyTradeEvent(arrived(), { type: "BUYER_DECLINE_MISMATCH", reason: "사진과 다른 흠집" }, T0 + 600_000);
    expect(r.trade.status).toBe("declined_mismatch");
    expect(r.trade.payment.status).toBe("refunded");
    expect(r.effects).toContainEqual({ kind: "listing", status: "active" });
    expect(r.effects).toContainEqual({ kind: "trust", who: "seller", field: "mismatch" });
  });

  it("판매자만 '건넸어요'를 누르고 구매자가 답이 없으면 자동 확인", () => {
    const h = applyTradeEvent(arrived(), { type: "SELLER_HANDED" }, T0 + 600_000).trade;
    expect(applyTradeEvent(h, { type: "TICK" }, T0 + 600_000 + C.autoConfirmMs - 1).trade.status).toBe("arrived");
    const r = applyTradeEvent(h, { type: "TICK" }, T0 + 600_000 + C.autoConfirmMs);
    expect(r.trade.status).toBe("completed");
    expect(r.trade.autoConfirmed).toBe(true);
  });
});

describe("T13 정산·취소·노쇼·평가", () => {
  const accepted = () => applyTradeEvent(newTrade().trade, { type: "SELLER_ACCEPT" }, T0).trade;

  it("이의 제기 기간이 지나면 정산 — 대금 확정, 양쪽 완료 수 증가", () => {
    const c = applyTradeEvent(accepted(), { type: "BUYER_RECEIVED" }, T0 + 1000).trade;
    const r = applyTradeEvent(c, { type: "TICK" }, c.settleAt!);
    expect(r.trade.status).toBe("settled");
    expect(r.trade.payment.status).toBe("captured");
    expect(r.effects.filter((e) => e.kind === "trust").length).toBe(2);
  });

  it("요청 단계 구매자 취소는 불이익 없음, 수락 뒤 취소는 신뢰도 반영 + 환불", () => {
    const early = applyTradeEvent(newTrade().trade, { type: "BUYER_CANCEL" }, T0 + 1);
    expect(early.effects.some((e) => e.kind === "trust")).toBe(false);
    const late = applyTradeEvent(accepted(), { type: "BUYER_CANCEL", reason: "급한 일" }, T0 + 1);
    expect(late.trade.payment.status).toBe("refunded");
    expect(late.effects).toContainEqual({ kind: "trust", who: "buyer", field: "canceled" });
  });

  it("판매자 취소 → 구매자에게 알림(경유지 해제), 판매자 신뢰도 반영", () => {
    const r = applyTradeEvent(accepted(), { type: "SELLER_CANCEL", reason: "집에 없어요" }, T0 + 1);
    expect(r.trade.canceledBy).toBe("seller");
    expect(kinds(r.effects)).toContain("notify:trade.canceled");
    expect(r.effects).toContainEqual({ kind: "trust", who: "seller", field: "canceled" });
  });

  it("도착 예정에서 20분이 지나도 안 오면 노쇼 — 환불, 구매자 신뢰도 반영", () => {
    const a = applyTradeEvent(accepted(), { type: "ETA", remainS: 300 }, T0).trade;
    const r = applyTradeEvent(a, { type: "TICK" }, a.etaAt! + C.noShowGraceMs);
    expect(r.trade.status).toBe("no_show");
    expect(r.trade.payment.status).toBe("refunded");
    expect(r.effects).toContainEqual({ kind: "trust", who: "buyer", field: "noShow" });
  });

  it("평가는 완료 뒤 한 번씩", () => {
    const c = applyTradeEvent(accepted(), { type: "BUYER_RECEIVED" }, T0 + 1).trade;
    const r1 = applyTradeEvent(c, { type: "RATE", by: "buyer", stars: 5 }, T0 + 2);
    expect(r1.effects).toEqual([{ kind: "rating", who: "seller", stars: 5 }]);
    expect(applyTradeEvent(r1.trade, { type: "RATE", by: "buyer", stars: 1 }, T0 + 3).effects).toEqual([]);
    expect(() => applyTradeEvent(accepted(), { type: "RATE", by: "buyer", stars: 5 }, T0)).toThrow(TradeError);
  });

  it("잘못된 순서는 막는다", () => {
    expect(() => applyTradeEvent(newTrade().trade, { type: "ARRIVED" }, T0)).toThrow(/응답 대기 상태에서는 도착 처리할 수 없어요/);
  });
});
