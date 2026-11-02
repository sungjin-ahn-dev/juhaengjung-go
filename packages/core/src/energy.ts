/**
 * T4 에너지 확인 — 들렀다 가도 목적지까지 갈 수 있는가.
 *
 * 전기차: 목적지 도착 배터리 ≈ S매물 − d(매물→목적지) × (S현재 − S매물) ÷ d(현재→매물)
 *   S현재: Vehicle EvBattery.getEvBatteryStateOfCharge
 *   S매물, d(현재→매물): NaviHelper requestTrip → TripInfo(estimatedSocAtDest, distance)
 *   d(매물→목적지): 서버 경로 계산(외부 길찾기 API / 시연 도로망)
 *   매물이 가까우면(2km 미만) 소비율이 흔들려 차종 기본 소비율을 쓴다.
 * 내연기관: 남은 주행 가능 거리 − (현재→매물 + 매물→목적지) ≥ 최소 여유
 */
export interface EnergyInput {
  powertrain: "ev" | "ice" | "hybrid";
  socNowPct?: number | null;
  socAtListingPct?: number | null;
  distCurToListingM: number;
  distListingToDestM: number;
  defaultSocPctPerKm?: number;
  fuelRangeKm?: number | null;
  minArrivalSocPct: number;
  minRangeAfterKm: number;
}

export interface EnergyResult {
  ok: boolean;
  /** 전기차: 목적지 도착 예상 배터리(%) */
  arrivalSocPct?: number;
  /** 내연기관: 도착 후 남는 주행 가능 거리(km) */
  rangeAfterKm?: number;
  /** 사용한 소비율 (%/km) */
  ratePctPerKm?: number;
  usedDefaultRate?: boolean;
  /** 판단할 신호가 없으면 true (알림을 막지 않는다) */
  unknown?: boolean;
  note: string;
}

const FALLBACK_RATE = 0.22;

export function checkEnergy(i: EnergyInput): EnergyResult {
  if (i.powertrain === "ev") {
    if (i.socNowPct == null) return { ok: true, unknown: true, note: "배터리 정보 없음" };
    const dCur = i.distCurToListingM / 1000;
    const dRest = i.distListingToDestM / 1000;
    const def = i.defaultSocPctPerKm ?? FALLBACK_RATE;
    let rate = def;
    let usedDefault = true;
    let socAtListing = i.socAtListingPct;
    if (socAtListing != null && dCur >= 2 && i.socNowPct - socAtListing > 0) {
      const r = (i.socNowPct - socAtListing) / dCur;
      // 비정상 값은 버린다 (0.05~1.0 %/km 밖)
      if (r >= 0.05 && r <= 1.0) {
        rate = r;
        usedDefault = false;
      }
    }
    if (socAtListing == null) socAtListing = i.socNowPct - dCur * rate;
    const arrival = socAtListing - dRest * rate;
    const ok = arrival >= i.minArrivalSocPct;
    return {
      ok,
      arrivalSocPct: Math.round(arrival * 10) / 10,
      ratePctPerKm: Math.round(rate * 1000) / 1000,
      usedDefaultRate: usedDefault,
      note: ok ? `들렀다 가도 도착 시 배터리 ${Math.round(arrival)}%` : `들르면 도착 시 배터리 ${Math.round(arrival)}%로 부족`,
    };
  }
  if (i.fuelRangeKm == null) return { ok: true, unknown: true, note: "주행 가능 거리 정보 없음" };
  const need = (i.distCurToListingM + i.distListingToDestM) / 1000;
  const after = i.fuelRangeKm - need;
  const ok = after >= i.minRangeAfterKm;
  return {
    ok,
    rangeAfterKm: Math.round(after),
    note: ok ? `도착 후 ${Math.round(after)}km 더 갈 수 있음` : `도착 후 주행 가능 거리 ${Math.round(after)}km로 부족`,
  };
}
