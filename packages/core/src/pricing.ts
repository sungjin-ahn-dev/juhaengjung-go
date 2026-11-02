/**
 * 기준가 — 다른 플랫폼 시세는 쓰지 않는다. 초기에는 품목별 자체 기준표 × 상태 계수,
 * 거래가 쌓이면 자체 거래 데이터로 바꾼다(기획서 8-2).
 */
import { categoryDef } from "./text.ts";
import type { Condition } from "./types.ts";

export const CONDITION_FACTOR: Record<Condition, number> = { good: 1.0, fair: 0.8, worn: 0.6 };
export const CONDITION_LABEL: Record<Condition, string> = { good: "상", fair: "중", worn: "하" };

export function referencePrice(category: string, condition: Condition): number {
  const def = categoryDef(category);
  const base = def?.basePrice ?? 50000;
  return Math.round((base * CONDITION_FACTOR[condition]) / 1000) * 1000;
}

/** 가격 매력도 P = (기준가 − 가격) ÷ 기준가, 0~1 */
export function priceAttractiveness(price: number, ref: number): number {
  if (ref <= 0) return 0;
  return Math.max(0, Math.min(1, (ref - price) / ref));
}
