import { describe, expect, it } from "vitest";
import { briefSpeech, parseAiBrief, ruleBrief, sentencesOf, summarize } from "../src/brief.ts";

describe("물건 요약 브리핑(T33)", () => {
  const desc = "아이가 커서 정리해요. 커버 세탁했어요. 2023년 3월 구매했고 등받이 오른쪽에 작은 긁힘 하나 있어요. 직거래만요! 010-1234-5678 연락 주세요. 35,000원";

  it("글을 문장으로 쪼개고 연락처·가격 줄은 뺀다", () => {
    const s = sentencesOf(desc);
    expect(s).toContain("아이가 커서 정리해요.");
    expect(s.some((x) => x.includes("010-"))).toBe(false);
    expect(s.some((x) => /원$/.test(x))).toBe(false);
  });

  it("상태·흠집을 말하는 문장을 먼저 고르고 90자 안으로 줄인다", () => {
    const sum = summarize(desc, "회전형 카시트");
    expect(sum).toContain("긁힘");
    expect(sum).toContain("세탁");
    expect(sum.length).toBeLessThanOrEqual(90);
    expect(summarize("", "회전형 카시트")).toBe("회전형 카시트");
    expect(summarize("아주 긴 설명이 ".repeat(20), "x").length).toBeLessThanOrEqual(90);
  });

  it("규칙 브리핑은 사진을 보지 않았다고 말한다(AI라고 쓰지 않는다)", () => {
    const b = ruleBrief({ title: "회전형 카시트", description: desc, condition: "good", categoryLabel: "카시트" }, 1000);
    expect(b.source).toBe("rule");
    expect(b.condition.photoChecked).toBe(false);
    expect(b.condition.findings).toEqual([]);
    expect(b.speech).toMatch(/^카시트 판매자 설명: /);
    expect(b.speech).toContain("판매자가 상으로 표시했어요");
    expect(b.speech).not.toContain("사진에서");
  });

  it("AI 답을 검사해 브리핑으로 만들고, 말할 문장에 사진에서 본 것을 넣는다", () => {
    const b = parseAiBrief('{"summary":"아이가 커서 정리, 커버 세탁함","grade":"good","findings":["등받이 오른쪽 긁힘(작음)","벨트 끝 보풀"]}', "카시트", 5)!;
    expect(b.source).toBe("ai");
    expect(b.condition.photoChecked).toBe(true);
    expect(b.condition.findings).toHaveLength(2);
    expect(b.speech).toContain("사진에서 등받이 오른쪽 긁힘(작음), 벨트 끝 보풀이 보여요, 상태 상.");
    const clean = parseAiBrief('{"summary":"새것 같아요","grade":null,"findings":[]}', "유모차", 5)!;
    expect(clean.speech).toContain("눈에 띄는 흠집은 안 보여요");
    expect(briefSpeech({ summary: "x", condition: { grade: "fair", findings: ["a", "b", "c", "d"], photoChecked: true } }, "책상")).toContain("a, b, c 등이 보여요, 상태 중");
  });

  it("이상한 AI 답은 버린다", () => {
    expect(parseAiBrief("모르겠어요", "카시트", 1)).toBeNull();
    expect(parseAiBrief('{"summary":"x"}', "카시트", 1)).toBeNull();
    expect(parseAiBrief('{"summary":"괜찮은 물건","grade":"best","findings":"없음"}', "카시트", 1)).toMatchObject({ condition: { grade: null, findings: [] } });
    const many = parseAiBrief(`{"summary":"괜찮은 물건","findings":${JSON.stringify(Array.from({ length: 9 }, (_, i) => "x".repeat(60) + i))}}`, "카시트", 1)!;
    expect(many.condition.findings).toHaveLength(5);
    expect(many.condition.findings[0].length).toBe(40);
  });
});
