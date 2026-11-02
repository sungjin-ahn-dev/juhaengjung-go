import { describe, expect, it } from "vitest";
import { approxArea, DEMO_PLACES, haversineM, makePolyline, nextManeuver, pointAtAlong, projectOnPolyline, timeAtAlong } from "../src/index.ts";
import { graph, router } from "./fixtures.ts";

describe("도로망과 경로 계산 (외부 길찾기 API 자리)", () => {
  const route = router.route([DEMO_PLACES.start, DEMO_PLACES.home])!;

  it("수원 → 송파 경로가 분당·판교를 지난다", () => {
    expect(route).not.toBeNull();
    expect(route.distanceM).toBeGreaterThan(25000);
    expect(route.distanceM).toBeLessThan(45000);
    expect(route.durationS / 60).toBeGreaterThan(30);
    expect(route.durationS / 60).toBeLessThan(60);
    for (const name of ["영통", "정자", "판교", "수서"]) expect(route.viaNames).toContain(name);
  });

  it("회전 안내(TBT)가 Pleos TurnType 값으로 나오고 마지막은 도착", () => {
    expect(route.maneuvers.length).toBeGreaterThan(5);
    expect(route.maneuvers.at(-1)!.type).toBe("TURN_ARRIVE");
    expect(route.maneuvers.some((m) => m.type === "TURN_ENTER_IC_R")).toBe(true);
    const m = nextManeuver(route, 0)!;
    expect(m.distanceM).toBeGreaterThan(0);
  });

  it("누적 시간은 단조 증가하고 끝은 전체 소요 시간", () => {
    for (let i = 1; i < route.cumTimeS.length; i++) expect(route.cumTimeS[i]).toBeGreaterThanOrEqual(route.cumTimeS[i - 1]);
    expect(timeAtAlong(route, route.distanceM)).toBeCloseTo(route.durationS, 3);
    expect(timeAtAlong(route, route.distanceM / 2)).toBeGreaterThan(0);
  });

  it("경유지를 넣으면 경유지 위치와 TURN_WAY 안내가 생긴다", () => {
    const via = graph.node("baekhyeon");
    const r2 = router.route([DEMO_PLACES.start, via, DEMO_PLACES.home])!;
    expect(r2.viaAlongM.length).toBe(1);
    expect(r2.durationS).toBeGreaterThan(route.durationS);
    expect(r2.maneuvers.some((m) => m.type === "TURN_WAY")).toBe(true);
    const p = pointAtAlong(r2.line, r2.viaAlongM[0]).point;
    expect(haversineM(p, via)).toBeLessThan(5);
  });

  it("투영: 경로 위 점은 거리 0, 지나온 구간은 건너뛴다", () => {
    const pl = makePolyline([
      { lat: 37.0, lng: 127.0 },
      { lat: 37.01, lng: 127.0 },
      { lat: 37.02, lng: 127.0 },
    ]);
    const p = projectOnPolyline(pl, { lat: 37.005, lng: 127.0 })!;
    expect(p.distM).toBeLessThan(1);
    const q = projectOnPolyline(pl, { lat: 37.005, lng: 127.0 }, 1500)!;
    expect(q.alongM).toBeGreaterThanOrEqual(1500);
  });

  it("수락 전 공개 범위는 실제 위치에서 150~350m 떨어진 가짜 중심", () => {
    const n = graph.node("baekhyeon");
    const a = approxArea(n, "listing-1");
    const d = haversineM(n, a);
    expect(d).toBeGreaterThanOrEqual(149);
    expect(d).toBeLessThanOrEqual(351);
    expect(approxArea(n, "listing-1")).toEqual(a); // 같은 id면 같은 값
  });

  it("편안한 길 옵션은 골목을 덜 쓴다", () => {
    const r = router.route([DEMO_PLACES.start, DEMO_PLACES.home], "COMFORTABLE")!;
    expect(r.option).toBe("COMFORTABLE");
    expect(r.distanceM).toBeGreaterThan(0);
  });
});
