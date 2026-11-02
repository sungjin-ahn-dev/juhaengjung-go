/**
 * T14 개인화 — 추천받고 들르지 않고 지나친 매물은 부정 신호.
 * 한 번은 "오늘 바빠서"일 수 있으니, 같은 품목을 서로 다른 날 2번 이상 지나쳤을 때부터 M × 0.9 (하한 0.5).
 * 거래가 성사되면 M × 1.05 (상한 1.2). 모델 재학습이 아니라 사용자별 가중치 조정이다.
 */
export interface PersonalizationState {
  multipliers: Record<string, number>;
  skipDays: Record<string, string[]>;
}

export const emptyPersonalization = (): PersonalizationState => ({ multipliers: {}, skipDays: {} });

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function recordSkip(state: PersonalizationState, category: string, dayKey: string): { state: PersonalizationState; changed: boolean } {
  const days = state.skipDays[category] ?? [];
  if (days.includes(dayKey)) return { state, changed: false };
  const nextDays = [...days, dayKey].slice(-30);
  const cur = state.multipliers[category] ?? 1;
  const changed = nextDays.length >= 2;
  const next = changed ? Math.max(0.5, round3(cur * 0.9)) : cur;
  return {
    state: { multipliers: { ...state.multipliers, [category]: next }, skipDays: { ...state.skipDays, [category]: nextDays } },
    changed,
  };
}

export function recordTrade(state: PersonalizationState, category: string): PersonalizationState {
  const cur = state.multipliers[category] ?? 1;
  return { ...state, multipliers: { ...state.multipliers, [category]: Math.min(1.2, round3(cur * 1.05)) } };
}

/** 개인화 카드 문구 */
export function personalizationNote(category: string, label: string, state: PersonalizationState): string | null {
  const m = state.multipliers[category] ?? 1;
  if (m < 1) return `요즘 지나친 ${label} 같은 매물은 덜 알려 드릴게요.`;
  if (m > 1) return `${label} 거래가 잘 맞았어요. 비슷한 매물을 조금 더 알려 드릴게요.`;
  const days = state.skipDays[category]?.length ?? 0;
  if (days === 1) return `오늘 지나친 ${label}은 한 번만으로는 덜 알리지 않아요.`;
  return null;
}
