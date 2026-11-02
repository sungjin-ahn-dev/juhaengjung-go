import { describe, expect, it } from "vitest";
import {
  checkEnergy,
  decideMode,
  DEMO_PLACES,
  emptyTrust,
  evaluate,
  fitItem,
  kstToMs,
  pointAtAlong,
  projectOnPolyline,
  timeAtAlong,
  type EvalInput,
} from "../src/index.ts";
import { AVANTE, ctxAtStart, demoInterests, demoListings, FRI_1805, graph, interest, IONIQ5, listing, router, settings } from "./fixtures.ts";

function input(over: Partial<EvalInput> = {}): EvalInput {
  return {
    ctx: ctxAtStart(),
    vehicle: IONIQ5,
    listings: demoListings(),
    interests: demoInterests(),
    settings,
    router,
    ...over,
  };
}

/** 기준 경로에서 시각 t(초)인 지점 */
function atMinute(min: number) {
  const base = router.route([DEMO_PLACES.start, DEMO_PLACES.home])!;
  let s = 0;
  while (s < base.distanceM && timeAtAlong(base, s) < min * 60) s += 20;
  const proj = projectOnPolyline(base.line, base.line.points[0], 0)!;
  void proj;
  // 해당 지점 좌표
  const pts = base.line;
  let i = 0;
  while (i < pts.cum.length - 1 && pts.cum[i + 1] < s) i++;
  const a = pts.points[i];
  const b = pts.points[Math.min(i + 1, pts.points.length - 1)];
  const seg = pts.cum[Math.min(i + 1, pts.cum.length - 1)] - pts.cum[i] || 1;
  const t = (s - pts.cum[i]) / seg;
  const location = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { base, alongM: s, location, remainTimeS: base.durationS - timeAtAlong(base, s) };
}

describe("T1 매칭 모드 — NaviHelper 내비 상태로 자동 전환", () => {
  it("경로 안내 중이면 경로 매칭, 자유 주행이면 지역 매칭, 그 밖은 쉼", () => {
    expect(decideMode("ROUTE_DRIVE", true)).toBe("route");
    expect(decideMode("FREE_DRIVE", false)).toBe("region");
    expect(decideMode("ROUTE_DRIVE", false)).toBe("region");
    expect(decideMode("INACTIVE", false)).toBe("idle");
    expect(decideMode("INITIALIZING", true)).toBe("idle");
  });

  it("지역 매칭은 반경 안 매물을 '여기서 N분'으로 안내한다", () => {
    const ev = evaluate(
      input({ ctx: ctxAtStart({ navStatus: "FREE_DRIVE", destination: null, location: { lat: 37.3889, lng: 127.1046 } }) }),
    );
    expect(ev.mode).toBe("region");
    const ids = ev.candidates.map((c) => c.listingId);
    expect(ids).toContain("carseat");
    expect(ids).not.toContain("camp"); // 수원 매물은 반경 밖
    expect(ev.candidates.find((c) => c.listingId === "carseat")!.speech).toContain("여기서");
  });
});

describe("T2 경로 근처 후보 + T16 출발 전 브리핑", () => {
  it("경로 2.5km 안의 관심 매물만 후보이고 경로 순서로 정렬된다", () => {
    const ev = evaluate(input({ ignoreWindow: true }));
    const ids = ev.candidates.map((c) => c.listingId);
    expect(ids).toEqual(["camp", "bed", "stroller", "carseat", "sofa"]);
    for (const c of ev.candidates) expect(c.distFromRouteM!).toBeLessThanOrEqual(2500);
  });

  it("관심사와 안 맞는 매물은 후보가 아니다", () => {
    const ev = evaluate(input({ interests: [interest("카시트", "must")], ignoreWindow: true }));
    expect(ev.candidates.map((c) => c.listingId)).toEqual(["carseat"]);
  });

  it("찜(W=1.0)이 키워드(W=0.5)보다 우선한다", () => {
    const ev = evaluate(
      input({
        interests: [interest("카시트", "near"), { id: "w", userId: "buyer", type: "wish", listingId: "carseat", goLevel: "must", createdAt: 0 }],
        ignoreWindow: true,
      }),
    );
    const c = ev.candidates.find((x) => x.listingId === "carseat")!;
    expect(c.interestType).toBe("wish");
    expect(c.parts.W).toBe(1);
    expect(c.goLevel).toBe("must");
  });
});

describe("T3 우회 시간 = 갈림 지점→매물 + 매물→목적지 − 갈림 지점→목적지(기준 경로) + 거래 시간", () => {
  it("길가 매물은 짧고, 멀리 들어간 매물은 길다", () => {
    const ev = evaluate(input({ ignoreWindow: true }));
    const by = Object.fromEntries(ev.candidates.map((c) => [c.listingId, c]));
    expect(by.camp.detourMin).toBeLessThanOrEqual(4);
    expect(by.bed.detourMin).toBeGreaterThan(by.camp.detourMin);
    // 공식 확인
    const c = by.carseat;
    const base = router.route([DEMO_PLACES.start, DEMO_PLACES.home])!;
    const l = demoListings().find((x) => x.id === "carseat")!;
    const branch = pointAtAlong(base.line, c.branchAlongM!).point;
    const toListing = router.route([branch, l.pickupPoint])!.durationS;
    const expected = Math.max(0, toListing + c.tListingToDestS - (base.durationS - timeAtAlong(base, c.branchAlongM!))) + 90;
    expect(Math.abs(c.detourS - expected)).toBeLessThanOrEqual(1);
  });

  it("주행 중 차가 움직여도 우회 시간이 흔들리지 않는다(갈림 지점 전까지)", () => {
    const base = router.route([DEMO_PLACES.start, DEMO_PLACES.home])!;
    const at0 = evaluate(input({ ignoreWindow: true, baseRoute: base, currentAlongM: 0 })).candidates;
    for (const along of [600, 1700, 2900]) {
      const p = pointAtAlong(base.line, along).point;
      const ev = evaluate(input({ ignoreWindow: true, baseRoute: base, currentAlongM: along, ctx: ctxAtStart({ location: p }) }));
      for (const c of ev.candidates) {
        if (c.exclusions.includes("passed")) continue;
        const c0 = at0.find((x) => x.listingId === c.listingId)!;
        expect(Math.abs(c.detourS - c0.detourS)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("차 안 requestTrip 결과가 있으면 현재→매물 시간에 그것을 쓴다", () => {
    const plain = evaluate(input({ ignoreWindow: true })).candidates.find((c) => c.listingId === "carseat")!;
    const ev = evaluate(
      input({
        ignoreWindow: true,
        ctx: ctxAtStart({ tripChecks: { carseat: { distanceM: plain.distCurToListingM, etaS: plain.tCurToListingS + 300, checkedAt: FRI_1805, pointIsExact: true } } }),
      }),
    );
    const c = ev.candidates.find((x) => x.listingId === "carseat")!;
    expect(c.usedTripCheck).toBe(true);
    expect(c.detourS - plain.detourS).toBeGreaterThanOrEqual(299);
  });

  it("대략 위치로 잰 requestTrip은 시간은 그대로 두고 도착 배터리 예측에만 쓴다", () => {
    const plain = evaluate(input({ ignoreWindow: true })).candidates.find((c) => c.listingId === "carseat")!;
    const ev = evaluate(
      input({
        ignoreWindow: true,
        ctx: ctxAtStart({ tripChecks: { carseat: { distanceM: plain.distCurToListingM + 400, etaS: plain.tCurToListingS + 300, socAtDestPct: 52, checkedAt: FRI_1805 } } }),
      }),
    );
    const c = ev.candidates.find((x) => x.listingId === "carseat")!;
    expect(c.detourS).toBe(plain.detourS);
    expect(c.usedTripCheck).toBe(false);
    expect(c.energy.usedDefaultRate).toBe(false);
  });

  it("우회 시간이 GO 등급 최대치를 넘으면 제외", () => {
    const ev = evaluate(input({ interests: [interest("아기 침대", "near")], ignoreWindow: true }));
    expect(ev.candidates[0].exclusions).toContain("detour");
  });
});

describe("T4 에너지 확인", () => {
  it("전기차: requestTrip 도착 배터리 예측으로 소비율을 구해 목적지 도착 배터리를 추정", () => {
    const r = checkEnergy({
      powertrain: "ev",
      socNowPct: 40,
      socAtListingPct: 36,
      distCurToListingM: 20000,
      distListingToDestM: 15000,
      minArrivalSocPct: 15,
      minRangeAfterKm: 50,
    });
    expect(r.ratePctPerKm).toBeCloseTo(0.2, 3);
    expect(r.arrivalSocPct).toBeCloseTo(33, 1);
    expect(r.ok).toBe(true);
    expect(r.usedDefaultRate).toBe(false);
  });

  it("매물이 가까우면(2km 미만) 차종 기본 소비율", () => {
    const r = checkEnergy({ powertrain: "ev", socNowPct: 40, socAtListingPct: 39.9, distCurToListingM: 1000, distListingToDestM: 10000, defaultSocPctPerKm: 0.25, minArrivalSocPct: 15, minRangeAfterKm: 50 });
    expect(r.usedDefaultRate).toBe(true);
    expect(r.arrivalSocPct).toBeCloseTo(39.9 - 2.5, 1);
  });

  it("배터리가 부족하면 매물이 제외된다", () => {
    const ev = evaluate(input({ ctx: ctxAtStart({ socPct: 20 }), ignoreWindow: true }));
    const far = ev.candidates.find((c) => c.listingId === "carseat")!;
    expect(far.exclusions).toContain("energy");
    expect(far.energy.arrivalSocPct!).toBeLessThan(15);
  });

  it("내연기관: 주행 가능 거리로 판단, 정보가 없으면 막지 않는다", () => {
    const ok = checkEnergy({ powertrain: "ice", fuelRangeKm: 400, distCurToListingM: 20000, distListingToDestM: 15000, minArrivalSocPct: 15, minRangeAfterKm: 50 });
    expect(ok.ok).toBe(true);
    const low = checkEnergy({ powertrain: "ice", fuelRangeKm: 60, distCurToListingM: 20000, distListingToDestM: 15000, minArrivalSocPct: 15, minRangeAfterKm: 50 });
    expect(low.ok).toBe(false);
    const unknown = checkEnergy({ powertrain: "ice", fuelRangeKm: null, distCurToListingM: 1, distListingToDestM: 1, minArrivalSocPct: 15, minRangeAfterKm: 50 });
    expect(unknown).toMatchObject({ ok: true, unknown: true });
  });
});

describe("T5 적재 판단 — 차종 트렁크 치수 + 2열 착석", () => {
  it("트렁크에 쏙 / 2열 접으면 가능 / 안 들어감", () => {
    expect(fitItem({ w: 45, d: 55, h: 68 }, IONIQ5).kind).toBe("trunk");
    expect(fitItem({ w: 125, d: 68, h: 22 }, IONIQ5).kind).toBe("folded");
    expect(fitItem({ w: 200, d: 90, h: 85 }, IONIQ5).kind).toBe("none");
    // 세단은 트렁크 높이가 낮아 60cm 상자가 안 들어간다
    expect(fitItem({ w: 60, d: 60, h: 60 }, IONIQ5).kind).toBe("trunk");
    expect(fitItem({ w: 60, d: 60, h: 60 }, AVANTE).kind).toBe("none");
  });

  it("2열에 사람이 있으면 '2열 접으면 가능' 매물은 제외", () => {
    const empty = evaluate(input({ ignoreWindow: true })).candidates.find((c) => c.listingId === "bed")!;
    expect(empty.exclusions).not.toContain("load_seat");
    const occ = evaluate(input({ ctx: ctxAtStart({ seats: { row2Occupied: true } }), ignoreWindow: true })).candidates.find((c) => c.listingId === "bed")!;
    expect(occ.exclusions).toContain("load_seat");
    const sofa = evaluate(input({ ignoreWindow: true })).candidates.find((c) => c.listingId === "sofa")!;
    expect(sofa.exclusions).toContain("load");
  });
});

describe("T6 제외 조건 — 판매자 시간·경유지·이미 지남·이번 주행 거절·응답률", () => {
  it("도착 예정 시각이 판매자 거래 가능 시간 밖이면 제외", () => {
    const ls = demoListings().map((l) => (l.id === "carseat" ? { ...l, availability: [{ days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }] } : l));
    const fri = evaluate(input({ listings: ls, ignoreWindow: true })).candidates.find((c) => c.listingId === "carseat")!;
    expect(fri.exclusions).not.toContain("availability");
    const sat = kstToMs(2026, 11, 7, 18, 5);
    const satEv = evaluate(input({ listings: ls, ctx: ctxAtStart({ now: sat }), ignoreWindow: true })).candidates.find((c) => c.listingId === "carseat")!;
    expect(satEv.exclusions).toContain("availability");
  });

  it("경유지가 이미 2개면 전부 제외", () => {
    const ev = evaluate(input({ ctx: ctxAtStart({ waypointCount: 2 }), ignoreWindow: true }));
    for (const c of ev.candidates) expect(c.exclusions).toContain("waypoints");
  });

  it("지나친 매물과 이번 주행에서 '아니요'한 매물은 제외", () => {
    const p = atMinute(15);
    const ev = evaluate(
      input({
        ctx: ctxAtStart({ location: p.location, destination: { ...DEMO_PLACES.home, remainTimeS: p.remainTimeS } }),
        baseRoute: p.base,
        currentAlongM: p.alongM,
        dismissed: new Set(["stroller"]),
        ignoreWindow: true,
      }),
    );
    const by = Object.fromEntries(ev.candidates.map((c) => [c.listingId, c]));
    expect(by.camp.exclusions).toContain("passed");
    expect(by.stroller.exclusions).toContain("dismissed");
    expect(by.carseat.exclusions).not.toContain("passed");
  });

  it("응답률이 낮은 판매자(요청 3건 이상)는 제외", () => {
    const t = { ...emptyTrust("seller_carseat", "seller"), requests: 5, responded: 1 };
    const ev = evaluate(input({ sellerTrust: { seller_carseat: t }, ignoreWindow: true }));
    expect(ev.candidates.find((c) => c.listingId === "carseat")!.exclusions).toContain("trust");
  });
});

describe("T7 점수·1위·경합", () => {
  it("점수 = (0.35G + 0.2W + 0.2P + 0.25D) × M", () => {
    const ev = evaluate(input({ multipliers: { car_seat: 0.9 }, ignoreWindow: true }));
    const c = ev.candidates.find((x) => x.listingId === "carseat")!;
    const { G, W, P, D, M } = c.parts;
    expect(M).toBe(0.9);
    expect(c.score).toBeCloseTo((0.35 * G + 0.2 * W + 0.2 * P + 0.25 * D) * M, 2);
  });

  it("출발 직후에는 영통 캠핑의자만 알림 창 안에 있다", () => {
    const ev = evaluate(input({ ctx: ctxAtStart({ seats: { row2Occupied: true } }) }));
    expect(ev.top?.listingId).toBe("camp");
    expect(ev.top!.speech).toMatch(/^캠핑의자, \d분 더, 트렁크에 쏙, 기준가보다 .+ 싸요\. 들를까요\?$/);
    expect(ev.contention).toBeNull();
  });

  it("분당에 들어서면 유모차와 카시트가 비슷해 경합 질문", () => {
    const p = atMinute(13);
    const ev = evaluate(
      input({
        ctx: ctxAtStart({ location: p.location, destination: { ...DEMO_PLACES.home, remainTimeS: p.remainTimeS }, seats: { row2Occupied: true } }),
        baseRoute: p.base,
        currentAlongM: p.alongM,
        dismissed: new Set(["camp"]),
      }),
    );
    expect(ev.top).not.toBeNull();
    expect(ev.contention).not.toBeNull();
    const ids = ev.contention!.map((c) => c.listingId).sort();
    expect(ids).toEqual(["carseat", "stroller"]);
  });

  it("가까우면 GO 등급은 경합 질문에 들지 않는다", () => {
    const p = atMinute(13);
    const ev = evaluate(
      input({
        interests: [interest("카시트", "must"), interest("유모차", "near")],
        ctx: ctxAtStart({ location: p.location, destination: { ...DEMO_PLACES.home, remainTimeS: p.remainTimeS } }),
        baseRoute: p.base,
        currentAlongM: p.alongM,
      }),
    );
    expect(ev.contention).toBeNull();
  });
});

describe("브리핑에는 제외 이유가 함께 나온다", () => {
  it("2열 착석 + 소파", () => {
    const ev = evaluate(input({ ctx: ctxAtStart({ seats: { row2Occupied: true } }), ignoreWindow: true }));
    const reasons = Object.fromEntries(ev.candidates.map((c) => [c.listingId, c.exclusions]));
    expect(reasons.bed).toEqual(["load_seat"]);
    expect(reasons.sofa).toContain("load");
    expect(reasons.carseat).toEqual([]);
    void graph;
    void listing;
  });
});
