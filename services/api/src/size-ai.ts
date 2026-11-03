/**
 * 사진으로 크기 추정(T25) — 판매자가 고른 사진에서 품목과 대략적인 크기를 채운다.
 * 추정기는 주입한다(Node 서버: ANTHROPIC_API_KEY가 있을 때 Claude 비전). 없거나 실패하면 품목 대표 크기 표로 채우고
 * 화면에는 'AI 추정'이 아니라 '품목 기본 크기'라고 쓴다.
 */
import type { SizeCm } from "@jhgo/core";

export interface AiSizeResult {
  sizeCm: SizeCm;
  /** 사진에서 본 품목(우리 품목 id) — 모르면 null */
  category: string | null;
  confidence: number;
  note: string;
}

export interface SizeEstimator {
  readonly name: string;
  estimate(input: { title: string; category: string | null; photo: { mediaType: string; base64: string }; categories: { id: string; label: string }[] }): Promise<AiSizeResult | null>;
}

/** data:image/jpeg;base64,... → 비전 API가 받는 형식만(JPEG·PNG·GIF·WebP). SVG 샘플 사진은 쓰지 않는다 */
export function photoForAi(dataUrl: string | null | undefined): { mediaType: string; base64: string } | null {
  if (!dataUrl) return null;
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  if (m[2].length > 5_000_000) return null;
  return { mediaType: m[1], base64: m[2] };
}

/** 모델 답에서 JSON 한 덩어리를 꺼내 크기로 바꾼다. 값이 이상하면 null */
export function parseAiSize(text: string, categoryIds: string[]): AiSizeResult | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const n = (k: string) => (typeof j[k] === "number" ? Math.round(j[k] as number) : Number.NaN);
  const size = { w: n("width_cm"), d: n("depth_cm"), h: n("height_cm") };
  if (![size.w, size.d, size.h].every((x) => Number.isFinite(x) && x >= 1 && x <= 400)) return null;
  const cat = typeof j.category === "string" && categoryIds.includes(j.category) ? j.category : null;
  const conf = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0.5;
  const note = typeof j.note === "string" ? j.note.slice(0, 120) : "";
  return { sizeCm: size, category: cat, confidence: conf, note };
}
