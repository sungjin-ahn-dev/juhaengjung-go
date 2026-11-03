/** 주행중GO! 도메인 타입 — 서버·차량 앱·판매자 앱이 함께 쓴다. */
import type { LatLng } from "./geo.ts";

export type GoLevel = "must" | "likely" | "near";
export type Condition = "good" | "fair" | "worn";
export type Powertrain = "ev" | "ice" | "hybrid";
/** Pleos NaviHelper NavigationStatus */
export type NavStatus = "INACTIVE" | "INITIALIZING" | "FREE_DRIVE" | "ROUTE_DRIVE";
export type ListingStatus = "active" | "reserved" | "sold" | "hidden";

export interface SizeCm {
  w: number;
  d: number;
  h: number;
}

/** 거래 가능 시간. days: 0=일 … 6=토, 시각은 한국 시간 "HH:MM" */
export interface Availability {
  days: number[];
  from: string;
  to: string;
}

export interface PickupPoint extends LatLng {
  label: string;
}

export interface ApproxArea extends LatLng {
  radiusM: number;
}

export interface Listing {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: string;
  price: number;
  referencePrice: number;
  condition: Condition;
  fragile: boolean;
  sizeCm: SizeCm;
  /** ai: 사진으로 AI가 추정 / category: 품목 대표 크기 / seller_measured: 판매자 실측 */
  sizeSource: "ai" | "category" | "seller_measured";
  photos: string[];
  /** 수락 전에는 구매자에게 이 범위만 보인다 */
  approxArea: ApproxArea;
  /** 정확한 거래 지점 — 수락 후에만 구매자에게 공개 */
  pickupPoint: PickupPoint;
  availability: Availability[];
  autoAccept: boolean;
  status: ListingStatus;
  createdAt: number;
  /** 판매자에게만 보이는 노출 수(T29): 지나가는 차의 추천 목록에 든 주행 수, 음성 알림 수. 구매자 정보는 남기지 않는다 */
  stats?: { shown: number; alerted: number };
}

/** 구매자에게 보이는 매물(정확한 위치 없음) */
export type BuyerListingView = Omit<Listing, "pickupPoint">;

export interface Interest {
  id: string;
  userId: string;
  type: "keyword" | "wish";
  keyword?: string;
  listingId?: string;
  goLevel: GoLevel;
  createdAt: number;
}

export interface GoSetting {
  /** 등급별 최대 우회 시간(분) */
  maxDetourMin: Record<GoLevel, number>;
  /** 전기차: 들렀다 가도 목적지 도착 배터리가 이 값 이상일 때만 알린다(%) */
  minArrivalSocPct: number;
  /** 내연기관: 도착 후 남아야 하는 주행 가능 거리(km) */
  minRangeAfterKm: number;
}

export const DEFAULT_GO_SETTING: GoSetting = {
  maxDetourMin: { must: 30, likely: 15, near: 5 },
  minArrivalSocPct: 15,
  minRangeAfterKm: 50,
};

export interface VehicleProfile {
  model: string;
  modelYear?: number;
  powertrain: Powertrain;
  seatRows: 2 | 3;
  /** 트렁크 적재 공간(추정치). 3열 차는 3열을 접었을 때 */
  trunk: SizeCm;
  /** 2열을 접었을 때 적재 공간(추정치). 3열 차는 2·3열을 다 접었을 때 */
  folded: SizeCm;
  /** 3열 차: 3열을 세웠을 때 트렁크(추정치) */
  row3Up?: SizeCm;
  /** 기본 전비·연비 (배터리 %/km) — requestTrip 값이 없거나 불안정할 때 */
  defaultSocPctPerKm?: number;
}

export interface SeatState {
  row2Occupied: boolean | null;
  row3Occupied?: boolean | null;
}

/** 차량 앱이 서버로 보내는 주행 맥락 — 좌표는 매칭 계산에만 쓰고 저장하지 않는다 */
export interface DriveContext {
  now: number;
  navStatus: NavStatus;
  location: LatLng;
  destination?: (LatLng & { name?: string; remainTimeS?: number; remainDistM?: number }) | null;
  /** 현재 내비 경유지 수 (NaviHelper getWaypointInfo) */
  waypointCount: number;
  socPct?: number | null;
  fuelRangeKm?: number | null;
  seats: SeatState;
  /** 차 안 requestTrip 결과 (매물별) — 있으면 에너지·시간 계산에 우선 사용 */
  tripChecks?: Record<string, TripCheck>;
}

/** NaviHelper requestTrip → onTripInfo(TripInfo(distance, eta, estimatedSocAtDest, energyConsumption, summary)) */
export interface TripCheck {
  distanceM: number;
  etaS: number;
  socAtDestPct?: number | null;
  energyConsumption?: number | null;
  checkedAt: number;
  /** 정확한 거래 지점으로 잰 값인가 — 수락 전에는 대략 위치(approxArea)로만 잴 수 있어 시간은 서버 계산을 쓴다 */
  pointIsExact?: boolean;
}

export interface Trust {
  userId: string;
  role: "buyer" | "seller";
  requests: number;
  responded: number;
  completed: number;
  canceled: number;
  noShow: number;
  mismatch: number;
  ratingSum: number;
  ratingCount: number;
}

export function emptyTrust(userId: string, role: "buyer" | "seller"): Trust {
  return { userId, role, requests: 0, responded: 0, completed: 0, canceled: 0, noShow: 0, mismatch: 0, ratingSum: 0, ratingCount: 0 };
}

export function responseRate(t: Trust | undefined): number | null {
  if (!t || t.requests < 3) return null;
  return t.responded / t.requests;
}
