/**
 * 대화로 고르기(T34) — 운전자가 말로 묻고 고른다. "카시트 흠집 있어?", "둘 중에 뭐가 더 싸?", "얼마나 돌아가?", "유모차로 할게".
 * 답은 지금 목록(서버가 방금 계산한 후보)의 사실만 쓴다. 여기는 규칙 판(서버에 AI 키가 없을 때, 그리고 AI가 실패했을 때의 바탕).
 * AI 판(서버 assist-ai.ts)도 같은 사실표와 같은 답 모양({text, action})을 쓴다.
 * 행동은 세 가지뿐: request(판매자에게 요청) · choose(경합에서 고르기) · dismiss(이번엔 아니요). 그 밖엔 말만 한다.
 */
import type { Condition, GoLevel } from "./types.ts";
import { CONDITION_LABEL } from "./pricing.ts";
import { josa, wonText } from "./text.ts";
import { EXCLUSION_KO, type Exclusion } from "./matching.ts";

/** 조수가 보는 매물 사실표 — 서버 candidateView와 브리핑에서 뽑는다(정확한 위치는 없다) */
export interface AssistFact {
  listingId: string;
  categoryLabel: string;
  title: string;
  price: number;
  referencePrice: number;
  detourMin: number;
  fit: { kind: "trunk" | "folded3" | "folded" | "none"; label: string };
  energy: { ok: boolean; arrivalSocPct?: number; rangeAfterKm?: number };
  condition: Condition | null;
  brief: { summary: string; findings: string[]; photoChecked: boolean; grade: Condition | null } | null;
  seller: { completed: number; rating: number | null };
  goLevel: GoLevel;
  aheadM: number | null;
  score: number;
  exclusions: Exclusion[];
}

export interface AssistInput {
  question: string;
  facts: AssistFact[];
  /** 화면에서 고른 매물 */
  focusId: string | null;
  /** 떠 있는 질문: 하나 알림이면 그 매물, 경합이면 둘 */
  alert: { kind: "single" | "contention"; listingIds: string[] } | null;
  driving: boolean;
}

export type AssistAction = { type: "request" | "choose" | "dismiss"; listingId: string };

export interface AssistResult {
  /** 읽어 줄 답(두 문장 안) */
  text: string;
  action: AssistAction | null;
  /** 답이 가리키는 매물(화면 표시용) */
  focusId: string | null;
  intent: string;
  source: "rule" | "ai";
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));
const ORDINAL: [RegExp, number][] = [
  [/첫번째|첫째|1번|일번|앞엣?거|처음/, 0],
  [/두번째|둘째|2번|이번째|뒤엣?거/, 1],
  [/세번째|셋째|3번/, 2],
];

/** 질문에 나온 매물 — 품목 이름·제목 낱말·순서말. 없으면 null */
export function resolveItems(q: string, facts: AssistFact[], alertIds: string[] | null): AssistFact[] {
  const nq = norm(q);
  const byName = facts.filter((f) => nq.includes(norm(f.categoryLabel)) || f.title.split(/[\s(),~·]+/).some((w) => w.length >= 2 && !/^\d/.test(w) && nq.includes(norm(w))));
  if (byName.length) return dedupe(byName);
  const pool = alertIds?.length ? facts.filter((f) => alertIds.includes(f.listingId)) : facts;
  const ord = ORDINAL.find(([re]) => re.test(nq));
  if (ord && pool[ord[1]]) return [pool[ord[1]]];
  return [];
}

function dedupe(fs: AssistFact[]): AssistFact[] {
  const seen = new Set<string>();
  return fs.filter((f) => (seen.has(f.listingId) ? false : (seen.add(f.listingId), true)));
}

const okOnly = (facts: AssistFact[]) => facts.filter((f) => f.exclusions.length === 0).sort((a, b) => b.score - a.score);

function conditionText(f: AssistFact): string {
  const b = f.brief;
  if (b?.photoChecked) {
    const seen = b.findings.length ? `사진에서 ${josa(b.findings.slice(0, 3).join(", "), "이/가")} 보여요` : "사진에서 눈에 띄는 흠집은 안 보여요";
    return `${f.categoryLabel}: ${seen}${b.grade ? `, 상태 ${CONDITION_LABEL[b.grade]}` : ""}.`;
  }
  const grade = f.condition ? `판매자는 상태 ${josa(CONDITION_LABEL[f.condition], "으로/로")} 표시했어요` : "상태 표시가 없어요";
  const sum = b?.summary ? ` 판매자 설명: ${b.summary.replace(/[.!…\s]+$/, "")}.` : "";
  return `${f.categoryLabel}: 사진 분석은 없고 ${grade}.${sum}`;
}

function priceText(f: AssistFact): string {
  const diff = f.referencePrice - f.price;
  const vs = diff > 0 ? `기준가보다 ${wonText(diff)} 싸요` : diff < 0 ? `기준가보다 ${wonText(-diff)} 비싸요` : "기준가와 같아요";
  return `${f.categoryLabel} ${wonText(f.price)}, ${vs}.`;
}

function detourText(f: AssistFact): string {
  const ahead = f.aheadM !== null ? `${f.aheadM >= 1000 ? `${(f.aheadM / 1000).toFixed(f.aheadM >= 10000 ? 0 : 1)}km` : `${f.aheadM}m`} 앞, ` : "";
  return `${josa(f.categoryLabel, "은/는")} ${ahead}들르면 ${f.detourMin}분 더 걸려요.`;
}

function fitText(f: AssistFact): string {
  return `${f.categoryLabel}: ${f.fit.label}.`;
}

function energyText(f: AssistFact): string {
  if (f.energy.arrivalSocPct !== undefined) return `${f.categoryLabel}에 들렀다 가면 도착 배터리 ${Math.round(f.energy.arrivalSocPct)}%${f.energy.ok ? "예요, 괜찮아요" : "라 부족해요"}.`;
  if (f.energy.rangeAfterKm !== undefined) return `${f.categoryLabel}에 들렀다 가면 ${Math.round(f.energy.rangeAfterKm)}km ${f.energy.ok ? "남아요" : "남아 부족해요"}.`;
  return `${f.categoryLabel}: 에너지는 ${f.energy.ok ? "괜찮아요" : "부족해요"}.`;
}

function sellerText(f: AssistFact): string {
  return f.seller.completed > 0 ? `${f.categoryLabel} 판매자는 거래 ${f.seller.completed}회${f.seller.rating ? `, 평점 ${f.seller.rating}` : ""}이에요.` : `${f.categoryLabel} 판매자는 아직 거래 기록이 없어요.`;
}

function whyText(f: AssistFact): string {
  return f.exclusions.length ? `${josa(f.categoryLabel, "은/는")} 지금 알리지 않아요: ${f.exclusions.map((e) => EXCLUSION_KO[e]).join(", ")}.` : `${josa(f.categoryLabel, "은/는")} 알릴 수 있는 매물이에요.`;
}

function listText(facts: AssistFact[]): string {
  const ok = okOnly(facts);
  if (!ok.length) return "이번 길에는 알릴 수 있는 매물이 없어요.";
  const top = ok.slice(0, 3).map((f, i) => `${i + 1}위 ${f.categoryLabel} ${f.detourMin}분`);
  return `알릴 수 있는 매물 ${ok.length}개예요. ${top.join(", ")}.`;
}

function recommendText(facts: AssistFact[], pair: AssistFact[] | null): string {
  const pool = pair && pair.length ? pair : okOnly(facts);
  if (!pool.length) return "지금 추천할 매물이 없어요.";
  const best = [...pool].sort((a, b) => b.score - a.score)[0];
  const why: string[] = [];
  if (best.referencePrice - best.price > 0) why.push(`기준가보다 ${wonText(best.referencePrice - best.price)} 싸고`);
  why.push(`${best.detourMin}분 더 걸려요`);
  if (best.fit.kind === "trunk") why.push("트렁크에 들어가요");
  return `${josa(best.categoryLabel, "을/를")} 추천해요. ${why.join(", ")}.`;
}

function compareText(a: AssistFact, b: AssistFact, q: string): string {
  const nq = norm(q);
  if (has(nq, "싸", "가격", "얼마", "저렴")) {
    const [c, d] = a.price <= b.price ? [a, b] : [b, a];
    return c.price === d.price ? `둘 다 ${wonText(c.price)}이에요.` : `${josa(c.categoryLabel, "이/가")} ${wonText(d.price - c.price)} 더 싸요. ${c.categoryLabel} ${wonText(c.price)}, ${d.categoryLabel} ${wonText(d.price)}.`;
  }
  if (has(nq, "가까", "돌아", "우회", "시간", "빨리")) {
    const [c, d] = a.detourMin <= b.detourMin ? [a, b] : [b, a];
    return c.detourMin === d.detourMin ? `둘 다 ${c.detourMin}분 더 걸려요.` : `${josa(c.categoryLabel, "이/가")} ${d.detourMin - c.detourMin}분 덜 돌아가요. ${c.categoryLabel} ${c.detourMin}분, ${d.categoryLabel} ${d.detourMin}분.`;
  }
  if (has(nq, "상태", "흠집", "깨끗", "손상", "새것")) return `${conditionText(a)} ${conditionText(b)}`;
  return recommendText([], [a, b]);
}

/** 규칙 조수. 질문을 읽고 사실표만으로 답한다 */
export function assist(input: AssistInput): AssistResult {
  const { question, facts, alert, driving } = input;
  const nq = norm(question);
  const alertIds = alert?.listingIds ?? null;
  const focus = input.focusId ? (facts.find((f) => f.listingId === input.focusId) ?? null) : null;
  const named = resolveItems(question, facts, alertIds);
  const pair = alert?.kind === "contention" ? facts.filter((f) => alertIds!.includes(f.listingId)) : null;
  const single = alert?.kind === "single" ? (facts.find((f) => f.listingId === alertIds![0]) ?? null) : null;
  /** 답할 매물 하나: 말한 것 → 떠 있는 알림 → 화면에서 고른 것 → 1위 */
  const one = (): AssistFact | null => named[0] ?? single ?? focus ?? (pair ? null : (okOnly(facts)[0] ?? null));
  const done = (text: string, intent: string, f: AssistFact | null = null, action: AssistAction | null = null): AssistResult => ({ text, action, focusId: f?.listingId ?? null, intent, source: "rule" });

  if (!facts.length) return done("지금은 알릴 매물이 없어요. 목적지를 정하면 길 위의 관심 매물을 찾아요.", "empty");

  // ── 행동: 고르기·요청·거절 ──
  if (has(nq, "아니", "안갈", "안들를", "다음에", "됐어", "싫어", "취소")) {
    if (single) return done(`알겠어요. ${josa(single.categoryLabel, "은/는")} 지나갈게요.`, "dismiss", single, { type: "dismiss", listingId: single.listingId });
    if (pair) return done("알겠어요. 둘 다 지나갈게요.", "dismiss", null, { type: "dismiss", listingId: pair[0].listingId });
    return done("알겠어요.", "dismiss");
  }
  if (has(nq, "할게", "들를게", "고를게", "그걸로", "그거로", "요청", "갈게", "응", "좋아", "가자", "네")) {
    const pick = named[0] ?? (pair ? null : (single ?? focus));
    if (pair) {
      if (!pick) return done(`${pair.map((f) => f.categoryLabel).join("? ")}? 하나만 말해 주세요.`, "choose_ask");
      return done(`${josa(pick.categoryLabel, "으로/로")} 할게요. 판매자에게 물어볼게요.`, "choose", pick, { type: "choose", listingId: pick.listingId });
    }
    if (!pick) return done(`어느 매물인지 말해 주세요. ${listText(facts)}`, "request_ask");
    if (pick.exclusions.length) return done(whyText(pick), "request_blocked", pick);
    return done(`${pick.categoryLabel} 판매자에게 요청할게요. 수락하면 경유지로 넣어요.`, "request", pick, { type: single && single.listingId === pick.listingId ? "request" : "request", listingId: pick.listingId });
  }

  // ── 비교·추천·목록 ──
  const two = named.length >= 2 ? named.slice(0, 2) : pair && pair.length === 2 ? pair : null;
  if (two && (has(nq, "둘중", "비교", "뭐가더", "어느게", "어떤게", "누가더", "중에") || (!named.length && pair))) {
    if (has(nq, "싸", "가격", "얼마", "저렴", "가까", "돌아", "우회", "시간", "빨리", "상태", "흠집", "깨끗", "손상", "새것", "추천", "나아", "좋아", "어느", "어떤", "뭐")) return done(compareText(two[0], two[1], question), "compare", null);
  }
  if (has(nq, "추천", "뭐가나", "뭐가좋", "어떤게좋", "어느게좋", "골라줘", "뭘살")) return done(recommendText(facts, pair), "recommend", okOnly(pair ?? facts)[0] ?? null);
  if (has(nq, "뭐있", "뭐가있", "목록", "몇개", "뭐뭐", "어떤게있", "알려줘") && !named.length) return done(listText(facts), "list");

  // ── 매물 하나에 대한 질문 ──
  const f = one();
  if (!f) return done(pair ? `${pair.map((x) => x.categoryLabel).join("? ")}? 둘 중 어느 쪽이 궁금한지 말해 주세요.` : listText(facts), "which");
  if (has(nq, "배터리", "충전", "연료", "기름")) return done(energyText(f), "energy", f);
  if (has(nq, "흠집", "상태", "깨끗", "손상", "스크래치", "긁", "찢", "얼룩", "새것", "괜찮")) return done(conditionText(f), "condition", f);
  if (has(nq, "돌아", "우회", "멀어", "몇분", "시간", "걸려", "얼마나앞")) return done(detourText(f), "detour", f);
  if (/얼마(?!나)/.test(nq) || has(nq, "싸", "가격", "비싸", "기준가", "원이")) return done(priceText(f), "price", f);
  if (has(nq, "실려", "실을", "들어가", "트렁크", "크기", "커요", "작아")) return done(fitText(f), "fit", f);
  if (has(nq, "판매자", "평점", "거래", "믿을")) return done(sellerText(f), "seller", f);
  if (has(nq, "왜", "이유", "안알려", "제외")) return done(whyText(f), "why", f);
  if (has(nq, "설명", "뭐야", "어떤물건", "알려", "요약", "말해", "읽어")) {
    const b = f.brief;
    return done(b ? `${f.categoryLabel} 판매자 설명: ${b.summary.replace(/[.!…\s]+$/, "")}. ${conditionText(f).replace(/^[^:]+: /, "")}` : `${f.categoryLabel}: ${f.title}.`, "describe", f);
  }
  // 모르는 질문: 매물 핵심 한 줄 + 할 수 있는 것
  const hint = driving ? "흠집, 가격, 얼마나 돌아가는지, 실리는지를 물어볼 수 있어요." : "흠집, 가격, 우회 시간, 적재, 판매자를 물어보거나 '카시트로 할게'라고 말해 보세요.";
  return done(`${f.categoryLabel} ${wonText(f.price)}, ${f.detourMin}분 더, ${f.fit.label}. ${hint}`, "unknown", f);
}
