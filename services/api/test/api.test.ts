import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_NET, DEMO_PLACES, Graph, GraphRouter, pointAtAlong, timeAtAlong, type DriveContext } from "@jhgo/core";
import { createBackend, createLocalClient, DEMO_SERVICE_CONFIG, DEMO_START, ManualClock, parseAiAssist, parseAiSize, type AppEvent, type ApiClient, type AssistEngine, type BriefEngine, type PushPayload, type PushSender, type SizeEstimator } from "../src/index.ts";
import { SqliteStore } from "../src/store-sqlite.ts";

const router = new GraphRouter(new Graph(DEMO_NET));
const base = router.route([DEMO_PLACES.start, DEMO_PLACES.home])!;

/** 기준 경로에서 출발 t분 뒤 위치 */
function at(min: number) {
  let s = 0;
  while (s < base.distanceM && timeAtAlong(base, s) < min * 60) s += 10;
  return { location: pointAtAlong(base.line, s).point, remainTimeS: Math.round(base.durationS - timeAtAlong(base, s)) };
}

function setup(includeCarSeat = true, extra: { push?: PushSender; sizeAI?: SizeEstimator; briefAI?: BriefEngine; assistAI?: AssistEngine } = {}) {
  const clock = new ManualClock(DEMO_START);
  const b = createBackend({ demo: true, clock, config: DEMO_SERVICE_CONFIG, ...extra });
  const anon = createLocalClient(b);
  return { ...b, clock, anon, includeCarSeat };
}

type Setup = ReturnType<typeof setup>;

async function login(s: Setup, name: string): Promise<ApiClient> {
  const { users } = await s.anon.call<{ users: { id: string; name: string }[] }>("GET", "/v1/demo/users");
  const u = users.find((x) => x.name === name)!;
  const { token } = await s.anon.call<{ token: string }>("POST", "/v1/session", { userId: u.id });
  return createLocalClient(s, token);
}

function ctx(s: Setup, min: number, over: Partial<DriveContext> = {}): DriveContext {
  const p = at(min);
  return {
    now: s.clock.now(),
    navStatus: "ROUTE_DRIVE",
    location: p.location,
    destination: { ...DEMO_PLACES.home, remainTimeS: p.remainTimeS },
    waypointCount: 0,
    socPct: 62,
    seats: { row2Occupied: true },
    ...over,
  };
}

function collect(client: ApiClient) {
  const events: AppEvent[] = [];
  client.subscribe((e) => events.push(e));
  return { events, types: () => events.map((e) => e.type), flush: () => new Promise((r) => setTimeout(r, 5)) };
}

let s: Setup;
let car: ApiClient;
let park: ApiClient;

beforeEach(async () => {
  s = setup();
  await s.anon.call("POST", "/v1/demo/reset", {});
  car = await login(s, "김주행");
  park = await login(s, "박서연");
});

describe("인증과 권한", () => {
  it("토큰 없으면 401, 다른 역할 API는 403", async () => {
    await expect(s.anon.call("GET", "/v1/me")).rejects.toMatchObject({ status: 401 });
    await expect(car.call("GET", "/v1/seller/listings")).rejects.toMatchObject({ status: 403 });
    await expect(park.call("POST", "/v1/drive/context", { ctx: ctx(s, 0) })).rejects.toMatchObject({ status: 403 });
    const me = await car.call<{ user: { name: string; token?: string } }>("GET", "/v1/me");
    expect(me.user.name).toBe("김주행");
    expect(me.user.token).toBeUndefined();
  });
});

describe("T17 같이 올리기 (판매자)", () => {
  it("붙여넣기 → 제목·가격·품목·AI 크기, 큰 물건은 실측 확인이 있어야 등록", async () => {
    const parsed = await park.call<{ title: string; price: number; category: string; sizeEstimate: { sizeCm: { w: number } } }>("POST", "/v1/seller/parse", {
      text: "원목 아기침대 팝니다\n가격 4만원\n분해해 뒀어요",
    });
    expect(parsed).toMatchObject({ title: "원목 아기침대 팝니다", price: 40000, category: "baby_bed" });
    const body = {
      title: parsed.title,
      category: parsed.category,
      price: parsed.price,
      condition: "good",
      sizeCm: parsed.sizeEstimate.sizeCm,
      sizeSource: "ai",
      pickupPoint: { lat: 37.3889, lng: 127.1046, label: "백현동" },
    };
    await expect(park.call("POST", "/v1/seller/listings", body)).rejects.toMatchObject({ status: 422, code: "measure_required" });
    const ok = await park.call<{ listing: { id: string; referencePrice: number; approxArea: { lat: number }; pickupPoint: { lat: number } } }>("POST", "/v1/seller/listings", {
      ...body,
      sizeSource: "seller_measured",
    });
    expect(ok.listing.referencePrice).toBe(90000);
    expect(ok.listing.approxArea.lat).not.toBe(ok.listing.pickupPoint.lat);
  });
});

describe("주행 매칭 (T1~T7, T16)", () => {
  it("출발 전 브리핑: 경로 위 관심 매물 + 제외 이유, 정확한 위치는 안 보인다(T18)", async () => {
    const r = await car.call<{ items: Record<string, unknown>[]; route: { viaNames: string[] } }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    const by = Object.fromEntries(r.items.map((i) => [i.categoryLabel as string, i]));
    expect(Object.keys(by)).toEqual(expect.arrayContaining(["캠핑의자", "아기 침대", "유모차", "카시트"]));
    expect(by["아기 침대"].exclusions).toEqual(["load_seat"]);
    for (const i of r.items) {
      expect(i).not.toHaveProperty("pickupPoint");
      expect(i).toHaveProperty("approxArea");
      // 정확한 지점에서 잰 값은 보내지 않는다(갈림 지점 위치·현재→매물 거리로 지점을 거꾸로 찾을 수 있다)
      for (const k of ["branchAlongM", "distCurToListingM", "tCurToListingS", "distFromRouteM"]) expect(i).not.toHaveProperty(k);
      // 목록용 거리는 대략 위치 기준, 100m 단위
      expect((i.aheadM as number) % 100).toBe(0);
      expect(typeof i.description).toBe("string");
    }
    expect(r.route.viaNames).toContain("판교");
  });

  it("출발 직후 캠핑의자 알림 → '아니요'면 다시 안 알림 → 분당에서 카시트·유모차 경합", async () => {
    const r0 = await car.call<{ top: { categoryLabel: string; listingId: string; speech: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 0) });
    expect(r0.top.categoryLabel).toBe("캠핑의자");
    expect(r0.top.speech).toContain("들를까요?");
    await car.call("POST", "/v1/drive/alerted", { listingIds: [r0.top.listingId] });
    await car.call("POST", "/v1/drive/dismiss", { listingId: r0.top.listingId });
    s.clock.advance(60_000);
    const r1 = await car.call<{ top: unknown }>("POST", "/v1/drive/context", { ctx: ctx(s, 1) });
    expect(r1.top).toBeNull();
    s.clock.advance(12 * 60_000);
    const r2 = await car.call<{ contention: { categoryLabel: string }[] | null }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    expect(r2.contention?.map((c) => c.categoryLabel).sort()).toEqual(["유모차", "카시트"]);
  });

  it("지나친 알림은 개인화 신호(T14): 같은 날은 한 번만, 다른 날 또 지나치면 가중치 0.9", async () => {
    const r0 = await car.call<{ top: { listingId: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 0) });
    await car.call("POST", "/v1/drive/alerted", { listingIds: [r0.top.listingId] });
    s.clock.advance(10 * 60_000);
    const r1 = await car.call<{ notices: { type: string; text: string }[] }>("POST", "/v1/drive/context", { ctx: ctx(s, 10) });
    expect(r1.notices.some((n) => n.type === "personalization")).toBe(true);
    let prof = await car.call<{ user: { personalization: { multipliers: Record<string, number>; skipDays: Record<string, string[]> } } }>("GET", "/v1/buyer/profile");
    expect(prof.user.personalization.skipDays.camping_chair).toHaveLength(1);
    expect(prof.user.personalization.multipliers.camping_chair ?? 1).toBe(1);
    // 다음 날 같은 길에서 또 지나침
    await car.call("POST", "/v1/drive/end", {});
    s.clock.advance(24 * 3600_000 - 10 * 60_000);
    const d2 = await car.call<{ top: { listingId: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 0) });
    await car.call("POST", "/v1/drive/alerted", { listingIds: [d2.top.listingId] });
    s.clock.advance(10 * 60_000);
    await car.call("POST", "/v1/drive/context", { ctx: ctx(s, 10) });
    prof = await car.call("GET", "/v1/buyer/profile");
    expect(prof.user.personalization.multipliers.camping_chair).toBe(0.9);
  });

  it("배터리가 부족하면 먼 매물은 알리지 않는다(T4)", async () => {
    const r = await car.call<{ items: { categoryLabel: string; exclusions: string[] }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0, { socPct: 18 }) });
    expect(r.items.find((i) => i.categoryLabel === "카시트")!.exclusions).toContain("energy");
  });
});

describe("거래 흐름 (T9~T13)", () => {
  async function requestCarSeat() {
    s.clock.advance(13 * 60_000);
    const ev = await car.call<{ candidates: { listingId: string; categoryLabel: string }[] }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    const id = ev.candidates.find((c) => c.categoryLabel === "카시트")!.listingId;
    const r = await car.call<{ trade: { id: string; status: string; pickupPoint: unknown; expiresAt: number } }>("POST", "/v1/drive/request", { ctx: ctx(s, 13), listingId: id });
    return r.trade;
  }

  it("요청 → 판매자 수락 → 대금 보관·경유지 확인 → 도착 예정·나오세요 → 도착 → 받았어요 → 정산", async () => {
    const sellerEv = collect(park);
    const buyerEv = collect(car);
    const t = await requestCarSeat();
    expect(t.status).toBe("requested");
    expect(t.pickupPoint).toBeNull(); // 수락 전에는 정확한 위치 비공개
    await sellerEv.flush();
    expect(sellerEv.types()).toContain("request.new");
    expect(sellerEv.events[0].title).toBe("카시트 사러 오는 차가 있어요");

    // 판매자 화면에는 구매자 위치가 없다
    const st = await park.call<{ trades: Record<string, unknown>[] }>("GET", "/v1/seller/trades");
    const view = st.trades[0];
    expect(JSON.stringify(view)).not.toMatch(/"location"|"destination"|remainDistM/);
    expect((view.buyer as { name: string }).name).toBe("김*행");

    const acc = await park.call<{ trade: { status: string; payment: { status: string } } }>("POST", `/v1/seller/trades/${t.id}/accept`);
    expect(acc.trade).toMatchObject({ status: "accepted", payment: { status: "held" } });
    await buyerEv.flush();
    expect(buyerEv.types()).toContain("trade.accepted");
    const bt = await car.call<{ trade: { pickupPoint: { label: string } } }>("GET", `/v1/buyer/trades/${t.id}`);
    expect(bt.trade.pickupPoint.label).toContain("백현동");

    await car.call("POST", `/v1/buyer/trades/${t.id}/waypoint-confirmed`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/eta`, { remainS: 600 });
    s.clock.advance(7 * 60_000);
    await car.call("POST", `/v1/buyer/trades/${t.id}/eta`, { remainS: 170 });
    s.clock.advance(3 * 60_000);
    await car.call("POST", `/v1/buyer/trades/${t.id}/arrived`);
    await sellerEv.flush();
    expect(sellerEv.types()).toEqual(expect.arrayContaining(["trade.on_the_way", "trade.eta", "trade.come_out", "trade.arrived"]));

    await park.call("POST", `/v1/seller/trades/${t.id}/handed`);
    const rec = await car.call<{ trade: { status: string; settleAt: number } }>("POST", `/v1/buyer/trades/${t.id}/received`);
    expect(rec.trade.status).toBe("completed");
    s.clock.t = rec.trade.settleAt;
    s.svc.tick();
    const sum = await park.call<{ settled: number; held: number; ledger: { action: string; title: string }[]; trust: { completed: number } }>("GET", "/v1/seller/summary");
    expect(sum.settled).toBe(35000);
    expect(sum.held).toBe(0);
    expect(sum.ledger.map((x) => x.action).sort()).toEqual(["capture", "hold"]);
    expect(sum.ledger.every((x) => x.title.includes("카시트"))).toBe(true); // 정산 내역에 어떤 물건인지
    expect(sum.trust.completed).toBe(1);
    const listings = await park.call<{ listings: { status: string }[] }>("GET", "/v1/seller/listings");
    expect(listings.listings[0].status).toBe("sold");

    // 결과 카드
    const end = await car.call<{ items: { categoryLabel: string; separateTripMin: number }[] }>("POST", "/v1/drive/end", { odometerDeltaKm: 37.4 });
    expect(end.items[0].categoryLabel).toBe("카시트");
    expect(end.items[0].separateTripMin).toBeGreaterThan(20);
  });

  it("자동 수락 시간대 매물은 요청 즉시 확정(T10)", async () => {
    const ev = await car.call<{ top: { listingId: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 0) });
    const r = await car.call<{ trade: { status: string; autoAccepted: boolean } }>("POST", "/v1/drive/request", { ctx: ctx(s, 0), listingId: ev.top.listingId });
    expect(r.trade).toMatchObject({ status: "accepted", autoAccepted: true });
  });

  it("응답 없이 우회 지점을 지나면 요청이 끝난다(T9)", async () => {
    const t = await requestCarSeat();
    s.clock.advance(12 * 60_000);
    const r = await car.call<{ notices: { type: string }[] }>("POST", "/v1/drive/context", { ctx: ctx(s, 26) });
    expect(r.notices.some((n) => n.type === "expired")).toBe(true);
    const bt = await car.call<{ trade: { status: string } }>("GET", `/v1/buyer/trades/${t.id}`);
    expect(bt.trade.status).toBe("expired");
  });

  it("진행 중 거래가 있으면 새 알림을 띄우지 않고, 다른 매물 요청도 막는다", async () => {
    await requestCarSeat();
    const r = await car.call<{ top: unknown; activeTrade: { status: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    expect(r.top).toBeNull();
    expect(r.activeTrade.status).toBe("requested");
  });

  it("현장에서 다르면 '안 살게요' → 전액 환불, 매물 다시 판매 중(T12)", async () => {
    const t = await requestCarSeat();
    await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/arrived`);
    const r = await car.call<{ trade: { status: string; payment: { status: string } } }>("POST", `/v1/buyer/trades/${t.id}/decline`, { reason: "사진에 없던 파손" });
    expect(r.trade).toMatchObject({ status: "declined_mismatch", payment: { status: "refunded" } });
    const ls = await park.call<{ listings: { status: string; title: string }[] }>("GET", "/v1/seller/listings");
    expect(ls.listings.find((l) => l.title.includes("카시트"))!.status).toBe("active");
    const sum = await park.call<{ trust: { mismatch: number }; refunded: number }>("GET", "/v1/seller/summary");
    expect(sum.trust.mismatch).toBe(1);
    expect(sum.refunded).toBe(35000);
  });

  it("판매자 취소 → 구매자에게 알림(경유지 해제), 노쇼 → 환불과 구매자 신뢰도(T13)", async () => {
    const buyerEv = collect(car);
    const t = await requestCarSeat();
    await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
    await park.call("POST", `/v1/seller/trades/${t.id}/cancel`, { reason: "급한 일" });
    await buyerEv.flush();
    expect(buyerEv.types()).toContain("trade.canceled");

    // 노쇼
    await park.call("PATCH", `/v1/seller/listings/${(await park.call<{ listings: { id: string }[] }>("GET", "/v1/seller/listings")).listings[0].id}`, { status: "active" });
    const t2 = await car.call<{ trade: { id: string } }>("POST", "/v1/drive/request", {
      ctx: ctx(s, 13),
      listingId: (await park.call<{ listings: { id: string }[] }>("GET", "/v1/seller/listings")).listings[0].id,
    });
    await park.call("POST", `/v1/seller/trades/${t2.trade.id}/accept`);
    await car.call("POST", `/v1/buyer/trades/${t2.trade.id}/eta`, { remainS: 300 });
    s.clock.advance(5 * 60_000 + DEMO_SERVICE_CONFIG.trade!.noShowGraceMs + 1);
    s.svc.tick();
    const bt = await car.call<{ trade: { status: string; payment: { status: string } } }>("GET", `/v1/buyer/trades/${t2.trade.id}`);
    expect(bt.trade).toMatchObject({ status: "no_show", payment: { status: "refunded" } });
    const me = await car.call<{ trust: { noShow: number } }>("GET", "/v1/me");
    expect(me.trust.noShow).toBe(1);
  });

  it("판매자가 안 나오면: 다시 알리기 → 5분 기다린 뒤 끝내기 → 전액 환불·판매자 신뢰도(T20)", async () => {
    const sellerEv = collect(park);
    const scoreOf = async () =>
      (await car.call<{ items: { categoryLabel: string; score: number }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) })).items.find((i) => i.categoryLabel === "카시트")!.score;
    const before = await scoreOf();
    const t = await requestCarSeat();
    await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
    const arr = await car.call<{ trade: { status: string; sellerWaitUntil: number } }>("POST", `/v1/buyer/trades/${t.id}/arrived`);
    expect(arr.trade.sellerWaitUntil).toBe(s.clock.now() + DEMO_SERVICE_CONFIG.trade!.sellerWaitMs);
    await car.call("POST", `/v1/buyer/trades/${t.id}/nudge`);
    await expect(car.call("POST", `/v1/buyer/trades/${t.id}/nudge`)).rejects.toMatchObject({ status: 409, code: "too_soon" });
    await expect(car.call("POST", `/v1/buyer/trades/${t.id}/seller-absent`)).rejects.toMatchObject({ status: 409, code: "too_early" });
    s.clock.advance(DEMO_SERVICE_CONFIG.trade!.sellerWaitMs);
    const r = await car.call<{ trade: { status: string; payment: { status: string } } }>("POST", `/v1/buyer/trades/${t.id}/seller-absent`);
    expect(r.trade).toMatchObject({ status: "seller_no_show", payment: { status: "refunded" } });
    await sellerEv.flush();
    expect(sellerEv.types()).toEqual(expect.arrayContaining(["trade.waiting", "trade.seller_no_show"]));
    const sum = await park.call<{ trust: { noShow: number }; refunded: number }>("GET", "/v1/seller/summary");
    expect(sum.trust.noShow).toBe(1);
    expect(sum.refunded).toBe(35000);
    const ls = await park.call<{ listings: { status: string; title: string }[] }>("GET", "/v1/seller/listings");
    expect(ls.listings.find((l) => l.title.includes("카시트"))!.status).toBe("active");
    // 판매자 신뢰(R)가 0.5로 내려가 같은 매물의 추천 점수가 절반이 된다
    expect(await scoreOf()).toBeCloseTo(before * 0.5, 2);
  });

  it("판매자 '지금 나가요' → 구매자 차에 알림, 거래마다 한 번(T28)", async () => {
    const buyerEv = collect(car);
    const t = await requestCarSeat();
    await expect(park.call("POST", `/v1/seller/trades/${t.id}/coming`)).rejects.toMatchObject({ status: 409 }); // 수락 전
    await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
    const r1 = await park.call<{ trade: { sellerComingAt?: number } }>("POST", `/v1/seller/trades/${t.id}/coming`);
    expect(r1.trade.sellerComingAt).toBe(s.clock.now());
    s.clock.advance(30_000);
    const r2 = await park.call<{ trade: { sellerComingAt?: number } }>("POST", `/v1/seller/trades/${t.id}/coming`);
    expect(r2.trade.sellerComingAt).toBe(r1.trade.sellerComingAt);
    await buyerEv.flush();
    const coming = buyerEv.events.filter((e) => e.type === "trade.seller_coming");
    expect(coming).toHaveLength(1);
    expect(coming[0].title).toBe("판매자가 나오고 있어요");
    expect(coming[0].body).toBe("카시트를 들고 나오는 중이에요.");
    const bt = await car.call<{ trade: { sellerComingAt?: number } }>("GET", `/v1/buyer/trades/${t.id}`);
    expect(bt.trade.sellerComingAt).toBe(r1.trade.sellerComingAt);
  });

  it("현장 거절 뒤 폰에서 사진을 남기면 판매자 지난 거래에 보인다(T12)", async () => {
    const t = await requestCarSeat();
    await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/arrived`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/decline`, { reason: "파손이 있어요" });
    await expect(car.call("POST", `/v1/buyer/trades/${t.id}/evidence`, { photos: ["data:image/svg+xml,<svg/>"] })).rejects.toMatchObject({ status: 422 });
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
    await car.call("POST", `/v1/buyer/trades/${t.id}/evidence`, { photos: [jpeg] });
    const st = await park.call<{ trades: { id: string; mismatch?: { photos?: string[] } }[] }>("GET", "/v1/seller/trades");
    expect(st.trades.find((x) => x.id === t.id)!.mismatch!.photos).toHaveLength(1);
  });

  it("구매자가 받았어요 뒤 판매자를 평가하면 판매자 평점이 생긴다(T21)", async () => {
    const t = await requestCarSeat();
    await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/arrived`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/received`);
    await car.call("POST", `/v1/buyer/trades/${t.id}/rate`, { stars: 4 });
    const sum = await park.call<{ trust: { rating: number } }>("GET", "/v1/seller/summary");
    expect(sum.trust.rating).toBe(4);
    const bt = await car.call<{ trades: { id: string; ratings: { buyerToSeller?: number } }[] }>("GET", "/v1/buyer/trades");
    expect(bt.trades.find((x) => x.id === t.id)!.ratings.buyerToSeller).toBe(4);
  });

  it("결제 수단이 없으면 알리지 않고 요청도 막는다(T23)", async () => {
    await car.call("DELETE", "/v1/buyer/payment-method");
    const ev = await car.call<{ top: unknown; block: { reason: string; text: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 0) });
    expect(ev.top).toBeNull();
    expect(ev.block.reason).toBe("payment");
    await expect(requestCarSeat()).rejects.toMatchObject({ status: 409, code: "payment_required" });
    await expect(car.call("PUT", "/v1/buyer/payment-method", { kind: "card", number: "1234" })).rejects.toMatchObject({ status: 422 });
    const pm = await car.call<{ paymentMethod: { kind: string; label: string } }>("PUT", "/v1/buyer/payment-method", { kind: "test" });
    expect(pm.paymentMethod.kind).toBe("test");
    const prof = await car.call<{ user: { paymentMethod: { kind: string } }; block: unknown }>("GET", "/v1/buyer/profile");
    expect(prof.user.paymentMethod.kind).toBe("test");
    expect(prof.block).toBeNull();
  });

  it("수락 뒤 구매자 취소가 30일에 3번이면 7일 동안 요청 제한, 차 쪽 실패 취소는 세지 않는다(T22)", async () => {
    const cancelOnce = async (system = false) => {
      const t = await requestCarSeat();
      await park.call("POST", `/v1/seller/trades/${t.id}/accept`);
      await car.call("POST", `/v1/buyer/trades/${t.id}/cancel`, { reason: system ? "차 내비가 경유지를 받지 못했어요" : "급한 일", system });
    };
    await cancelOnce();
    await cancelOnce();
    await cancelOnce(true);
    const mid = await car.call<{ block: unknown }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    expect(mid.block).toBeNull();
    await cancelOnce();
    const ev = await car.call<{ top: unknown; block: { reason: string; until: number; text: string } }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    expect(ev.block.reason).toBe("limit");
    expect(ev.block.text).toContain("3번");
    expect(ev.top).toBeNull();
    await expect(requestCarSeat()).rejects.toMatchObject({ status: 409, code: "request_limited" });
  });
});

describe("판매자 편의 (T27 쉬기·기본값, T29 노출 수)", () => {
  it("쉬는 동안 매물이 지나가는 차에 안 보이고 요청도 막힌다. 끄면 다시 보인다", async () => {
    const seatOf = (items: { categoryLabel: string; listingId: string }[]) => items.find((i) => i.categoryLabel === "카시트");
    const before = await car.call<{ items: { categoryLabel: string; listingId: string }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    const seat = seatOf(before.items)!;
    const r = await park.call<{ pause: { until: number | null } }>("PUT", "/v1/seller/pause", { for: "today" });
    expect(r.pause.until).toBeGreaterThan(s.clock.now());
    const me = await park.call<{ user: { pause?: { until: number | null } } }>("GET", "/v1/me");
    expect(me.user.pause?.until).toBe(r.pause.until);
    const during = await car.call<{ items: { categoryLabel: string; listingId: string }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    expect(seatOf(during.items)).toBeUndefined();
    s.clock.advance(13 * 60_000);
    await expect(car.call("POST", "/v1/drive/request", { ctx: ctx(s, 13), listingId: seat.listingId })).rejects.toMatchObject({ status: 409, code: "seller_paused" });
    await park.call("PUT", "/v1/seller/pause", { for: "off" });
    const after = await car.call<{ items: { categoryLabel: string; listingId: string }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 13) });
    expect(seatOf(after.items)).toBeDefined();
    await expect(park.call("PUT", "/v1/seller/pause", { for: "forever" })).rejects.toMatchObject({ status: 422 });
    // 1시간 쉬기는 1시간 뒤 저절로 풀린다
    await park.call("PUT", "/v1/seller/pause", { for: "1h" });
    s.clock.advance(3600_000);
    const later = await car.call<{ items: { categoryLabel: string; listingId: string }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 13) });
    expect(seatOf(later.items)).toBeDefined();
  });

  it("등록하면 장소·시간·자동 수락을 기억해 다음 등록의 기본값으로 준다", async () => {
    const first = await park.call<{ user: { sellerDefaults?: { availability: unknown[]; pickupPoint: { label: string } } } }>("GET", "/v1/me");
    expect(first.user.sellerDefaults).toMatchObject({ availability: [{ days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }], pickupPoint: { label: "판교 백현동 (아파트 정문)" } });
    await park.call("POST", "/v1/seller/listings", {
      title: "아기 의자",
      price: 10000,
      condition: "good",
      sizeCm: { w: 40, d: 40, h: 50 },
      sizeSource: "category",
      pickupPoint: { lat: 37.3889, lng: 127.1046, label: "백현동 놀이터 앞" },
      availability: [],
      autoAccept: true,
    });
    const me = await park.call<{ user: { sellerDefaults: unknown } }>("GET", "/v1/me");
    expect(me.user.sellerDefaults).toMatchObject({ pickupPoint: { label: "백현동 놀이터 앞" }, availability: [], autoAccept: true });
  });

  it("노출 수: 들를 수 있는 추천에 든 주행 수와 음성 알림 수, 판매자에게만", async () => {
    await car.call("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    await car.call("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) }); // 같은 주행은 한 번만 센다
    s.clock.advance(13 * 60_000);
    const ev = await car.call<{ candidates: Record<string, unknown>[] }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    const seat = ev.candidates.find((c) => c.categoryLabel === "카시트")!;
    expect(seat).not.toHaveProperty("stats");
    await car.call("POST", "/v1/drive/alerted", { listingIds: [seat.listingId] });
    await car.call("POST", "/v1/drive/alerted", { listingIds: [seat.listingId] });
    const ls = await park.call<{ listings: { title: string; stats?: { shown: number; alerted: number } }[] }>("GET", "/v1/seller/listings");
    expect(ls.listings.find((l) => l.title.includes("카시트"))!.stats).toEqual({ shown: 1, alerted: 1 });
    // 아기 침대는 2열 착석으로 제외돼 세지 않는다
    const bed = await login(s, "최보정");
    const bl = await bed.call<{ listings: { stats?: { shown: number } }[] }>("GET", "/v1/seller/listings");
    expect(bl.listings[0].stats?.shown ?? 0).toBe(0);
  });
});

describe("3열 착석(T26)", () => {
  it("3열 차에서 3열에 사람이 있으면 '3열 접으면 가능' 매물은 제외 이유와 함께", async () => {
    await car.call("PUT", "/v1/buyer/vehicle", { model: "EV9" });
    const r = await car.call<{ items: { categoryLabel: string; fit: { kind: string }; exclusions: string[] }[] }>("POST", "/v1/drive/briefing", {
      ctx: ctx(s, 0, { seats: { row2Occupied: false, row3Occupied: true } }),
    });
    const seat = r.items.find((i) => i.categoryLabel === "카시트")!;
    expect(seat.fit.kind).toBe("folded3");
    expect(seat.exclusions).toContain("load_seat3");
  });
});

describe("판매자 웹 푸시(T24)", () => {
  it("구독하면 판매자 알림이 푸시로도 가고, 끝난 구독은 지운다", async () => {
    const sent: { endpoint: string; p: PushPayload }[] = [];
    let gone = false;
    const push: PushSender = {
      publicKey: () => "test-public-key",
      send: async (sub, p) => {
        sent.push({ endpoint: sub.endpoint, p });
        return gone ? "gone" : "ok";
      },
    };
    s = setup(true, { push });
    await s.anon.call("POST", "/v1/demo/reset", {});
    car = await login(s, "김주행");
    park = await login(s, "박서연");
    const cat = await s.anon.call<{ push: boolean; tradeConfig: { sellerWaitMin: number } }>("GET", "/v1/catalog");
    expect(cat.push).toBe(true);
    expect(cat.tradeConfig.sellerWaitMin).toBe(5);
    expect((await s.anon.call<{ publicKey: string }>("GET", "/v1/push/key")).publicKey).toBe("test-public-key");
    await expect(park.call("POST", "/v1/push/subscribe", { subscription: { endpoint: "http://x" } })).rejects.toMatchObject({ status: 422 });
    const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
    await park.call("POST", "/v1/push/subscribe", { subscription: sub });
    expect((await park.call<{ count: number }>("GET", "/v1/push/status")).count).toBe(1);
    s.clock.advance(13 * 60_000);
    const ev = await car.call<{ candidates: { listingId: string; categoryLabel: string }[] }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    const id = ev.candidates.find((c) => c.categoryLabel === "카시트")!.listingId;
    const t = await car.call<{ trade: { id: string } }>("POST", "/v1/drive/request", { ctx: ctx(s, 13), listingId: id });
    await new Promise((r) => setTimeout(r, 5));
    expect(sent[0]).toMatchObject({ endpoint: sub.endpoint, p: { title: "카시트 사러 오는 차가 있어요", urgent: true, url: "/seller/" } });
    gone = true;
    await park.call("POST", `/v1/seller/trades/${t.trade.id}/accept`);
    await new Promise((r) => setTimeout(r, 5));
    expect((await park.call<{ count: number }>("GET", "/v1/push/status")).count).toBe(0);
  });

  it("푸시를 쓰지 않는 서버는 404", async () => {
    await expect(s.anon.call("GET", "/v1/push/key")).rejects.toMatchObject({ status: 404 });
    expect((await s.anon.call<{ push: boolean }>("GET", "/v1/catalog")).push).toBe(false);
  });
});

describe("사진으로 크기 추정(T25)", () => {
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  it("추정기가 있으면 사진으로, 사진이 없거나 실패하면 품목 대표 크기라고 알린다", async () => {
    let fail = false;
    const sizeAI: SizeEstimator = {
      name: "fake",
      estimate: async ({ photo }) => (fail ? null : photo.mediaType === "image/jpeg" ? { sizeCm: { w: 44, d: 50, h: 66 }, category: "car_seat", confidence: 0.7, note: "카시트로 보여요" } : null),
    };
    s = setup(true, { sizeAI });
    await s.anon.call("POST", "/v1/demo/reset", {});
    park = await login(s, "박서연");
    expect((await s.anon.call<{ aiSize: boolean }>("GET", "/v1/catalog")).aiSize).toBe(true);
    const ai = await park.call<{ estimate: { method: string; sizeCm: { w: number } }; category: string }>("POST", "/v1/seller/estimate-size", { title: "카시트", photo: jpeg });
    expect(ai.estimate).toMatchObject({ method: "ai_photo", sizeCm: { w: 44 } });
    expect(ai.category).toBe("car_seat");
    const noPhoto = await park.call<{ estimate: { method: string } }>("POST", "/v1/seller/estimate-size", { title: "카시트" });
    expect(noPhoto.estimate.method).toBe("category_table");
    fail = true;
    const failed = await park.call<{ estimate: { method: string; note: string } }>("POST", "/v1/seller/estimate-size", { title: "카시트", photo: jpeg });
    expect(failed.estimate.method).toBe("category_table");
    expect(failed.estimate.note).toMatch(/^사진으로 추정하지 못해/);
  });

  it("모델 답에서 JSON을 꺼내고 이상한 값은 버린다", () => {
    expect(parseAiSize('크기는 {"category":"car_seat","width_cm":44.4,"depth_cm":50,"height_cm":66,"confidence":0.8,"note":"카시트"} 예요', ["car_seat"])).toMatchObject({
      sizeCm: { w: 44, d: 50, h: 66 },
      category: "car_seat",
    });
    expect(parseAiSize('{"width_cm":0,"depth_cm":50,"height_cm":66}', [])).toBeNull();
    expect(parseAiSize("모르겠어요", [])).toBeNull();
    expect(parseAiSize('{"category":"tank","width_cm":10,"depth_cm":10,"height_cm":10}', ["car_seat"])?.category).toBeNull();
  });
});

describe("물건 요약 브리핑(T33)", () => {
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const body = {
    title: "회전형 카시트",
    category: "car_seat",
    price: 35000,
    condition: "good",
    description: "아이가 커서 정리해요. 커버 세탁했어요. 등받이 오른쪽에 작은 긁힘 하나 있어요. 010-1234-5678",
    sizeCm: { w: 45, d: 55, h: 68 },
    sizeSource: "seller_measured",
    pickupPoint: { lat: 37.3889, lng: 127.1046, label: "백현동" },
  };

  it("AI가 없으면 글 요약만(규칙), 사진은 안 봤다고 표시하고 구매자가 조회할 수 있다", async () => {
    const { listing } = await park.call<{ listing: { id: string; brief: { source: string; summary: string; condition: { photoChecked: boolean; grade: string } } } }>("POST", "/v1/seller/listings", { ...body, photos: [jpeg] });
    expect(listing.brief.source).toBe("rule");
    expect(listing.brief.condition).toMatchObject({ photoChecked: false, grade: "good" });
    expect(listing.brief.summary).toContain("긁힘");
    expect(listing.brief.summary).not.toContain("010");
    const r = await car.call<{ brief: { speech: string }; photos: string[] }>("GET", `/v1/listings/${listing.id}/brief`);
    expect(r.brief.speech).toMatch(/^카시트 판매자 설명: /);
    expect(r.photos).toEqual([jpeg]);
    await expect(car.call("GET", "/v1/listings/nope/brief")).rejects.toMatchObject({ status: 404 });
    // 예전 매물(브리핑 없이 저장된 시연 매물)도 조회하면 규칙으로 만들어 둔다
    const b = await car.call<{ items: { listingId: string; brief: { source: string } | null }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    expect(b.items.length).toBeGreaterThan(0);
    expect(b.items.every((i) => i.brief?.source === "rule")).toBe(true);
  });

  it("AI와 실제 사진이 있으면 사진에서 본 상태를 더하고, 후보 보기에 실린다", async () => {
    const briefAI: BriefEngine = {
      name: "fake",
      brief: async ({ photos, categoryLabel }) => ({
        summary: "아이가 커서 정리, 커버 세탁함",
        condition: { grade: "fair", findings: [`사진 ${photos.length}장 중 등받이 긁힘(작음)`], photoChecked: true },
        speech: `${categoryLabel} 판매자 설명: 아이가 커서 정리, 커버 세탁함. 사진에서 등받이 긁힘(작음)이 보여요, 상태 중.`,
        source: "ai",
        at: 1,
      }),
    };
    s = setup(true, { briefAI });
    await s.anon.call("POST", "/v1/demo/reset", {});
    car = await login(s, "김주행");
    park = await login(s, "박서연");
    const { listing } = await park.call<{ listing: { id: string } }>("POST", "/v1/seller/listings", { ...body, photos: [jpeg] });
    const ai = await s.svc.refreshBriefAI(listing.id);
    expect(ai?.source).toBe("ai");
    const r = await car.call<{ brief: { source: string; condition: { findings: string[]; photoChecked: boolean } } }>("GET", `/v1/listings/${listing.id}/brief`);
    expect(r.brief.source).toBe("ai");
    expect(r.brief.condition).toMatchObject({ photoChecked: true, findings: ["사진 1장 중 등받이 긁힘(작음)"] });
    // 샘플 그림(SVG)만 있으면 AI에 보내지 않는다
    const svgOnly = await park.call<{ listing: { id: string } }>("POST", "/v1/seller/listings", { ...body, photos: ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="] });
    expect(await s.svc.refreshBriefAI(svgOnly.listing.id)).toBeNull();
    const b = await car.call<{ items: { listingId: string; brief: { source: string } | null }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    expect(b.items.find((i) => i.listingId === listing.id)?.brief?.source).toBe("ai");
  });
});

describe("대화로 고르기(T34)", () => {
  it("규칙 조수: 지금 맥락의 후보 사실만으로 답하고 행동을 낸다", async () => {
    const q = (question: string, extra: Record<string, unknown> = {}) => car.call<{ text: string; action: { type: string; listingId: string } | null; intent: string; source: string }>("POST", "/v1/assist", { ctx: ctx(s, 0), question, ...extra });
    const a = await q("카시트 흠집 있어?");
    expect(a.source).toBe("rule");
    expect(a.intent).toBe("condition");
    expect(a.text).toContain("사진 분석은 없고");
    const b = await q("카시트랑 유모차 중에 뭐가 더 싸?");
    expect(b.intent).toBe("compare");
    expect(b.text).toMatch(/더 싸요/);
    const list = await q("가는 길에 뭐 있어?");
    expect(list.text).toMatch(/^알릴 수 있는 매물 \d개예요/);
    // 제외된 매물(2열 착석 → 아기 침대)은 요청하지 않고 이유를 말한다
    const blocked = await q("아기 침대로 할게");
    expect(blocked.action).toBeNull();
    expect(blocked.text).toContain("2열에 사람이 있어");
    // 정차 중 이름을 대면 요청 행동
    const req = await q("캠핑의자 미리 요청해 줘");
    expect(req.action?.type).toBe("request");
    // 경합 중 고르기
    const brief = await car.call<{ items: { listingId: string; categoryLabel: string }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    const ids = ["카시트", "유모차"].map((l) => brief.items.find((i) => i.categoryLabel === l)!.listingId);
    const ch = await q("유모차로 할게", { alert: { kind: "contention", listingIds: ids } });
    expect(ch.action).toEqual({ type: "choose", listingId: ids[1] });
    await expect(s.anon.call("POST", "/v1/assist", { ctx: ctx(s, 0), question: "x" })).rejects.toMatchObject({ status: 401 });
  });

  it("AI 조수가 있으면 그 답을 쓰되, 사실표 밖 매물·허용되지 않은 행동은 버린다", async () => {
    let reply = "";
    const assistAI: AssistEngine = { name: "fake", assist: async (i) => parseAiAssist(reply, i) };
    s = setup(true, { assistAI });
    await s.anon.call("POST", "/v1/demo/reset", {});
    car = await login(s, "김주행");
    const brief = await car.call<{ items: { listingId: string; categoryLabel: string; exclusions: string[] }[] }>("POST", "/v1/drive/briefing", { ctx: ctx(s, 0) });
    const carSeat = brief.items.find((i) => i.categoryLabel === "카시트")!.listingId;
    const bed = brief.items.find((i) => i.categoryLabel === "아기 침대")!.listingId;
    reply = `{"answer":"카시트는 사진 분석이 없고 판매자는 상으로 표시했어요.","action":null,"focusId":"${carSeat}"}`;
    const a = await car.call<{ text: string; source: string; focusId: string | null }>("POST", "/v1/assist", { ctx: ctx(s, 0), question: "카시트 흠집 있어?" });
    expect(a).toMatchObject({ source: "ai", focusId: carSeat });
    // 제외 매물 요청 → 행동 버림, 없는 매물 → 버림, 경합이 아닌데 choose → 버림
    reply = `{"answer":"요청할게요","action":{"type":"request","listingId":"${bed}"}}`;
    expect((await car.call<{ action: unknown }>("POST", "/v1/assist", { ctx: ctx(s, 0), question: "아기 침대로 할게" })).action).toBeNull();
    reply = `{"answer":"요청할게요","action":{"type":"request","listingId":"nope"}}`;
    expect((await car.call<{ action: unknown }>("POST", "/v1/assist", { ctx: ctx(s, 0), question: "할게" })).action).toBeNull();
    reply = `{"answer":"고를게요","action":{"type":"choose","listingId":"${carSeat}"}}`;
    expect((await car.call<{ action: unknown }>("POST", "/v1/assist", { ctx: ctx(s, 0), question: "카시트로" })).action).toBeNull();
    // AI 답이 깨지면 규칙 조수로
    reply = "모르겠어요";
    expect((await car.call<{ source: string }>("POST", "/v1/assist", { ctx: ctx(s, 0), question: "카시트 얼마야?" })).source).toBe("rule");
  });
});

describe("실시간 알림 (SSE)", () => {
  it("스트림이 hello 뒤에 내 알림을 보낸다", async () => {
    const res = await s.app.fetch(new Request(`http://local/v1/stream?token=${park.token()}`));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 2000;
      while (!text.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await readUntil("event: hello");
    expect(text).toContain("event: hello");
    s.clock.advance(13 * 60_000);
    const ev = await car.call<{ candidates: { listingId: string; categoryLabel: string }[] }>("POST", "/v1/drive/context", { ctx: ctx(s, 13) });
    await car.call("POST", "/v1/drive/request", { ctx: ctx(s, 13), listingId: ev.candidates.find((c) => c.categoryLabel === "카시트")!.listingId });
    await readUntil("request.new");
    expect(text).toContain("event: app");
    expect(text).toContain("request.new");
    await reader.cancel();
  });
});

describe("SQLite 저장소", () => {
  it("저장·조회·트랜잭션 롤백", () => {
    const st = new SqliteStore(":memory:");
    st.put("users", { id: "u1", name: "a" });
    expect(st.get<{ name: string }>("users", "u1")!.name).toBe("a");
    expect(() =>
      st.tx(() => {
        st.put("users", { id: "u2", name: "b" });
        throw new Error("x");
      }),
    ).toThrow();
    expect(st.get("users", "u2")).toBeUndefined();
    expect(st.list("users")).toHaveLength(1);
  });

  it("서버 전체가 SQLite 위에서도 같은 흐름으로 동작", async () => {
    const clock = new ManualClock(DEMO_START);
    const b = createBackend({ demo: true, clock, store: new SqliteStore(":memory:"), seed: true });
    const anon = createLocalClient(b);
    const { users } = await anon.call<{ users: { id: string; name: string }[] }>("GET", "/v1/demo/users");
    const { token } = await anon.call<{ token: string }>("POST", "/v1/session", { userId: users.find((u) => u.name === "김주행")!.id });
    const c = createLocalClient(b, token);
    const r = await c.call<{ top: { categoryLabel: string } }>("POST", "/v1/drive/context", {
      ctx: { now: clock.now(), navStatus: "ROUTE_DRIVE", location: DEMO_PLACES.start, destination: DEMO_PLACES.home, waypointCount: 0, socPct: 60, seats: { row2Occupied: true } },
    });
    expect(r.top.categoryLabel).toBe("캠핑의자");
  });
});
