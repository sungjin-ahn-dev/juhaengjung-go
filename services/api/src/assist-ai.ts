/**
 * 대화로 고르기(T34)의 AI 쪽 — 같은 사실표를 모델에 주고 두 문장 안의 답과 행동(JSON)을 받는다.
 * 엔진은 주입한다(Node 서버: ANTHROPIC_API_KEY가 있을 때 Claude). 없거나 실패하면 core의 규칙 조수(assist).
 * 모델이 사실표 밖의 말을 하거나 허용되지 않은 행동을 내면 버린다(검사는 parseAiAssist).
 */
import type { AssistAction, AssistFact, AssistInput, AssistResult } from "@jhgo/core";

export interface AssistEngine {
  readonly name: string;
  assist(input: AssistInput): Promise<AssistResult | null>;
}

/** 모델에 주는 사실표 — 정확한 위치는 없다. 숫자는 읽기 쉬운 단위로 */
export function factSheet(facts: AssistFact[]): string {
  return facts
    .map((f, i) =>
      [
        `${i + 1}. [${f.listingId}] ${f.categoryLabel} — ${f.title}`,
        `   가격 ${f.price}원 (기준가 ${f.referencePrice}원), 들르면 +${f.detourMin}분${f.aheadM !== null ? `, ${f.aheadM}m 앞` : ""}, 적재: ${f.fit.label}`,
        `   에너지: ${f.energy.ok ? "괜찮음" : "부족"}${f.energy.arrivalSocPct !== undefined ? ` (도착 배터리 ${Math.round(f.energy.arrivalSocPct)}%)` : ""}`,
        `   판매자 표시 상태: ${f.condition ?? "없음"}, 판매자 거래 ${f.seller.completed}회${f.seller.rating ? ` 평점 ${f.seller.rating}` : ""}`,
        f.brief ? `   판매자 글 요약: ${f.brief.summary}` : "   판매자 글 요약: 없음",
        f.brief?.photoChecked ? `   사진에서 본 것: ${f.brief.findings.length ? f.brief.findings.join(", ") : "눈에 띄는 흠집 없음"}${f.brief.grade ? ` (상태 ${f.brief.grade})` : ""}` : "   사진 분석: 없음(사진을 보지 않았다고 말할 것)",
        f.exclusions.length ? `   지금 알리지 않음: ${f.exclusions.join(", ")}` : "   알릴 수 있음",
      ].join("\n"),
    )
    .join("\n");
}

export function assistPrompt(i: AssistInput): string {
  const alert = i.alert ? (i.alert.kind === "contention" ? `지금 "둘 중 하나" 질문이 떠 있어요: ${i.alert.listingIds.join(", ")}. 고르면 action choose.` : `지금 ${i.alert.listingIds[0]}에 들를지 묻는 알림이 떠 있어요. 들르겠다면 action request, 아니면 dismiss.`) : "지금 떠 있는 알림은 없어요.";
  return [
    "당신은 차 안에서 운전자가 가는 길의 중고 매물을 고르도록 돕는 조수예요. 운전자는 화면을 오래 볼 수 없어요.",
    "아래 사실표에 있는 것만 말하세요. 사진 분석이 없는 매물은 사진을 보지 않았다고 말하고, 추측하지 마세요. 가격은 '3만 5천 원'처럼 읽고, 두 문장 안으로, 한국어로.",
    "행동은 셋뿐이에요: request(판매자에게 요청), choose(둘 중 하나 고르기), dismiss(이번엔 아니요). 운전자가 분명히 고르거나 요청하거나 거절했을 때만 action을 넣고, 아니면 null.",
    "'알릴 수 없음'인 매물은 request하지 말고 이유를 말하세요.",
    `운전 중: ${i.driving ? "예" : "아니요(정차)"}. 화면에서 고른 매물: ${i.focusId ?? "없음"}. ${alert}`,
    "사실표:",
    factSheet(i.facts),
    `운전자의 말: "${i.question}"`,
    '다른 말 없이 JSON 하나로만 답하세요: {"answer": "읽어 줄 답", "action": {"type": "request"|"choose"|"dismiss", "listingId": "..."} 또는 null, "focusId": 답이 가리키는 매물 id 또는 null}',
  ].join("\n");
}

/** 모델 답을 검사해 결과로. 행동은 사실표에 있는 매물·허용된 상황에서만 */
export function parseAiAssist(text: string, i: AssistInput): AssistResult | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j: { answer?: unknown; action?: unknown; focusId?: unknown };
  try {
    j = JSON.parse(m[0]) as typeof j;
  } catch {
    return null;
  }
  const answer = typeof j.answer === "string" ? j.answer.trim().slice(0, 220) : "";
  if (answer.length < 2) return null;
  const ids = new Set(i.facts.map((f) => f.listingId));
  let action: AssistAction | null = null;
  const a = j.action as { type?: unknown; listingId?: unknown } | null | undefined;
  if (a && typeof a === "object" && typeof a.listingId === "string" && ids.has(a.listingId) && ["request", "choose", "dismiss"].includes(a.type as string)) {
    const type = a.type as AssistAction["type"];
    const fact = i.facts.find((f) => f.listingId === a.listingId)!;
    const okChoose = type === "choose" && i.alert?.kind === "contention" && i.alert.listingIds.includes(fact.listingId);
    const okRequest = type === "request" && fact.exclusions.length === 0 && i.alert?.kind !== "contention";
    const okDismiss = type === "dismiss";
    if (okChoose || okRequest || okDismiss) action = { type, listingId: fact.listingId };
  }
  const focusId = typeof j.focusId === "string" && ids.has(j.focusId) ? j.focusId : (action?.listingId ?? null);
  return { text: answer, action, focusId, intent: "ai", source: "ai" };
}

export function createClaudeAssistEngine(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): AssistEngine {
  const model = opts.model ?? "claude-haiku-5-5";
  const f = opts.fetchImpl ?? fetch;
  return {
    name: `claude:${model}`,
    async assist(i) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
      try {
        const r = await f("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: "user", content: [{ type: "text", text: assistPrompt(i) }] }] }),
        });
        if (!r.ok) {
          console.warn("조수 API 실패", r.status);
          return null;
        }
        const j = (await r.json()) as { content?: { type: string; text?: string }[] };
        const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
        return parseAiAssist(text, i);
      } catch (e) {
        console.warn("조수 실패", (e as Error).message);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
