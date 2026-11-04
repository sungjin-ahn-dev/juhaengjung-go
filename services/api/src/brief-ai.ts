/**
 * 물건 요약 브리핑(T33)의 AI 쪽 — 판매자 글 + 실제 사진(최대 3장)을 보고 요약과 상태 항목을 JSON으로 받는다.
 * 엔진은 주입한다(Node 서버: ANTHROPIC_API_KEY가 있을 때 Claude 비전). 없거나 실패하면 core의 ruleBrief(글 요약만, 사진 분석 없음).
 */
import { parseAiBrief, type ListingBrief } from "@jhgo/core";

export interface BriefEngine {
  readonly name: string;
  brief(input: { title: string; description: string; condition: string; categoryLabel: string; photos: { mediaType: string; base64: string }[] }): Promise<ListingBrief | null>;
}

export function briefPrompt(i: { title: string; description: string; condition: string; categoryLabel: string; photoCount: number }): string {
  return [
    "중고 거래 판매자가 올린 물건이에요. 구매자는 운전 중이라 사진을 자세히 볼 수 없어요. 차가 읽어 줄 짧은 브리핑을 만들어 주세요.",
    `품목: ${i.categoryLabel}`,
    `제목: ${i.title || "(없음)"}`,
    `판매자가 고른 상태: ${i.condition}(good=상, fair=중, worn=하)`,
    `판매자 글: ${i.description || "(없음)"}`,
    `사진 ${i.photoCount}장이 첨부돼 있어요.`,
    '다른 말 없이 JSON 하나로만 답하세요: {"summary": "판매자 글의 핵심을 한두 문장(90자 안, 한국어, 가격·연락처 제외)", "grade": "good"|"fair"|"worn"|null, "findings": ["사진에서 실제로 보이는 흠집·손상·사용감만 짧게(예: 왼쪽 팔걸이 긁힘(작음))", ...]}',
    "findings는 사진에서 확실히 보이는 것만 최대 5개. 보이지 않으면 빈 배열. 추측하지 말고, 글에만 있는 내용은 findings에 넣지 마세요. grade는 사진과 글을 함께 본 판단이고 모르면 null.",
  ].join("\n");
}

export function createClaudeBriefEngine(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }): BriefEngine {
  const model = opts.model ?? "claude-haiku-5-5";
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  return {
    name: `claude:${model}`,
    async brief(i) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
      try {
        const content: unknown[] = i.photos.slice(0, 3).map((p) => ({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } }));
        content.push({ type: "text", text: briefPrompt({ ...i, photoCount: Math.min(3, i.photos.length) }) });
        const r = await f("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content }] }),
        });
        if (!r.ok) {
          console.warn("브리핑 API 실패", r.status);
          return null;
        }
        const j = (await r.json()) as { content?: { type: string; text?: string }[] };
        const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
        return parseAiBrief(text, i.categoryLabel, now());
      } catch (e) {
        console.warn("브리핑 실패", (e as Error).message);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
