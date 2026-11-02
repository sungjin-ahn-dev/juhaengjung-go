import { describe, expect, it } from "vitest";
import {
  AlertGate,
  busyReasons,
  categorize,
  describeAvailability,
  emptyPersonalization,
  estimateSize,
  isAvailableAt,
  keywordMatches,
  kstToMs,
  needsMeasuredSize,
  parsePastedListing,
  personalizationNote,
  recordSkip,
  recordTrade,
  referencePrice,
  wonText,
} from "../src/index.ts";

describe("T8 알림 타이밍 — 회전·방향지시등·조향·제동 중에는 미룬다", () => {
  it("바쁜 이유를 모은다", () => {
    expect(busyReasons({ tbtDistanceM: 200 })).toEqual(["turn_ahead"]);
    expect(busyReasons({ tbtDistanceM: 200, tbtIsTurn: false })).toEqual([]);
    expect(busyReasons({ turnSignal: "LEFT" })).toEqual(["turn_signal"]);
    expect(busyReasons({ steeringAngleDeg: -5 })).toEqual(["steering"]);
    expect(busyReasons({ brakePressed: true })).toEqual(["braking"]);
    expect(busyReasons({ tbtDistanceM: 900, turnSignal: "OFF", steeringAngleDeg: 1, brakePressed: false })).toEqual([]);
  });

  it("방향지시등이 꺼지고 2.5초 안정된 뒤에만 말한다", () => {
    const g = new AlertGate(undefined, 0);
    expect(g.check(0).ok).toBe(true);
    g.update({ turnSignal: "RIGHT" }, 1000);
    expect(g.check(1500)).toMatchObject({ ok: false, reasons: ["turn_signal"] });
    g.update({ turnSignal: "OFF" }, 5000);
    const mid = g.check(6000);
    expect(mid.ok).toBe(false);
    expect(mid.waitMs).toBe(1500);
    expect(g.check(7600).ok).toBe(true);
  });
});

describe("T14 개인화 — 서로 다른 날 두 번 지나쳐야 줄인다", () => {
  it("같은 날 여러 번은 한 번, 두 번째 날부터 ×0.9, 하한 0.5", () => {
    let s = emptyPersonalization();
    s = recordSkip(s, "camping_chair", "2026-11-06").state;
    s = recordSkip(s, "camping_chair", "2026-11-06").state;
    expect(s.multipliers.camping_chair ?? 1).toBe(1);
    expect(personalizationNote("camping_chair", "캠핑의자", s)).toContain("한 번만으로는");
    const r = recordSkip(s, "camping_chair", "2026-11-09");
    expect(r.changed).toBe(true);
    expect(r.state.multipliers.camping_chair).toBe(0.9);
    let t = r.state;
    for (let d = 10; d < 30; d++) t = recordSkip(t, "camping_chair", `2026-11-${d}`).state;
    expect(t.multipliers.camping_chair).toBe(0.5);
  });

  it("거래가 성사되면 ×1.05, 상한 1.2", () => {
    let s = emptyPersonalization();
    for (let i = 0; i < 10; i++) s = recordTrade(s, "car_seat");
    expect(s.multipliers.car_seat).toBe(1.2);
  });
});

describe("T17 같이 올리기 — 붙여넣기·품목·AI 크기·실측 기준", () => {
  it("다른 앱에 쓴 글에서 제목·가격·설명·품목을 채운다", () => {
    const p = parsePastedListing("[판매] 회전형 카시트 팝니다\n3만 5천원 아니고 35,000원이에요\n사용감 조금 있어요. 직거래만");
    expect(p.title).toBe("회전형 카시트 팝니다");
    expect(p.price).toBe(35000);
    expect(p.category).toBe("car_seat");
    expect(p.description).toContain("사용감");
  });

  it("'만원' 표기와 가격 줄", () => {
    expect(parsePastedListing("유모차\n가격: 9만원").price).toBe(90000);
    expect(parsePastedListing("캠핑의자 2개 일괄 2.5만").price).toBe(25000);
  });

  it("AI 크기 추정(품목 대표 크기)과 실측 필요 판단", () => {
    const e = estimateSize("원목 아기침대", null)!;
    expect(e.sizeCm.w).toBeGreaterThanOrEqual(100);
    expect(needsMeasuredSize(e.sizeCm)).toBe(true);
    expect(needsMeasuredSize({ w: 40, d: 30, h: 20 })).toBe(false);
    expect(estimateSize("알 수 없는 물건")).toBeNull();
  });

  it("관심 키워드 매칭은 띄어쓰기·동의어를 견딘다", () => {
    const l = { title: "원목 유아침대 분해 완료", category: "baby_bed" };
    expect(keywordMatches("아기 침대", l)).toBe(true);
    expect(keywordMatches("아기침대", l)).toBe(true);
    expect(keywordMatches("카시트", l)).toBe(false);
    expect(categorize("헬리녹스 체어원")).toBe("camping_chair");
  });

  it("기준가는 자체 기준표 × 상태 계수", () => {
    expect(referencePrice("car_seat", "good")).toBe(65000);
    expect(referencePrice("car_seat", "fair")).toBe(52000);
  });

  it("금액 읽기", () => {
    expect(wonText(30000)).toBe("3만 원");
    expect(wonText(35000)).toBe("3만 5천 원");
    expect(wonText(5000)).toBe("5천 원");
  });
});

describe("거래 가능 시간 (한국 시간)", () => {
  const weekday = [{ days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }];
  it("평일 저녁만", () => {
    expect(isAvailableAt(weekday, kstToMs(2026, 11, 6, 18, 30))).toBe(true); // 금
    expect(isAvailableAt(weekday, kstToMs(2026, 11, 6, 21, 30))).toBe(false);
    expect(isAvailableAt(weekday, kstToMs(2026, 11, 7, 19, 0))).toBe(false); // 토
    expect(isAvailableAt([], kstToMs(2026, 11, 7, 3, 0))).toBe(true);
    expect(describeAvailability(weekday)).toBe("평일 18:00~21:00");
  });
  it("자정을 넘는 구간", () => {
    const late = [{ days: [5], from: "22:00", to: "01:00" }];
    expect(isAvailableAt(late, kstToMs(2026, 11, 6, 23, 0))).toBe(true);
    expect(isAvailableAt(late, kstToMs(2026, 11, 7, 0, 30))).toBe(true);
    expect(isAvailableAt(late, kstToMs(2026, 11, 7, 1, 30))).toBe(false);
  });
});
