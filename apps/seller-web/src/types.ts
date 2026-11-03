/** 판매자 앱이 서버에서 받는 모양과 화면 문구 */
import type { Availability, Condition, Listing } from "@jhgo/core";

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

export interface Me {
  id: string;
  name: string;
  role: string;
  homePlace?: Place;
  /** 마지막 등록의 장소·시간·자동 수락(서버가 기억) */
  sellerDefaults?: { pickupPoint: Place; availability: Availability[]; autoAccept: boolean };
  /** 쉬는 중이면 until(없으면 직접 켤 때까지) */
  pause?: { until: number | null; at: number };
}

export interface SellerTrade {
  id: string;
  listingId: string;
  title: string;
  category: string;
  price: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  etaAt: number | null;
  detourMin: number;
  fitLabel: string;
  vehicleModel: string;
  autoAccepted: boolean;
  acceptedAt?: number;
  waypointConfirmedAt?: number;
  comeOutSentAt?: number;
  arrivedAt?: number;
  handedAt?: number;
  receivedAt?: number;
  settleAt?: number;
  settledAt?: number;
  canceledBy?: string;
  reason?: string;
  mismatch?: { reason: string; photos?: string[] };
  nudgedAt?: number;
  sellerComingAt?: number;
  sellerAbsentAt?: number;
  autoConfirmed?: boolean;
  payment: { status: string; amount: number };
  ratings: { buyerToSeller?: number; sellerToBuyer?: number };
  photos: string[];
  pickupPoint: { label: string } | null;
  buyer: { name: string; vehicleModel: string; completed: number; noShow: number; rating: number | null } | null;
}

export interface Summary {
  held: number;
  settled: number;
  refunded: number;
  nextSettleAt: number | null;
  ledger: { id: string; action: string; amount: number; at: number; tradeId: string; title?: string }[];
  trust: { responseRate: number | null; completed: number; rating: number | null; requests: number; canceled: number; noShow: number; mismatch: number };
}

export interface Catalog {
  categories: { id: string; label: string; fragile: boolean }[];
  pickupPlaces: { id: string; label: string; lat: number; lng: number }[];
  /** 서버에 사진 크기 추정(AI)이 있는지 */
  aiSize?: boolean;
  /** 서버가 웹 푸시를 보내는지 */
  push?: boolean;
  tradeConfig?: { sellerWaitMin: number; autoConfirmMin: number; settleAfterMin: number; comeOutBeforeMin: number };
}

export type SellerListing = Listing;

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export const STATUS_KO: Record<string, string> = {
  requested: "응답 기다림",
  accepted: "오는 중",
  arrived: "도착",
  completed: "정산 대기",
  settled: "정산 완료",
  declined: "거절함",
  expired: "응답 시간 지남",
  canceled: "취소",
  declined_mismatch: "현장 거절 · 환불",
  no_show: "구매자 미도착",
  seller_no_show: "만나지 못함 · 환불",
};

export const LISTING_KO: Record<string, string> = { active: "판매 중", reserved: "거래 중", sold: "판매 완료", hidden: "내림" };
export const SIZE_SOURCE_KO: Record<string, string> = { seller_measured: "실측", ai: "사진으로 추정", category: "품목 기본 크기" };

export const CONDITIONS: { id: Condition; short: string; text: string }[] = [
  { id: "good", short: "상", text: "사용감 거의 없음" },
  { id: "fair", short: "중", text: "생활 흠집 조금" },
  { id: "worn", short: "하", text: "눈에 띄는 흠" },
];

/** 거래 가능 시간 고르기 — 대부분은 이 넷 중 하나다 */
export const PRESETS: { id: string; label: string; windows: Availability[] }[] = [
  { id: "weekday_evening", label: "평일 저녁", windows: [{ days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }] },
  { id: "every_evening", label: "매일 저녁", windows: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "18:00", to: "22:00" }] },
  { id: "weekend_day", label: "주말 낮", windows: [{ days: [0, 6], from: "10:00", to: "18:00" }] },
  { id: "anytime", label: "언제든", windows: [] },
];

export function presetOf(windows: Availability[]): string {
  const key = (w: Availability[]) => JSON.stringify(w.map((x) => ({ days: [...x.days].sort(), from: x.from, to: x.to })));
  return PRESETS.find((p) => key(p.windows) === key(windows))?.id ?? "custom";
}

/** 남은 분(올림 없이 반올림, 최소 0) */
export const minutesLeft = (at: number | null | undefined, now: number) => (at ? Math.max(0, Math.round((at - now) / 60000)) : null);

export const errText = (e: unknown) => (e as Error)?.message || "잠시 뒤 다시 해 주세요";
