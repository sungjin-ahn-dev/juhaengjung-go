import { kstClock } from "@jhgo/core";

export const fmtClock = (ms: number | null | undefined) => (ms ? kstClock(ms) : "--:--");
export const fmtMin = (s: number | null | undefined) => (s == null ? "-" : `${Math.max(1, Math.round(s / 60))}분`);
export function fmtKm(m: number | null | undefined) {
  if (m == null) return "-";
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}
export function fmtWon(n: number) {
  if (n >= 10000 && n % 1000 === 0) {
    const man = Math.floor(n / 10000);
    const chun = (n % 10000) / 1000;
    return chun ? `${man}만 ${chun}천 원` : `${man}만 원`;
  }
  return `${n.toLocaleString("ko-KR")}원`;
}
export const GO_KO = { must: "무조건 GO", likely: "웬만하면 GO", near: "가까우면 GO" } as const;
export const EXCLUSION_KO: Record<string, string> = {
  detour: "우회 시간이 설정보다 길어요",
  load: "차에 안 들어가요",
  load_seat: "2열에 사람이 있어 2열을 접을 수 없어요",
  energy: "들르면 배터리·연료가 부족해요",
  availability: "도착 시각이 판매자 거래 가능 시간 밖이에요",
  waypoints: "경유지가 이미 2개예요",
  passed: "이미 지나쳤어요",
  dismissed: "이번 주행에서 '아니요'라고 했어요",
  trust: "판매자 응답률이 낮아요",
};
export const CONDITION_KO: Record<string, string> = { good: "상태 상", fair: "상태 중", worn: "상태 하" };
