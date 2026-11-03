/** Claude 비전으로 사진 속 물건 크기 추정(Node 서버 전용 — API 키는 서버에만 둔다). */
import { parseAiSize, type SizeEstimator } from "./size-ai.ts";

export function createClaudeSizeEstimator(opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): SizeEstimator {
  const model = opts.model ?? "claude-haiku-5-5";
  const f = opts.fetchImpl ?? fetch;
  return {
    name: `claude:${model}`,
    async estimate({ title, category, photo, categories }) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
      try {
        const prompt = [
          "중고 거래 판매자가 올린 물건 사진이에요. 차에 실을 수 있는지 판단하려고 물건의 바깥 크기를 cm로 추정해 주세요.",
          `제목: ${title || "(없음)"}`,
          `판매자가 고른 품목: ${category ?? "(없음)"}`,
          `품목 id 목록: ${categories.map((c) => `${c.id}(${c.label})`).join(", ")}`,
          '다른 말 없이 JSON 하나로만 답하세요: {"category": 품목 id 또는 null, "width_cm": 숫자, "depth_cm": 숫자, "height_cm": 숫자, "confidence": 0~1, "note": "판매자에게 보여 줄 한 문장(한국어)"}',
          "접거나 분해한 상태로 보이면 그 상태의 크기로 답하세요. 크기를 가늠할 단서가 없으면 confidence를 낮게 주세요.",
        ].join("\n");
        const r = await f("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 300,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        });
        if (!r.ok) {
          console.warn("크기 추정 API 실패", r.status);
          return null;
        }
        const j = (await r.json()) as { content?: { type: string; text?: string }[] };
        const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
        return parseAiSize(text, categories.map((c) => c.id));
      } catch (e) {
        console.warn("크기 추정 실패", (e as Error).message);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
