/** 한국 시간(UTC+9, 서머타임 없음) 계산과 거래 가능 시간 판단 */
import type { Availability } from "./types.ts";

const KST_OFFSET_MS = 9 * 3600 * 1000;

export function kstParts(ms: number): { year: number; month: number; day: number; dow: number; hour: number; minute: number; dayKey: string } {
  const d = new Date(ms + KST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    year,
    month,
    day,
    dow: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dayKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** 한국 시간 "HH:MM" */
export function kstClock(ms: number): string {
  const p = kstParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** 한국 시간 기준 날짜·시각 → epoch ms */
export function kstToMs(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + (m || 0);
}

/** 해당 시각이 거래 가능 시간 안인가. 비어 있으면 항상 가능. 자정을 넘는 구간(22:00~02:00)도 처리 */
export function isAvailableAt(windows: Availability[], ms: number): boolean {
  if (!windows || windows.length === 0) return true;
  const p = kstParts(ms);
  const minute = p.hour * 60 + p.minute;
  for (const w of windows) {
    const from = toMin(w.from);
    const to = toMin(w.to);
    if (from <= to) {
      if (w.days.includes(p.dow) && minute >= from && minute <= to) return true;
    } else {
      // 자정 넘김: 시작일 저녁 또는 다음날 새벽
      if (w.days.includes(p.dow) && minute >= from) return true;
      const prevDow = (p.dow + 6) % 7;
      if (w.days.includes(prevDow) && minute <= to) return true;
    }
  }
  return false;
}

export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function describeAvailability(windows: Availability[]): string {
  if (!windows || windows.length === 0) return "언제든";
  return windows
    .map((w) => {
      const days = [...w.days].sort();
      const weekdays = days.length === 5 && days.every((d, i) => d === i + 1);
      const weekend = days.length === 2 && days[0] === 0 && days[1] === 6;
      const all = days.length === 7;
      const dayText = all ? "매일" : weekdays ? "평일" : weekend ? "주말" : days.map((d) => DOW_KO[d]).join("·");
      return `${dayText} ${w.from}~${w.to}`;
    })
    .join(", ");
}
