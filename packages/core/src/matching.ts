/**
 * 매칭 — T1 모드, T2 후보, T3 우회 시간, T4 에너지, T5 적재, T6 제외 조건, T7 점수·경합, T16 브리핑.
 *
 * 차가 아는 신호로 "지금 들를 수 있고, 실을 수 있고, 갔다 와도 되는" 매물만 고른다.
 *   - 모드: NaviHelper onNavigationStatus (ROUTE_DRIVE → 경로 매칭, FREE_DRIVE → 지역 매칭)
 *   - 우회 시간 = T(현재→매물) + T(매물→목적지) − T(현재→목적지) + 거래 시간
 *       T(현재→매물): requestTrip 값이 있으면 그것, 없으면 경로 계산
 *       T(현재→목적지): getDestinationInfo.remainTime 이 있으면 그것
 */
import { haversineM, pointAtAlong, projectOnPolyline, type LatLng } from "./geo.ts";
import { checkEnergy, type EnergyResult } from "./energy.ts";
import { fitItem, type FitResult } from "./load.ts";
import { priceAttractiveness } from "./pricing.ts";
import { timeAtAlong, type Route, type RoutingProvider } from "./roadnet.ts";
import { categoryLabel, keywordMatches, wonText } from "./text.ts";
import { isAvailableAt } from "./time.ts";
import {
  responseRate,
  type DriveContext,
  type GoLevel,
  type GoSetting,
  type Interest,
  type Listing,
  type NavStatus,
  type Trust,
  type VehicleProfile,
} from "./types.ts";

export interface MatchConfig {
  /** 경로에서 이 거리 안의 매물만 후보 */
  corridorM: number;
  /** 갈림 지점까지 최소 남은 시간 — 판매자가 응답할 시간 */
  aheadMinS: number;
  /** 갈림 지점까지 이 시간보다 멀면 아직 알리지 않는다 */
  aheadMaxS: number;
  /** 지역 매칭(목적지 없음) 반경 */
  regionRadiusM: number;
  /** 거래에 드는 정차 시간 — 우회 시간에 더한다 */
  handoverS: number;
  /** 1·2위 점수 차가 이보다 작으면 경합 질문 */
  contentionGap: number;
  /** 경합 상대는 알림 창보다 이만큼 더 앞(초)에 있는 매물까지 본다 — 곧 나올 비슷한 매물과 함께 묻기 위해 */
  contentionLookaheadS: number;
  /** 응답률이 이보다 낮은 판매자(요청 3건 이상)는 알리지 않는다 */
  minSellerResponseRate: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  corridorM: 2500,
  aheadMinS: 90,
  aheadMaxS: 540,
  regionRadiusM: 3000,
  handoverS: 90,
  contentionGap: 0.1,
  contentionLookaheadS: 300,
  minSellerResponseRate: 0.3,
};

export type MatchMode = "route" | "region" | "idle";

/** T1 매칭 모드 */
export function decideMode(navStatus: NavStatus, hasDestination: boolean): MatchMode {
  if (navStatus === "ROUTE_DRIVE" && hasDestination) return "route";
  if (navStatus === "FREE_DRIVE" || (navStatus === "ROUTE_DRIVE" && !hasDestination)) return "region";
  return "idle";
}

export type Exclusion =
  | "detour"
  | "load"
  | "load_seat"
  | "energy"
  | "availability"
  | "waypoints"
  | "passed"
  | "dismissed"
  | "trust";

export const EXCLUSION_KO: Record<Exclusion, string> = {
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

export const GO_WEIGHT: Record<GoLevel, number> = { must: 1.0, likely: 0.6, near: 0.3 };
export const GO_LABEL: Record<GoLevel, string> = { must: "무조건 GO", likely: "웬만하면 GO", near: "가까우면 GO" };

export interface ScoreParts {
  G: number;
  W: number;
  P: number;
  D: number;
  M: number;
}

export interface Candidate {
  listingId: string;
  sellerId: string;
  title: string;
  category: string;
  categoryLabel: string;
  price: number;
  referencePrice: number;
  fragile: boolean;
  approxArea: Listing["approxArea"];
  interestId: string;
  interestType: Interest["type"];
  goLevel: GoLevel;
  /** 경로 매칭: 기준 경로에서 매물로 갈라지는 지점의 누적 거리 */
  branchAlongM: number | null;
  timeToBranchS: number | null;
  distFromRouteM: number | null;
  distCurToListingM: number;
  tCurToListingS: number;
  distListingToDestM: number;
  tListingToDestS: number;
  detourS: number;
  detourMin: number;
  fit: FitResult;
  energy: EnergyResult;
  etaAtListing: number;
  available: boolean;
  parts: ScoreParts;
  score: number;
  exclusions: Exclusion[];
  inWindow: boolean;
  /** 음성 알림 문장 */
  speech: string;
  usedTripCheck: boolean;
}

export interface EvalInput {
  ctx: DriveContext;
  vehicle: VehicleProfile;
  listings: Listing[];
  interests: Interest[];
  settings: GoSetting;
  multipliers?: Record<string, number>;
  sellerTrust?: Record<string, Trust>;
  router: RoutingProvider;
  /** 이번 주행의 기준 경로(출발 또는 마지막 재탐색 기준) */
  baseRoute?: Route | null;
  /** 기준 경로 위 현재 위치(누적 거리) */
  currentAlongM?: number;
  dismissed?: Set<string>;
  config?: Partial<MatchConfig>;
  /** 브리핑: 알림 시점 창(window)을 무시하고 전부 평가 */
  ignoreWindow?: boolean;
}

export interface Evaluation {
  mode: MatchMode;
  candidates: Candidate[];
  alertable: Candidate[];
  top: Candidate | null;
  contention: [Candidate, Candidate] | null;
}

/** 매물에 맞는 관심사 — 찜(W=1.0)을 키워드(W=0.5)보다 먼저 */
export function matchInterest(listing: Listing, interests: Interest[]): { interest: Interest; W: number } | null {
  let best: { interest: Interest; W: number; rank: number } | null = null;
  for (const it of interests) {
    let W = 0;
    if (it.type === "wish" && it.listingId === listing.id) W = 1.0;
    else if (it.type === "keyword" && it.keyword && keywordMatches(it.keyword, listing)) W = 0.5;
    if (W === 0) continue;
    const rank = W + GO_WEIGHT[it.goLevel];
    if (!best || rank > best.rank) best = { interest: it, W, rank };
  }
  return best ? { interest: best.interest, W: best.W } : null;
}

function legTime(router: RoutingProvider, a: LatLng, b: LatLng): { t: number; d: number } {
  const r = router.route([a, b]);
  if (!r) return { t: Infinity, d: Infinity };
  return { t: r.durationS, d: r.distanceM };
}

export function speechFor(c: Pick<Candidate, "categoryLabel" | "detourMin" | "fit" | "price" | "referencePrice">, mode: MatchMode): string {
  const priceText =
    c.referencePrice > c.price ? `기준가보다 ${wonText(c.referencePrice - c.price)} 싸요` : `${wonText(c.price)}이에요`;
  const time = mode === "region" ? `여기서 ${c.detourMin}분` : `${c.detourMin}분 더`;
  return `${c.categoryLabel}, ${time}, ${c.fit.label}, ${priceText}. 들를까요?`;
}

export function evaluate(input: EvalInput): Evaluation {
  const cfg = { ...DEFAULT_MATCH_CONFIG, ...(input.config ?? {}) };
  const { ctx, vehicle, router } = input;
  const dest = ctx.destination ?? null;
  const mode = decideMode(ctx.navStatus, !!dest);
  if (mode === "idle") return { mode, candidates: [], alertable: [], top: null, contention: null };

  const base = mode === "route" ? input.baseRoute ?? router.route([ctx.location, dest!]) : null;
  const curAlong = mode === "route" ? input.currentAlongM ?? 0 : 0;
  const curTimeOnBase = base ? timeAtAlong(base, curAlong) : 0;
  // 내비가 알려 준 남은 시간 — requestTrip으로 정확한 지점까지 잰 값과 짝을 맞출 때만 쓴다
  const navRemainS = mode === "route" ? dest!.remainTimeS ?? null : null;

  const candidates: Candidate[] = [];
  for (const l of input.listings) {
    if (l.status !== "active") continue;
    const m = matchInterest(l, input.interests);
    if (!m) continue;
    const goLevel = m.interest.goLevel;
    const point: LatLng = l.pickupPoint;

    let branchAlongM: number | null = null;
    let timeToBranchS: number | null = null;
    let distFromRouteM: number | null = null;
    let passed = false;

    if (mode === "route") {
      const proj = projectOnPolyline(base!.line, point, 0);
      if (!proj || proj.distM > cfg.corridorM) continue;
      branchAlongM = proj.alongM;
      distFromRouteM = proj.distM;
      timeToBranchS = timeAtAlong(base!, proj.alongM) - curTimeOnBase;
      passed = proj.alongM < curAlong - 30;
    } else {
      if (haversineM(ctx.location, point) > cfg.regionRadiusM) continue;
    }

    const trip = ctx.tripChecks?.[l.id];
    // requestTrip 시간·거리는 정확한 지점으로 잰 경우에만 쓴다(대략 위치로 잰 값은 도착 배터리 예측에만)
    const cl = trip?.pointIsExact ? { t: trip.etaS, d: trip.distanceM } : legTime(router, ctx.location, point);
    const ld = mode === "route" ? legTime(router, point, dest!) : { t: 0, d: 0 };

    let detourS: number;
    if (mode === "route") {
      if (trip?.pointIsExact) {
        // 정확한 지점으로 잰 requestTrip: (지금→매물 ETA) + (매물→목적지) − (지금→목적지 남은 시간)
        const curToDestS = navRemainS ?? legTime(router, ctx.location, dest!).t;
        detourS = Math.max(0, cl.t + ld.t - curToDestS) + cfg.handoverS;
      } else {
        // 기준 경로에서 갈라지는 지점부터 비교한다. 거기까지는 들르든 안 들르든 같은 길이라
        // 차가 움직여도 값이 흔들리지 않는다(같은 경로 계산기 값끼리만 뺀다).
        const branchPt = pointAtAlong(base!.line, branchAlongM!).point;
        const bl = legTime(router, branchPt, point);
        const baseRemainS = base!.durationS - timeAtAlong(base!, branchAlongM!);
        detourS = Math.max(0, bl.t + ld.t - baseRemainS) + cfg.handoverS;
      }
    } else detourS = cl.t + cfg.handoverS;
    const detourMin = Math.max(1, Math.round(detourS / 60));

    const fit = fitItem(l.sizeCm, vehicle);
    const energy = checkEnergy({
      powertrain: vehicle.powertrain,
      socNowPct: ctx.socPct,
      socAtListingPct: trip?.socAtDestPct ?? null,
      distCurToListingM: cl.d,
      distListingToDestM: mode === "route" ? ld.d : cl.d,
      defaultSocPctPerKm: vehicle.defaultSocPctPerKm,
      fuelRangeKm: ctx.fuelRangeKm,
      minArrivalSocPct: input.settings.minArrivalSocPct,
      minRangeAfterKm: input.settings.minRangeAfterKm,
    });
    const etaAtListing = ctx.now + Math.round(cl.t * 1000);
    const available = isAvailableAt(l.availability, etaAtListing);

    const exclusions: Exclusion[] = [];
    if (passed) exclusions.push("passed");
    if (input.dismissed?.has(l.id)) exclusions.push("dismissed");
    if (detourS > input.settings.maxDetourMin[goLevel] * 60) exclusions.push("detour");
    if (fit.kind === "none") exclusions.push("load");
    else if (fit.kind === "folded" && ctx.seats.row2Occupied === true) exclusions.push("load_seat");
    if (!energy.ok) exclusions.push("energy");
    if (!available) exclusions.push("availability");
    if (ctx.waypointCount >= 2) exclusions.push("waypoints");
    const rr = responseRate(input.sellerTrust?.[l.sellerId]);
    if (rr !== null && rr < cfg.minSellerResponseRate) exclusions.push("trust");

    const parts: ScoreParts = {
      G: GO_WEIGHT[goLevel],
      W: m.W,
      P: priceAttractiveness(l.price, l.referencePrice),
      D: Math.max(0, Math.min(1, 1 - detourS / (input.settings.maxDetourMin[goLevel] * 60))),
      M: input.multipliers?.[l.category] ?? 1,
    };
    const score = (0.35 * parts.G + 0.2 * parts.W + 0.2 * parts.P + 0.25 * parts.D) * parts.M;

    const inWindow =
      input.ignoreWindow || mode === "region"
        ? true
        : timeToBranchS !== null && timeToBranchS >= cfg.aheadMinS && timeToBranchS <= cfg.aheadMaxS;

    const c: Candidate = {
      listingId: l.id,
      sellerId: l.sellerId,
      title: l.title,
      category: l.category,
      categoryLabel: categoryLabel(l.category),
      price: l.price,
      referencePrice: l.referencePrice,
      fragile: l.fragile,
      approxArea: l.approxArea,
      interestId: m.interest.id,
      interestType: m.interest.type,
      goLevel,
      branchAlongM,
      timeToBranchS: timeToBranchS === null ? null : Math.round(timeToBranchS),
      distFromRouteM: distFromRouteM === null ? null : Math.round(distFromRouteM),
      distCurToListingM: Math.round(cl.d),
      tCurToListingS: Math.round(cl.t),
      distListingToDestM: Math.round(ld.d),
      tListingToDestS: Math.round(ld.t),
      detourS: Math.round(detourS),
      detourMin,
      fit,
      energy,
      etaAtListing,
      available,
      parts,
      score: Math.round(score * 1000) / 1000,
      exclusions,
      inWindow,
      speech: "",
      usedTripCheck: !!trip?.pointIsExact,
    };
    c.speech = speechFor(c, mode);
    candidates.push(c);
  }

  // 경로 순서(가까운 순)로 정렬 — 브리핑 목록용
  candidates.sort((a, b) => (a.branchAlongM ?? a.distCurToListingM) - (b.branchAlongM ?? b.distCurToListingM));
  const alertable = candidates.filter((c) => c.exclusions.length === 0 && c.inWindow).sort((a, b) => b.score - a.score);
  const top = alertable[0] ?? null;
  let contention: [Candidate, Candidate] | null = null;
  if (top) {
    // 경합 상대: 알림 창 안 + 조금 더 앞(곧 나올) 매물 중 점수가 비슷한 것
    const pool = candidates
      .filter(
        (c) =>
          c !== top &&
          c.exclusions.length === 0 &&
          (mode === "region" ||
            input.ignoreWindow ||
            (c.timeToBranchS !== null && c.timeToBranchS >= cfg.aheadMinS && c.timeToBranchS <= cfg.aheadMaxS + cfg.contentionLookaheadS)),
      )
      .sort((a, b) => b.score - a.score);
    const other = pool[0];
    const strong = (g: GoLevel) => g === "must" || g === "likely";
    if (other && Math.abs(top.score - other.score) < cfg.contentionGap && strong(top.goLevel) && strong(other.goLevel)) {
      contention = top.score >= other.score ? [top, other] : [other, top];
    }
  }
  return { mode, candidates, alertable, top, contention };
}

/** 경합 질문 문장 — 한 단어로 고를 수 있게 품목 이름만 */
export function contentionSpeech(pair: [Candidate, Candidate]): string {
  const [a, b] = pair;
  if (a.categoryLabel === b.categoryLabel) return `${a.categoryLabel} 두 곳이 가까워요. 첫 번째? 두 번째?`;
  return `${a.categoryLabel}? ${b.categoryLabel}?`;
}
