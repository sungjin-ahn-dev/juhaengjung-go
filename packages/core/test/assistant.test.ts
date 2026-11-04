import { describe, expect, it } from "vitest";
import { assist, resolveItems, type AssistFact } from "../src/assistant.ts";

const fact = (o: Partial<AssistFact> & { listingId: string; categoryLabel: string }): AssistFact => ({
  title: o.categoryLabel,
  price: 30000,
  referencePrice: 50000,
  detourMin: 6,
  fit: { kind: "trunk", label: "트렁크에 쏙" },
  energy: { ok: true, arrivalSocPct: 53 },
  condition: "good",
  brief: null,
  seller: { completed: 2, rating: 4.5 },
  goLevel: "must",
  aheadM: 20000,
  score: 0.8,
  exclusions: [],
  ...o,
});
const car = fact({ listingId: "l1", categoryLabel: "카시트", title: "회전형 카시트 (신생아~4세)", price: 35000, referencePrice: 65000, brief: { summary: "아이가 커서 정리해요. 커버 세탁했어요", findings: [], photoChecked: false, grade: null } });
const stroller = fact({ listingId: "l2", categoryLabel: "유모차", title: "디럭스 유모차 (접은 상태)", price: 90000, referencePrice: 150000, detourMin: 6, score: 0.75, brief: { summary: "바퀴 상태 좋아요", findings: ["앞바퀴 긁힘(작음)"], photoChecked: true, grade: "fair" } });
const chair = fact({ listingId: "l3", categoryLabel: "캠핑의자", price: 20000, referencePrice: 30000, detourMin: 3, score: 0.5, aheadM: 4100 });
const bed = fact({ listingId: "l4", categoryLabel: "아기 침대", price: 50000, referencePrice: 70000, detourMin: 9, score: 0.3, exclusions: ["load_seat"], fit: { kind: "folded", label: "2열 접으면 가능" } });
const facts = [car, stroller, chair, bed];
const base = { facts, focusId: null, alert: null, driving: false };

describe("대화로 고르기(T34) — 규칙 조수", () => {
  it("질문에 나온 매물을 품목·제목·순서말로 찾는다", () => {
    expect(resolveItems("카시트 흠집 있어?", facts, null).map((f) => f.listingId)).toEqual(["l1"]);
    expect(resolveItems("디럭스는 얼마야", facts, null).map((f) => f.listingId)).toEqual(["l2"]);
    expect(resolveItems("두 번째 거로 할게", facts, ["l1", "l2"]).map((f) => f.listingId)).toEqual(["l2"]);
    expect(resolveItems("이거 얼마야", facts, null)).toEqual([]);
  });

  it("상태 질문: 사진 분석이 없으면 없다고, 있으면 본 것을 말한다", () => {
    const a = assist({ ...base, question: "카시트 흠집 있어?" });
    expect(a.intent).toBe("condition");
    expect(a.text).toContain("사진 분석은 없고");
    expect(a.text).toContain("상태 상으로 표시");
    expect(a.focusId).toBe("l1");
    const b = assist({ ...base, question: "유모차 상태 어때?" });
    expect(b.text).toContain("앞바퀴 긁힘(작음)이 보여요");
    expect(b.text).toContain("상태 중");
  });

  it("가격·우회·적재·배터리·판매자·이유", () => {
    expect(assist({ ...base, question: "카시트 얼마야?" }).text).toBe("카시트 3만 5천 원, 기준가보다 3만 원 싸요.");
    expect(assist({ ...base, question: "캠핑의자 얼마나 돌아가?" }).text).toBe("캠핑의자는 4.1km 앞, 들르면 3분 더 걸려요.");
    expect(assist({ ...base, question: "유모차 트렁크에 들어가?" }).text).toBe("유모차: 트렁크에 쏙.");
    expect(assist({ ...base, question: "카시트 들렀다 가면 배터리 괜찮아?" }).intent).toBe("energy");
    expect(assist({ ...base, question: "카시트 들르면 배터리 얼마나 남아?" }).text).toContain("도착 배터리 53%");
    expect(assist({ ...base, question: "유모차 판매자 믿을 만해?" }).text).toContain("거래 2회, 평점 4.5");
    expect(assist({ ...base, question: "아기 침대는 왜 안 알려줘?" }).text).toContain("2열에 사람이 있어");
  });

  it("비교와 추천은 사실로만 말한다", () => {
    expect(assist({ ...base, question: "카시트랑 유모차 중에 뭐가 더 싸?" }).text).toContain("카시트가 5만 5천 원 더 싸요");
    expect(assist({ ...base, question: "카시트랑 캠핑의자 중에 뭐가 더 가까워?" }).text).toContain("캠핑의자가 3분 덜 돌아가요");
    const r = assist({ ...base, question: "뭐 추천해?" });
    expect(r.intent).toBe("recommend");
    expect(r.text).toMatch(/^카시트를 추천해요\. 기준가보다 3만 원 싸고, 6분 더 걸려요, 트렁크에 들어가요\.$/);
    expect(assist({ ...base, question: "가는 길에 뭐 있어?" }).text).toBe("알릴 수 있는 매물 3개예요. 1위 카시트 6분, 2위 유모차 6분, 3위 캠핑의자 3분.");
  });

  it("경합 중엔 둘 중 고르기, 알림 중엔 요청·거절이 행동이 된다", () => {
    const cont = { ...base, alert: { kind: "contention" as const, listingIds: ["l1", "l2"] } };
    const c = assist({ ...cont, question: "유모차로 할게" });
    expect(c.action).toEqual({ type: "choose", listingId: "l2" });
    expect(assist({ ...cont, question: "둘 중에 뭐가 더 싸?" }).text).toContain("카시트가 5만 5천 원 더 싸요");
    expect(assist({ ...cont, question: "할게" }).intent).toBe("choose_ask");
    expect(assist({ ...cont, question: "두 번째로 할게" }).action?.listingId).toBe("l2");
    const single = { ...base, alert: { kind: "single" as const, listingIds: ["l1"] } };
    expect(assist({ ...single, question: "응 들를게" }).action).toEqual({ type: "request", listingId: "l1" });
    expect(assist({ ...single, question: "아니 다음에" }).action).toEqual({ type: "dismiss", listingId: "l1" });
    // 정차 중 목록에서: 이름을 대면 요청, 제외 매물은 이유를 말하고 요청하지 않는다
    expect(assist({ ...base, question: "캠핑의자 미리 요청해 줘" }).action).toEqual({ type: "request", listingId: "l3" });
    const blocked = assist({ ...base, question: "아기 침대로 할게" });
    expect(blocked.action).toBeNull();
    expect(blocked.text).toContain("지금 알리지 않아요");
  });

  it("모르는 질문엔 핵심 한 줄과 할 수 있는 것을 말하고, 매물이 없으면 그렇게 말한다", () => {
    const u = assist({ ...base, question: "오늘 날씨 어때?", focusId: "l2" });
    expect(u.intent).toBe("unknown");
    expect(u.text).toMatch(/^유모차 9만 원, 6분 더, 트렁크에 쏙\./);
    expect(assist({ ...base, facts: [], question: "뭐 있어?" }).intent).toBe("empty");
  });
});
