/**
 * 물건 요약 브리핑(T33) — 운전 중에는 사진을 크게 봐도 흠집을 알기 어렵다. 그래서 매물마다
 *   1) 판매자가 쓴 글을 한두 문장으로 줄이고
 *   2) 사진에서 본 상태(흠집·손상·사용감)를 짧은 항목으로 적어
 * 목록에서 고르면 화면에 보여 주고 말로도 들려준다.
 * 사진 분석은 서버에 AI 키가 있고 실제 사진(JPEG·PNG·WebP)이 있을 때만 한다. 없으면 글 요약만 규칙으로 만들고,
 * 화면에는 '사진 분석 없음'이라고 쓴다(AI가 안 돌면 AI라고 쓰지 않는다).
 */
import type { Condition } from "./types.ts";
import { CONDITION_LABEL } from "./pricing.ts";
import { josa } from "./text.ts";

export interface ListingBrief {
  /** 판매자 글 요약, 한두 문장(90자 안) */
  summary: string;
  condition: {
    /** 사진·글로 본 상태. 사진 분석이 없으면 판매자가 고른 상태 */
    grade: Condition | null;
    /** 사진에서 본 것 — "왼쪽 팔걸이 긁힘(작음)" 같은 짧은 항목. 사진 분석이 없으면 빈 배열 */
    findings: string[];
    /** 사진을 AI가 봤는지. false면 화면에 '사진 분석 없음' */
    photoChecked: boolean;
  };
  /** 차에서 읽어 줄 문장 */
  speech: string;
  source: "ai" | "rule";
  at: number;
}

const SUMMARY_MAX = 90;

/** 글을 문장으로 쪼갠다(마침표·물음표·느낌표·줄바꿈 기준). 해시태그·가격·연락처 줄은 뺀다 */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .filter((s) => !/^#|^\[|원$|^\d[\d,]*원|연락|전화|카톡|010-/.test(s));
}

/** 규칙 요약: 상태·사용감·하자를 말하는 문장을 먼저, 없으면 앞 문장 */
export function summarize(description: string, title: string): string {
  const sents = sentencesOf(description);
  if (sents.length === 0) return title.trim().slice(0, SUMMARY_MAX) || "판매자 설명이 없어요";
  const tells = /상태|사용감|흠집|스크래치|긁힘|찢|얼룩|오염|고장|작동|세탁|새것|새 제품|미개봉|하자|파손|변색|헤짐|기스/;
  const picked: string[] = [];
  for (const s of sents) if (tells.test(s) && picked.length < 2) picked.push(s);
  for (const s of sents) if (picked.length < 2 && !picked.includes(s)) picked.push(s);
  picked.sort((a, b) => sents.indexOf(a) - sents.indexOf(b)); // 글의 원래 순서대로
  let out = picked.join(" ");
  if (out.length > SUMMARY_MAX) out = out.slice(0, SUMMARY_MAX - 1).replace(/[,\s]+\S*$/, "") + "…";
  return out;
}

export function briefSpeech(b: Pick<ListingBrief, "summary" | "condition">, categoryLabel: string): string {
  const head = `${categoryLabel} 판매자 설명: ${b.summary.replace(/[.!…\s]+$/, "")}`;
  if (b.condition.photoChecked) {
    const f = b.condition.findings;
    const list = f.slice(0, 3).join(", ") + (f.length > 3 ? " 등" : "");
    const seen = f.length ? `사진에서 ${josa(list, "이/가")} 보여요` : "사진에서 눈에 띄는 흠집은 안 보여요";
    const grade = b.condition.grade ? `, 상태 ${CONDITION_LABEL[b.condition.grade]}` : "";
    return `${head}. ${seen}${grade}.`;
  }
  const grade = b.condition.grade ? ` 상태는 판매자가 ${josa(CONDITION_LABEL[b.condition.grade], "으로/로")} 표시했어요.` : "";
  return `${head}.${grade}`;
}

/** 서버에 AI가 없을 때: 글 요약만, 사진은 보지 않음 */
export function ruleBrief(l: { title: string; description: string; condition: Condition; categoryLabel: string }, now: number): ListingBrief {
  const summary = summarize(l.description, l.title);
  const condition = { grade: l.condition, findings: [], photoChecked: false };
  return { summary, condition, speech: briefSpeech({ summary, condition }, l.categoryLabel), source: "rule", at: now };
}

/** 모델 답(JSON 한 덩어리)을 검사해 브리핑으로. 값이 이상하면 null */
export function parseAiBrief(text: string, categoryLabel: string, now: number): ListingBrief | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const summary = typeof j.summary === "string" ? j.summary.trim().slice(0, SUMMARY_MAX) : "";
  if (summary.length < 4) return null;
  const grade = j.grade === "good" || j.grade === "fair" || j.grade === "worn" ? (j.grade as Condition) : null;
  const findings = Array.isArray(j.findings)
    ? (j.findings as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 40))
        .slice(0, 5)
    : [];
  const condition = { grade, findings, photoChecked: true };
  return { summary, condition, speech: briefSpeech({ summary, condition }, categoryLabel), source: "ai", at: now };
}
