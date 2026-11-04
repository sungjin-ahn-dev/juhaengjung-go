/**
 * 주행중GO! 서비스 계층 — 사용자·매물·관심사·주행 세션·거래·정산·신뢰도·알림.
 * 저장소·시계·경로 계산을 주입받아 Node 서버와 브라우저 시연에서 같은 코드로 돈다.
 *
 * 개인정보 원칙(T18)
 *  - 구매자 위치·경로·목적지는 주행 세션(메모리)에만 두고 저장하지 않는다.
 *  - 판매자에게는 구매자 위치 대신 도착 예정 시각만 보낸다.
 *  - 정확한 거래 지점은 수락 후에만 구매자에게 보인다(수락 전에는 approxArea).
 */
import {
  applyTradeEvent,
  approxArea,
  ACTIVE_STATUSES,
  CATEGORIES,
  categorize,
  categoryDef,
  categoryLabel,
  ruleBrief,
  assist,
  type AssistFact,
  type AssistResult,
  type ListingBrief,
  createTrade,
  DEFAULT_GO_SETTING,
  DEFAULT_MATCH_CONFIG,
  DEFAULT_TRADE_CONFIG,
  emptyPersonalization,
  emptyTrust,
  estimateSize,
  evaluate,
  haversineM,
  isAvailableAt,
  kstClock,
  kstParts,
  josa,
  needsMeasuredSize,
  nextKstMidnight,
  pauseActive,
  personalizationNote,
  projectOnPolyline,
  recordSkip,
  recordTrade,
  referencePrice,
  requestBlock,
  responseRate,
  sellerAbsentAllowedAt,
  TradeError,
  vehicleByModel,
  wonText,
  type Availability,
  type BuyerListingView,
  type Candidate,
  type Condition,
  type DriveContext,
  type Effect,
  type GoLevel,
  type GoSetting,
  type Interest,
  type LatLng,
  type Listing,
  type MatchConfig,
  type PersonalizationState,
  type PickupAccess,
  type Route,
  type RoutingProvider,
  type SellerPause,
  type SizeCm,
  type Trade,
  type TradeConfig,
  type TradeEvent,
  type Trust,
  type VehicleProfile,
} from "@jhgo/core";
import { maskName, newId, newToken, type AppEvent, type Clock, type EventBus, type Store } from "./infra.ts";
import { isPushSubscription, type PushSender, type PushSubscriptionJson } from "./push.ts";
import { photoForAi, type SizeEstimator } from "./size-ai.ts";
import type { BriefEngine } from "./brief-ai.ts";
import type { AssistEngine } from "./assist-ai.ts";

export interface User {
  id: string;
  role: "buyer" | "seller";
  name: string;
  token: string;
  createdAt: number;
  vehicle?: VehicleProfile;
  settings?: GoSetting;
  personalization?: PersonalizationState;
  /** 판매자 기본 거래 지점 */
  homePlace?: { lat: number; lng: number; label: string };
  /** 판매자가 마지막으로 정한 거래 장소·시간·자동 수락 — 다음 등록의 기본값(T27) */
  sellerDefaults?: { pickupPoint: { lat: number; lng: number; label: string }; availability: Availability[]; autoAccept: boolean; pickupAccess?: PickupAccess | null };
  /** 판매자 쉬기(T27): 이 동안은 지나가는 차에 매물을 보이지 않는다 */
  pause?: SellerPause;
  /** 판매점(T38): 영업시간 동안 반복 응대하는 중고 판매점. 구매자 화면에 '판매점'으로 보이고 기다리는 시간을 더하지 않는다 */
  shop?: { name: string };
  /**
   * 구매자 결제 수단(T23). 실서비스는 결제 대행사(PG) 결제창에서 카드를 등록하고 우리는 빌링 키만 받는다.
   * 시연은 실제 결제가 없는 테스트 수단만 쓴다. 카드 번호는 이 앱 어디에도 받지 않는다.
   */
  paymentMethod?: { kind: "test"; label: string; addedAt: number };
}

export interface LedgerEntry {
  id: string;
  tradeId: string;
  sellerId: string;
  buyerId: string;
  action: "hold" | "capture" | "refund";
  amount: number;
  at: number;
}

interface TrustDoc extends Trust {
  id: string;
}

export interface ServiceConfig {
  trade: TradeConfig;
  match: Partial<MatchConfig>;
  /** 경로에서 이만큼 벗어나면 기준 경로를 다시 계산 */
  rerouteDeviationM: number;
}

export const DEFAULT_SERVICE_CONFIG: ServiceConfig = {
  trade: DEFAULT_TRADE_CONFIG,
  match: {},
  rerouteDeviationM: 300,
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceDeps {
  store: Store;
  bus: EventBus;
  clock: Clock;
  router: RoutingProvider;
  config?: Partial<ServiceConfig>;
  /** 판매자 웹 푸시(Node 서버). 없으면 열린 페이지의 실시간 알림만 */
  push?: PushSender;
  /** 사진으로 크기 추정(Node 서버, API 키가 있을 때). 없으면 품목 대표 크기 */
  sizeAI?: SizeEstimator;
  /** 물건 요약 브리핑(T33)의 사진 분석(Node 서버, API 키가 있을 때). 없으면 글 요약만(규칙) */
  briefAI?: BriefEngine;
  /** 대화로 고르기(T34)의 AI(Node 서버, API 키가 있을 때). 없으면 규칙 조수 */
  assistAI?: AssistEngine;
  /** quick 요청(Gleo 경로 — Gleo는 7초 뒤 취소)에서 AI를 기다리는 최대 시간. 기본 3000ms, 넘으면 규칙 조수 */
  assistQuickMs?: number;
}

/** 타이머가 프로세스를 붙잡지 않도록 unref */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

interface PushDoc {
  id: string;
  userId: string;
  sub: PushSubscriptionJson;
  createdAt: number;
}

/** 요청을 막는 이유 — 차 화면은 알림을 띄우지 않고 목록 위에 이 문장을 보여 준다 */
export interface RequestBlockView {
  reason: "payment" | "limit";
  text: string;
  until?: number;
}

interface DriveSession {
  buyerId: string;
  startedAt: number;
  destKey: string;
  dest: LatLng & { name?: string };
  baseRoute: Route;
  routeKey: string;
  currentAlongM: number;
  originalDurationS: number;
  originalDistanceM: number;
  alerted: Map<string, { at: number; category: string }>;
  requested: Set<string>;
  dismissed: Set<string>;
  skipped: Set<string>;
  /** 이번 주행에서 추천 목록에 든 매물(판매자 노출 수는 주행마다 한 번만 센다) */
  shown: Set<string>;
  notices: { type: string; text: string; at: number; listingId?: string }[];
}

export interface DriveContextInput extends DriveContext {
  /** NaviHelper getWaypointInfo 좌표 (경로 재계산용, 저장하지 않음) */
  waypoints?: LatLng[];
}

export interface ListingInput {
  title: string;
  description?: string;
  category?: string | null;
  price: number;
  condition: Condition;
  fragile?: boolean;
  sizeCm: SizeCm;
  sizeSource: "ai" | "category" | "seller_measured";
  photos?: string[];
  pickupPoint: { lat: number; lng: number; label: string };
  availability?: Availability[];
  autoAccept?: boolean;
  /** 차 세우기 쉬운지(T39) */
  pickupAccess?: PickupAccess | null;
}

const keyOf = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

export class Service {
  readonly cfg: ServiceConfig;
  private drives = new Map<string, DriveSession>();

  constructor(readonly d: ServiceDeps) {
    this.cfg = {
      ...DEFAULT_SERVICE_CONFIG,
      ...d.config,
      trade: { ...DEFAULT_TRADE_CONFIG, ...(d.config?.trade ?? {}) },
      match: { ...(d.config?.match ?? {}) },
    };
  }

  now() {
    return this.d.clock.now();
  }

  // ───────────────────────── 사용자 ─────────────────────────

  createUser(role: "buyer" | "seller", name: string, extra: Partial<User> = {}): User {
    const clean = (name ?? "").trim().slice(0, 20);
    if (!clean) throw new ApiError(422, "name_required", "이름을 입력해 주세요");
    const user: User = { id: newId(role === "buyer" ? "b" : "s"), role, name: clean, token: newToken(), createdAt: this.now(), ...extra };
    if (role === "buyer") {
      user.vehicle ??= vehicleByModel("아이오닉 5");
      user.settings ??= DEFAULT_GO_SETTING;
      user.personalization ??= emptyPersonalization();
    }
    this.d.store.put("users", user);
    return user;
  }

  userByToken(token: string | null | undefined): User | undefined {
    if (!token) return undefined;
    return this.d.store.list<User>("users", (u) => u.token === token)[0];
  }

  user(id: string): User {
    const u = this.d.store.get<User>("users", id);
    if (!u) throw new ApiError(404, "user_not_found", "사용자를 찾을 수 없어요");
    return u;
  }

  publicUser(u: User) {
    const { token: _t, ...rest } = u;
    void _t;
    return rest;
  }

  trust(userId: string, role: "buyer" | "seller"): Trust {
    return this.d.store.get<TrustDoc>("trust", `${userId}:${role}`) ?? emptyTrust(userId, role);
  }

  private bumpTrust(userId: string, role: "buyer" | "seller", f: (t: Trust) => void) {
    const t = this.trust(userId, role);
    f(t);
    this.d.store.put<TrustDoc>("trust", { ...t, id: `${userId}:${role}` });
  }

  trustSummary(userId: string, role: "buyer" | "seller") {
    const t = this.trust(userId, role);
    return {
      ...t,
      responseRate: responseRate(t),
      rating: t.ratingCount ? Math.round((t.ratingSum / t.ratingCount) * 10) / 10 : null,
    };
  }

  // ───────────────────────── 판매자: 같이 올리기 (T17) ─────────────────────────

  createListing(seller: User, i: ListingInput): Listing {
    this.requireRole(seller, "seller");
    const title = (i.title ?? "").trim().slice(0, 60);
    if (!title) throw new ApiError(422, "title_required", "제목을 입력해 주세요");
    if (!Number.isFinite(i.price) || i.price < 0 || i.price > 10_000_000) throw new ApiError(422, "bad_price", "가격을 확인해 주세요");
    if (!["good", "fair", "worn"].includes(i.condition)) throw new ApiError(422, "bad_condition", "상태를 골라 주세요");
    const size = i.sizeCm;
    if (!size || [size.w, size.d, size.h].some((x) => !Number.isFinite(x) || x <= 0 || x > 400))
      throw new ApiError(422, "bad_size", "크기를 확인해 주세요 (1~400cm)");
    if (needsMeasuredSize(size) && i.sizeSource !== "seller_measured")
      throw new ApiError(422, "measure_required", "한 변이 60cm 이상인 물건은 실측을 확인해야 올릴 수 있어요");
    const p = i.pickupPoint;
    if (!p || !(p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132) || !p.label)
      throw new ApiError(422, "bad_pickup", "거래 지점을 골라 주세요");
    const availability = (i.availability ?? []).filter((w) => w.days?.length && /^\d{2}:\d{2}$/.test(w.from) && /^\d{2}:\d{2}$/.test(w.to));
    const category = i.category && categoryDef(i.category) ? i.category : "etc";
    const id = newId("l");
    const photos = (i.photos ?? []).filter((x) => typeof x === "string" && x.length < 400_000).slice(0, 3);
    const listing: Listing = {
      id,
      sellerId: seller.id,
      title,
      description: (i.description ?? "").slice(0, 1000),
      category,
      price: Math.round(i.price),
      referencePrice: referencePrice(category, i.condition),
      condition: i.condition,
      fragile: !!i.fragile || !!categoryDef(category)?.fragile,
      sizeCm: { w: Math.round(size.w), d: Math.round(size.d), h: Math.round(size.h) },
      sizeSource: ["ai", "category", "seller_measured"].includes(i.sizeSource) ? i.sizeSource : "category",
      photos,
      approxArea: approxArea(p, id),
      pickupPoint: { lat: p.lat, lng: p.lng, label: p.label.slice(0, 40) },
      availability,
      autoAccept: !!i.autoAccept,
      status: "active",
      createdAt: this.now(),
      confirmedAt: this.now(),
      pickupAccess: i.pickupAccess === "easy" || i.pickupAccess === "hard" ? i.pickupAccess : undefined,
    };
    // 물건 요약 브리핑(T33): 글 요약은 바로(규칙), 사진 분석은 AI가 있고 실제 사진이 있을 때 뒤이어 갱신
    listing.brief = ruleBrief({ title, description: listing.description, condition: listing.condition, categoryLabel: categoryLabel(category) }, this.now());
    this.d.store.put("listings", listing);
    void this.refreshBriefAI(listing.id);
    // 다음 등록 때 다시 고르지 않게 — 장소·시간·자동 수락을 판매자 기본값으로 둔다
    this.d.store.put("users", { ...this.user(seller.id), sellerDefaults: { pickupPoint: listing.pickupPoint, availability, autoAccept: listing.autoAccept, pickupAccess: listing.pickupAccess ?? null } });
    return listing;
  }

  /** 사진 분석 브리핑: 엔진과 실제 사진(JPEG·PNG·WebP)이 있을 때만. 실패하면 규칙 요약을 그대로 둔다 */
  async refreshBriefAI(listingId: string): Promise<ListingBrief | null> {
    const l = this.d.store.get<Listing>("listings", listingId);
    if (!l || !this.d.briefAI) return null;
    const photos = l.photos.map((p) => photoForAi(p)).filter((p): p is { mediaType: string; base64: string } => !!p);
    if (photos.length === 0) return null;
    try {
      const b = await this.d.briefAI.brief({ title: l.title, description: l.description, condition: l.condition, categoryLabel: categoryLabel(l.category), photos });
      if (!b) return null;
      const cur = this.d.store.get<Listing>("listings", listingId);
      if (!cur) return null;
      this.d.store.put("listings", { ...cur, brief: b });
      return b;
    } catch {
      return null;
    }
  }

  listingPhotos(listingId: string): string[] {
    return this.d.store.get<Listing>("listings", listingId)?.photos ?? [];
  }

  /** 매물 브리핑 조회(구매자): 없으면 규칙으로 만들어 둔다(예전 매물) */
  briefOf(listingId: string): ListingBrief | null {
    const l = this.d.store.get<Listing>("listings", listingId);
    if (!l) return null;
    if (l.brief) return l.brief;
    const b = ruleBrief({ title: l.title, description: l.description, condition: l.condition, categoryLabel: categoryLabel(l.category) }, this.now());
    this.d.store.put("listings", { ...l, brief: b });
    return b;
  }

  /** 판매자 쉬기(T27): 1시간 / 오늘 / 직접 다시 켤 때까지 / 끄기 */
  setPause(seller: User, b: { for?: string }) {
    this.requireRole(seller, "seller");
    const now = this.now();
    let pause: SellerPause | null;
    if (b.for === "1h") pause = { until: now + 3600_000, at: now };
    else if (b.for === "today") pause = { until: nextKstMidnight(now), at: now };
    else if (b.for === "manual") pause = { until: null, at: now };
    else if (b.for === "off") pause = null;
    else throw new ApiError(422, "bad_pause", "쉬는 시간을 골라 주세요");
    const { pause: _old, ...rest } = this.user(seller.id);
    void _old;
    this.d.store.put("users", pause ? { ...rest, pause } : rest);
    return { pause };
  }

  sellerPaused(sellerId: string, now = this.now()): boolean {
    return pauseActive(this.d.store.get<User>("users", sellerId)?.pause, now);
  }

  /** 크기 채우기(T17·T25): 사진이 있고 추정기가 있으면 사진으로, 아니면 품목 대표 크기 */
  async estimateSizeFor(seller: User, b: { title?: string; category?: string | null; photo?: string | null }) {
    this.requireRole(seller, "seller");
    const title = (b.title ?? "").slice(0, 60);
    const category = b.category && categoryDef(b.category) ? b.category : categorize(title);
    const photo = photoForAi(b.photo);
    if (photo && this.d.sizeAI) {
      const r = await this.d.sizeAI.estimate({ title, category, photo, categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label })) });
      if (r) {
        return {
          estimate: { sizeCm: r.sizeCm, method: "ai_photo" as const, confidence: r.confidence, note: r.note || "사진으로 크기를 추정했어요. 줄자로 재서 고쳐 주세요." },
          category: r.category ?? category,
          needsMeasured: needsMeasuredSize(r.sizeCm),
        };
      }
    }
    const est = estimateSize(title, category);
    if (!est) return { estimate: null, category, needsMeasured: false };
    const why = photo && this.d.sizeAI ? "사진으로 추정하지 못해 " : "";
    return {
      estimate: { sizeCm: est.sizeCm, method: "category_table" as const, confidence: est.confidence, note: `${why}${est.note}` },
      category,
      needsMeasured: needsMeasuredSize(est.sizeCm),
    };
  }

  updateListing(seller: User, id: string, patch: Partial<Pick<Listing, "status" | "autoAccept" | "availability" | "price" | "pickupAccess">> & { confirm?: boolean }): Listing {
    const l = this.d.store.get<Listing>("listings", id);
    if (!l || l.sellerId !== seller.id) throw new ApiError(404, "listing_not_found", "매물을 찾을 수 없어요");
    const busy = this.d.store.list<Trade>("trades", (t) => t.listingId === id && ACTIVE_STATUSES.includes(t.status)).length > 0;
    if (patch.status && busy && patch.status !== "reserved") throw new ApiError(409, "listing_busy", "진행 중인 거래가 있어 지금은 바꿀 수 없어요");
    const next: Listing = { ...l };
    if (patch.status && ["active", "sold", "hidden"].includes(patch.status)) next.status = patch.status;
    if (patch.autoAccept !== undefined) next.autoAccept = !!patch.autoAccept;
    if (patch.availability) next.availability = patch.availability;
    if (patch.price !== undefined && Number.isFinite(patch.price) && patch.price >= 0) next.price = Math.round(patch.price);
    if (patch.pickupAccess === "easy" || patch.pickupAccess === "hard") next.pickupAccess = patch.pickupAccess;
    else if (patch.pickupAccess === null) delete next.pickupAccess;
    // '아직 있어요'(T37): 판매자가 확인한 시각을 새로 찍는다 → 다시 7일 동안 지나가는 차에 보인다
    if (patch.confirm) next.confirmedAt = this.now();
    this.d.store.put("listings", next);
    return next;
  }

  /** 판매자 물건 줄에 붙는 확인 상태(T37): 5일이 지나면 '아직 있어요?'를 묻고, 7일이 지나면 차에 보이지 않는다 */
  listingFreshness(l: Listing, now = this.now()): { ageDays: number; needsConfirm: boolean; stale: boolean; hiddenInDays: number } {
    const age = now - (l.confirmedAt ?? l.createdAt);
    const freshMs = this.cfg.match.freshMs ?? DEFAULT_MATCH_CONFIG.freshMs;
    return {
      ageDays: Math.floor(age / 86_400_000),
      needsConfirm: age >= freshMs - 2 * 86_400_000,
      stale: age > freshMs,
      hiddenInDays: Math.max(0, Math.ceil((freshMs - age) / 86_400_000)),
    };
  }

  /** 판매자 물건 목록 + 확인 상태(T37). 폰이 '아직 있어요'를 보여 줄지 정한다 */
  sellerListings(seller: User): (Listing & { freshness: ReturnType<Service["listingFreshness"]> })[] {
    return this.d.store
      .list<Listing>("listings", (l) => l.sellerId === seller.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((l) => ({ ...l, freshness: this.listingFreshness(l) }));
  }

  // ───────────────────────── 구매자: 차·설정·관심사 ─────────────────────────

  setVehicle(buyer: User, v: { model: string } | VehicleProfile): VehicleProfile {
    this.requireRole(buyer, "buyer");
    const base = vehicleByModel(v.model);
    const profile: VehicleProfile | undefined = "trunk" in v && v.trunk ? (v as VehicleProfile) : base;
    if (!profile) throw new ApiError(422, "unknown_model", `${v.model}의 적재 공간 정보가 아직 없어요`);
    this.d.store.put("users", { ...this.user(buyer.id), vehicle: { ...profile, modelYear: (v as VehicleProfile).modelYear ?? profile.modelYear } });
    return profile;
  }

  setSettings(buyer: User, s: Partial<GoSetting>): GoSetting {
    this.requireRole(buyer, "buyer");
    const cur = buyer.settings ?? DEFAULT_GO_SETTING;
    const clamp = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : dflt);
    const next: GoSetting = {
      maxDetourMin: {
        must: clamp(s.maxDetourMin?.must, 1, 90, cur.maxDetourMin.must),
        likely: clamp(s.maxDetourMin?.likely, 1, 60, cur.maxDetourMin.likely),
        near: clamp(s.maxDetourMin?.near, 1, 30, cur.maxDetourMin.near),
      },
      minArrivalSocPct: clamp(s.minArrivalSocPct, 5, 50, cur.minArrivalSocPct),
      minRangeAfterKm: clamp(s.minRangeAfterKm, 10, 200, cur.minRangeAfterKm),
    };
    this.d.store.put("users", { ...this.user(buyer.id), settings: next });
    return next;
  }

  setPaymentMethod(buyer: User, b: { kind?: string }) {
    this.requireRole(buyer, "buyer");
    if (b.kind !== "test") throw new ApiError(422, "bad_payment", "시연에서는 테스트 결제 수단만 등록할 수 있어요");
    const pm = { kind: "test" as const, label: "테스트 결제 수단(실제 결제 없음)", addedAt: this.now() };
    this.d.store.put("users", { ...this.user(buyer.id), paymentMethod: pm });
    return pm;
  }

  clearPaymentMethod(buyer: User) {
    this.requireRole(buyer, "buyer");
    if (this.activeTradeOf(buyer.id)) throw new ApiError(409, "trade_in_progress", "진행 중인 거래가 끝나면 바꿀 수 있어요");
    const { paymentMethod: _pm, ...rest } = this.user(buyer.id);
    void _pm;
    this.d.store.put("users", rest);
  }

  /** 요청을 막는 이유: 결제 수단 없음(T23), 수락 뒤 취소·노쇼 반복(T22) */
  blockFor(buyer: User, now = this.now()): RequestBlockView | null {
    const u = this.d.store.get<User>("users", buyer.id) ?? buyer;
    if (!u.paymentMethod) return { reason: "payment", text: "결제 수단이 없어 요청할 수 없어요. 폰의 주행중GO!에서 등록해 주세요" };
    const b = requestBlock(this.d.store.list<Trade>("trades", (t) => t.buyerId === buyer.id), now);
    if (b) {
      const p = kstParts(b.until);
      return { reason: "limit", until: b.until, text: `수락 뒤 취소·노쇼가 최근 30일에 ${b.count}번이라 ${p.month}월 ${p.day}일 ${kstClock(b.until)}까지 요청할 수 없어요` };
    }
    return null;
  }

  /** 관심사 보기 — 찜은 매물 제목을 붙인다(정확한 위치는 없음) */
  interestViews(buyer: User) {
    return this.interests(buyer).map((it) => {
      if (it.type !== "wish" || !it.listingId) return it;
      const l = this.d.store.get<Listing>("listings", it.listingId);
      return { ...it, title: l?.title ?? "내려간 매물", listingStatus: l?.status ?? "hidden" };
    });
  }

  interests(buyer: User): Interest[] {
    return this.d.store.list<Interest>("interests", (i) => i.userId === buyer.id).sort((a, b) => a.createdAt - b.createdAt);
  }

  addInterest(buyer: User, i: { type: "keyword" | "wish"; keyword?: string; listingId?: string; goLevel: GoLevel }): Interest {
    this.requireRole(buyer, "buyer");
    if (!["must", "likely", "near"].includes(i.goLevel)) throw new ApiError(422, "bad_go_level", "GO 등급을 골라 주세요");
    if (i.type === "keyword") {
      const kw = (i.keyword ?? "").trim().slice(0, 20);
      if (!kw) throw new ApiError(422, "keyword_required", "키워드를 입력해 주세요");
      const dup = this.interests(buyer).find((x) => x.type === "keyword" && x.keyword === kw);
      if (dup) {
        const upd = { ...dup, goLevel: i.goLevel };
        this.d.store.put("interests", upd);
        return upd;
      }
      const it: Interest = { id: newId("i"), userId: buyer.id, type: "keyword", keyword: kw, goLevel: i.goLevel, createdAt: this.now() };
      this.d.store.put("interests", it);
      return it;
    }
    const l = i.listingId ? this.d.store.get<Listing>("listings", i.listingId) : undefined;
    if (!l) throw new ApiError(404, "listing_not_found", "매물을 찾을 수 없어요");
    const dup = this.interests(buyer).find((x) => x.type === "wish" && x.listingId === l.id);
    const it: Interest = dup ? { ...dup, goLevel: i.goLevel } : { id: newId("i"), userId: buyer.id, type: "wish", listingId: l.id, goLevel: i.goLevel, createdAt: this.now() };
    this.d.store.put("interests", it);
    return it;
  }

  removeInterest(buyer: User, id: string) {
    const it = this.d.store.get<Interest>("interests", id);
    if (!it || it.userId !== buyer.id) throw new ApiError(404, "interest_not_found", "관심사를 찾을 수 없어요");
    this.d.store.remove("interests", id);
  }

  // ───────────────────────── 주행 세션 · 매칭 ─────────────────────────

  private sessionFor(buyer: User, ctx: DriveContextInput): DriveSession | null {
    if (!ctx.destination) {
      this.drives.delete(buyer.id);
      return null;
    }
    const destKey = keyOf(ctx.destination);
    let s = this.drives.get(buyer.id);
    const wps = ctx.waypoints ?? [];
    const routeKey = destKey + "|" + wps.map(keyOf).join(";");
    if (!s || s.destKey !== destKey) {
      const route = this.d.router.route([ctx.location, ...wps, ctx.destination]);
      if (!route) throw new ApiError(422, "no_route", "경로를 찾지 못했어요");
      s = {
        buyerId: buyer.id,
        startedAt: ctx.now,
        destKey,
        dest: { lat: ctx.destination.lat, lng: ctx.destination.lng, name: ctx.destination.name },
        baseRoute: route,
        routeKey,
        currentAlongM: 0,
        originalDurationS: route.durationS,
        originalDistanceM: route.distanceM,
        alerted: new Map(),
        requested: new Set(),
        dismissed: new Set(),
        skipped: new Set(),
        shown: new Set(),
        notices: [],
      };
      this.drives.set(buyer.id, s);
      return s;
    }
    // 경유지가 바뀌었거나 경로에서 벗어나면 기준 경로를 다시 계산
    const proj = projectOnPolyline(s.baseRoute.line, ctx.location, Math.max(0, s.currentAlongM - 100));
    if (s.routeKey !== routeKey || !proj || proj.distM > this.cfg.rerouteDeviationM) {
      const route = this.d.router.route([ctx.location, ...wps, ctx.destination]);
      if (route) {
        s.baseRoute = route;
        s.routeKey = routeKey;
        s.currentAlongM = 0;
      }
    } else {
      s.currentAlongM = Math.max(s.currentAlongM, proj.alongM);
    }
    return s;
  }

  private evalFor(buyer: User, ctx: DriveContextInput, s: DriveSession | null, ignoreWindow: boolean) {
    // 쉬는 판매자의 매물은 지나가는 차에 보이지 않는다(T27)
    const paused = new Set(this.d.store.list<User>("users", (u) => u.role === "seller" && pauseActive(u.pause, ctx.now)).map((u) => u.id));
    const listings = this.d.store.list<Listing>("listings", (l) => l.status === "active" && l.sellerId !== buyer.id && !paused.has(l.sellerId));
    const sellerTrust: Record<string, Trust> = {};
    const sellerShops = new Set<string>();
    for (const l of listings) {
      sellerTrust[l.sellerId] ??= this.trust(l.sellerId, "seller");
      if (this.d.store.get<User>("users", l.sellerId)?.shop) sellerShops.add(l.sellerId);
    }
    return evaluate({
      ctx,
      vehicle: buyer.vehicle ?? vehicleByModel("아이오닉 5")!,
      listings,
      interests: this.interests(buyer),
      settings: buyer.settings ?? DEFAULT_GO_SETTING,
      multipliers: buyer.personalization?.multipliers ?? {},
      sellerTrust,
      sellerShops,
      router: this.d.router,
      baseRoute: s?.baseRoute ?? null,
      currentAlongM: s?.currentAlongM ?? 0,
      dismissed: s?.dismissed,
      config: this.cfg.match,
      ignoreWindow,
    });
  }

  /**
   * 차에 보내는 매물 보기. 수락 전이라 정확한 지점에서 잰 값(갈림 지점 위치·현재→매물 거리)은 보내지 않는다(T18).
   * 목록에 쓰는 거리는 공개 범위(대략 위치) 중심으로만 재고 100m 단위로 자른다.
   */
  candidateView(c: Candidate, s: DriveSession | null = null, here: LatLng | null = null) {
    const l = this.d.store.get<Listing>("listings", c.listingId);
    const seller = this.trustSummary(c.sellerId, "seller");
    let aheadM: number | null = null;
    if (s) {
      const pr = projectOnPolyline(s.baseRoute.line, c.approxArea, 0);
      if (pr) aheadM = Math.max(0, Math.round((pr.alongM - s.currentAlongM) / 100) * 100);
    }
    return {
      listingId: c.listingId,
      title: c.title,
      category: c.category,
      categoryLabel: c.categoryLabel,
      description: l?.description ?? "",
      photo: l?.photos[0] ?? null,
      condition: l?.condition ?? null,
      brief: l ? this.briefOf(l.id) : null,
      price: c.price,
      referencePrice: c.referencePrice,
      fragile: c.fragile,
      approxArea: c.approxArea,
      goLevel: c.goLevel,
      interestType: c.interestType,
      detourMin: c.detourMin,
      detourMaxMin: c.detourMaxMin,
      handover: { expectedMin: Math.round(c.handover.expectedS / 60), big: c.handover.big, source: c.handover.source },
      pickupAccess: c.pickupAccess,
      detourS: c.detourS,
      timeToBranchS: c.timeToBranchS === null ? null : Math.round(c.timeToBranchS / 10) * 10,
      aheadM,
      fromHereM: here ? Math.round(haversineM(here, c.approxArea) / 100) * 100 : null,
      etaAtListing: c.etaAtListing,
      available: c.available,
      fit: c.fit,
      energy: c.energy,
      exclusions: c.exclusions,
      inWindow: c.inWindow,
      score: c.score,
      speech: c.speech,
      seller: { completed: seller.completed, rating: seller.rating, shop: c.shop },
    };
  }

  activeTradeOf(buyerId: string): Trade | undefined {
    return this.d.store.list<Trade>("trades", (t) => t.buyerId === buyerId && ACTIVE_STATUSES.includes(t.status))[0];
  }

  /** 출발 전 브리핑(T16): 이번 경로 위 관심 매물 전부와 제외 이유 */
  briefing(buyer: User, ctx: DriveContextInput) {
    this.requireRole(buyer, "buyer");
    const s = this.sessionFor(buyer, ctx);
    const ev = this.evalFor(buyer, ctx, s, true);
    this.countShown(s, ev.candidates);
    return {
      mode: ev.mode,
      route: s ? { distanceM: Math.round(s.baseRoute.distanceM), durationS: Math.round(s.baseRoute.durationS), viaNames: s.baseRoute.viaNames } : null,
      items: ev.candidates.map((c) => this.candidateView(c, s, ctx.location)),
      block: this.blockFor(buyer, ctx.now),
    };
  }

  /** 대화로 고르기(T34): 지금 맥락으로 후보를 다시 계산해 사실표를 만들고, AI(있으면) 또는 규칙 조수가 답한다 */
  async assistFor(buyer: User, ctx: DriveContextInput, q: { question: string; focusId?: string | null; alert?: { kind: "single" | "contention"; listingIds: string[] } | null; driving?: boolean; quick?: boolean }): Promise<AssistResult> {
    this.requireRole(buyer, "buyer");
    const question = (q.question ?? "").trim().slice(0, 200);
    const s = this.sessionFor(buyer, ctx);
    const ev = this.evalFor(buyer, ctx, s, true);
    const facts: AssistFact[] = ev.candidates.map((c) => {
      const v = this.candidateView(c, s, ctx.location);
      return {
        listingId: v.listingId,
        categoryLabel: v.categoryLabel,
        title: v.title,
        price: v.price,
        referencePrice: v.referencePrice,
        detourMin: v.detourMin,
        detourMaxMin: v.detourMaxMin,
        pickupAccess: v.pickupAccess,
        fit: v.fit,
        energy: { ok: v.energy.ok, arrivalSocPct: v.energy.arrivalSocPct, rangeAfterKm: v.energy.rangeAfterKm },
        condition: v.condition,
        brief: v.brief ? { summary: v.brief.summary, findings: v.brief.condition.findings, photoChecked: v.brief.condition.photoChecked, grade: v.brief.condition.grade } : null,
        seller: v.seller,
        goLevel: v.goLevel,
        aheadM: v.aheadM,
        score: v.score,
        exclusions: v.exclusions as AssistFact["exclusions"],
      };
    });
    const alert = q.alert && Array.isArray(q.alert.listingIds) ? { kind: q.alert.kind === "contention" ? ("contention" as const) : ("single" as const), listingIds: q.alert.listingIds.filter((x) => typeof x === "string") } : null;
    const input = { question, facts, focusId: q.focusId ?? null, alert, driving: !!q.driving };
    if (this.d.assistAI && question) {
      // quick(Gleo 경로): Gleo가 7초 뒤 취소하므로 AI를 짧게만 기다리고 규칙 조수로 간다. 엔진이 시간을 안 지켜도 여기서 끊는다
      const quickMs = q.quick ? (this.d.assistQuickMs ?? 3000) : null;
      const ai = this.d.assistAI.assist(input, quickMs ? { timeoutMs: quickMs } : undefined).catch(() => null);
      const r = quickMs ? await Promise.race([ai, sleep(quickMs).then(() => null)]) : await ai;
      if (r) return r;
    }
    return assist(input);
  }

  /** 주행 중 맥락 갱신 → 알릴 매물(T1~T7). 지나친 알림은 개인화(T14), 지나친 요청은 만료(T9) */
  driveContext(buyer: User, ctx: DriveContextInput) {
    this.requireRole(buyer, "buyer");
    const now = ctx.now;
    const s = this.sessionFor(buyer, ctx);
    const notices: { type: string; text: string; listingId?: string }[] = [];

    if (s) {
      const corridor = this.cfg.match.corridorM ?? 2500;
      // 알림을 받고 들르지 않은 채 지나간 매물 → 개인화 신호
      for (const [listingId, a] of s.alerted) {
        if (s.requested.has(listingId) || s.skipped.has(listingId)) continue;
        const l = this.d.store.get<Listing>("listings", listingId);
        if (!l) continue;
        const proj = projectOnPolyline(s.baseRoute.line, l.pickupPoint, 0);
        if (!proj || proj.distM > corridor || proj.alongM < s.currentAlongM - 50) {
          s.skipped.add(listingId);
          const u = this.user(buyer.id);
          const r = recordSkip(u.personalization ?? emptyPersonalization(), a.category, kstParts(now).dayKey);
          this.d.store.put("users", { ...u, personalization: r.state });
          const note = personalizationNote(a.category, categoryLabel(a.category), r.state);
          if (note) notices.push({ type: "personalization", text: note, listingId });
        }
      }
      // 응답 대기 중인 요청인데 우회 지점을 지났으면 만료
      for (const t of this.d.store.list<Trade>("trades", (x) => x.buyerId === buyer.id && x.status === "requested")) {
        const l = this.d.store.get<Listing>("listings", t.listingId);
        if (!l) continue;
        const proj = projectOnPolyline(s.baseRoute.line, l.pickupPoint, 0);
        if (!proj || proj.alongM < s.currentAlongM - 50) {
          this.applyEvent(t, { type: "EXPIRE", reason: "우회 지점을 지났어요" }, now);
          notices.push({ type: "expired", text: `${categoryLabel(t.category)} 요청은 우회 지점을 지나 끝났어요`, listingId: t.listingId });
        }
      }
    }

    const ev = this.evalFor(buyer, ctx, s, false);
    this.countShown(s, ev.candidates);
    const active = this.activeTradeOf(buyer.id);
    // 요청할 수 없는 상태(결제 수단 없음·요청 제한)면 알리지 않는다 — 들를 수 없는 걸 묻지 않게
    const block = this.blockFor(buyer, now);
    const quiet = !!active || !!block;
    const fresh = (c: Candidate | null) => (c && !s?.alerted.has(c.listingId) ? c : null);
    let top = quiet ? null : fresh(ev.top);
    let contention = quiet || !ev.contention ? null : ev.contention.every((c) => !s?.alerted.has(c.listingId)) ? ev.contention : null;
    if (!top && contention) top = contention[0];
    if (top && contention && !contention.some((c) => c.listingId === top!.listingId)) contention = null;
    for (const n of s?.notices.splice(0) ?? []) notices.push(n);
    return {
      mode: ev.mode,
      now,
      alongM: Math.round(s?.currentAlongM ?? 0),
      route: s ? { distanceM: Math.round(s.baseRoute.distanceM), durationS: Math.round(s.baseRoute.durationS), viaNames: s.baseRoute.viaNames } : null,
      top: top ? this.candidateView(top, s, ctx.location) : null,
      contention: contention ? contention.map((c) => this.candidateView(c, s, ctx.location)) : null,
      watching: ev.candidates.filter((c) => c.exclusions.length === 0).length,
      candidates: ev.candidates.map((c) => this.candidateView(c, s, ctx.location)),
      activeTrade: active ? this.buyerTradeView(active) : null,
      block,
      notices,
    };
  }

  /** 차가 실제로 알림을 띄웠다고 알려 준다 — 다시 알리지 않고, 지나치면 개인화 신호 */
  markAlerted(buyer: User, listingIds: string[]) {
    const s = this.drives.get(buyer.id);
    if (!s) return;
    for (const id of listingIds) {
      const l = this.d.store.get<Listing>("listings", id);
      if (l && !s.alerted.has(id)) {
        s.alerted.set(id, { at: this.now(), category: l.category });
        this.bumpListingStat(id, "alerted");
      }
    }
  }

  /** 판매자 노출 수(T29): 들를 수 있는 추천으로 든 매물을 주행마다 한 번 센다. 누가 봤는지는 남기지 않는다 */
  private countShown(s: DriveSession | null, candidates: Candidate[]) {
    if (!s) return;
    for (const c of candidates) {
      if (c.exclusions.length || s.shown.has(c.listingId)) continue;
      s.shown.add(c.listingId);
      this.bumpListingStat(c.listingId, "shown");
    }
  }

  private bumpListingStat(id: string, k: "shown" | "alerted") {
    const l = this.d.store.get<Listing>("listings", id);
    if (!l) return;
    const stats = { shown: l.stats?.shown ?? 0, alerted: l.stats?.alerted ?? 0 };
    stats[k] += 1;
    this.d.store.put("listings", { ...l, stats });
  }

  /** "아니요" — 이번 주행에서는 다시 알리지 않는다 (지나치면 개인화 신호) */
  dismiss(buyer: User, listingId: string) {
    const s = this.drives.get(buyer.id);
    if (!s) return;
    s.dismissed.add(listingId);
    this.markAlerted(buyer, [listingId]);
  }

  /** "들를게요" → 판매자에게 요청(T9). 자동 수락 시간대면 바로 확정(T10) */
  request(buyer: User, ctx: DriveContextInput, listingId: string, source: "drive" | "briefing") {
    this.requireRole(buyer, "buyer");
    const l = this.d.store.get<Listing>("listings", listingId);
    if (!l || l.status !== "active") throw new ApiError(409, "listing_unavailable", "이미 거래 중이거나 내려간 매물이에요");
    if (l.sellerId === buyer.id) throw new ApiError(409, "own_listing", "내 매물이에요");
    if (this.sellerPaused(l.sellerId, ctx.now)) throw new ApiError(409, "seller_paused", "판매자가 지금은 요청을 받지 않아요");
    if (this.activeTradeOf(buyer.id)) throw new ApiError(409, "trade_in_progress", "진행 중인 거래가 끝나면 다음 매물을 요청할 수 있어요");
    const block = this.blockFor(buyer, ctx.now);
    if (block) throw new ApiError(409, block.reason === "payment" ? "payment_required" : "request_limited", block.text);
    const s = this.sessionFor(buyer, ctx);
    const ev = this.evalFor(buyer, ctx, s, true);
    const c = ev.candidates.find((x) => x.listingId === listingId);
    if (!c) throw new ApiError(409, "not_on_route", "이번 경로에서 들를 수 없는 매물이에요");
    const blocking = c.exclusions.filter((e) => e !== "dismissed");
    if (blocking.length) throw new ApiError(409, "excluded", `들를 수 없어요: ${blocking.join(", ")}`);
    const now = ctx.now;
    const { trade, effects } = createTrade(
      {
        id: newId("t"),
        listingId,
        buyerId: buyer.id,
        sellerId: l.sellerId,
        title: l.title,
        category: l.category,
        price: l.price,
        source,
        now,
        timeToBranchS: c.timeToBranchS,
        branchAlongM: c.branchAlongM,
        etaAt: c.etaAtListing,
        detourMin: c.detourMin,
        fitLabel: c.fit.label,
        vehicleModel: buyer.vehicle?.model ?? "",
        listingAutoAccept: l.autoAccept,
        fragile: l.fragile,
      },
      this.cfg.trade,
    );
    this.d.store.tx(() => {
      this.d.store.put("trades", trade);
      this.applyEffects(trade, effects, now);
    });
    if (s) {
      s.requested.add(listingId);
      s.alerted.set(listingId, { at: now, category: l.category });
    }
    let t = trade;
    if (l.autoAccept && isAvailableAt(l.availability, now)) t = this.applyEvent(trade, { type: "AUTO_ACCEPT" }, now);
    return this.buyerTradeView(t);
  }

  /** 주행 끝 — 결과 카드 */
  endDrive(buyer: User, body: { odometerDeltaKm?: number | null; now?: number }) {
    const s = this.drives.get(buyer.id);
    const now = body.now ?? this.now();
    const trades = this.d.store.list<Trade>(
      "trades",
      (t) => t.buyerId === buyer.id && (t.completedAt ?? 0) >= (s?.startedAt ?? now - 6 * 3600_000),
    );
    const items = trades.map((t) => {
      const l = this.d.store.get<Listing>("listings", t.listingId);
      let separateTripMin: number | null = null;
      if (l && s) {
        const r = this.d.router.route([s.dest, l.pickupPoint, s.dest]);
        if (r) separateTripMin = Math.round(r.durationS / 60) + 3;
      }
      return { tradeId: t.id, title: t.title, categoryLabel: categoryLabel(t.category), price: t.price, detourMin: t.detourMin, separateTripMin };
    });
    const actualS = s ? (now - s.startedAt) / 1000 : null;
    const addedMin = s && actualS !== null ? Math.max(0, Math.round((actualS - s.originalDurationS) / 60)) : null;
    const extraKm =
      s && body.odometerDeltaKm != null ? Math.max(0, Math.round((body.odometerDeltaKm - s.originalDistanceM / 1000) * 10) / 10) : null;
    const u = this.user(buyer.id);
    const notes = items.map((i) => personalizationNote(trades.find((t) => t.id === i.tradeId)!.category, i.categoryLabel, u.personalization ?? emptyPersonalization())).filter(Boolean);
    const skippedNotes = s
      ? [...s.skipped]
          .map((id) => this.d.store.get<Listing>("listings", id))
          .filter((l): l is Listing => !!l)
          .map((l) => personalizationNote(l.category, categoryLabel(l.category), u.personalization ?? emptyPersonalization()))
          .filter(Boolean)
      : [];
    this.drives.delete(buyer.id);
    return {
      items,
      addedMin,
      extraKm,
      odometerDeltaKm: body.odometerDeltaKm ?? null,
      originalMin: s ? Math.round(s.originalDurationS / 60) : null,
      actualMin: actualS !== null ? Math.round(actualS / 60) : null,
      notes: [...new Set([...notes, ...skippedNotes])] as string[],
    };
  }

  // ───────────────────────── 거래 (T9~T13) ─────────────────────────

  trade(id: string): Trade {
    const t = this.d.store.get<Trade>("trades", id);
    if (!t) throw new ApiError(404, "trade_not_found", "거래를 찾을 수 없어요");
    return t;
  }

  buyerTradeEvent(buyer: User, id: string, ev: TradeEvent) {
    const t = this.trade(id);
    if (t.buyerId !== buyer.id) throw new ApiError(404, "trade_not_found", "거래를 찾을 수 없어요");
    const allowed = ["WAYPOINT_CONFIRMED", "ETA", "ARRIVED", "BUYER_RECEIVED", "BUYER_DECLINE_MISMATCH", "BUYER_CANCEL", "BUYER_NUDGE", "BUYER_REPORT_SELLER_ABSENT", "BUYER_EVIDENCE", "RATE"];
    if (!allowed.includes(ev.type)) throw new ApiError(403, "forbidden", "구매자가 할 수 없는 동작이에요");
    if (ev.type === "RATE") ev = { ...ev, by: "buyer" };
    if (ev.type === "BUYER_EVIDENCE") {
      const photos = (ev.photos ?? []).filter((x) => typeof x === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(x) && x.length < 400_000).slice(0, 3);
      if (!photos.length) throw new ApiError(422, "photo_required", "사진을 골라 주세요 (JPEG·PNG, 장당 300KB 이하)");
      ev = { type: "BUYER_EVIDENCE", photos };
    }
    return this.buyerTradeView(this.applyEvent(t, ev, this.now()));
  }

  sellerTradeEvent(seller: User, id: string, ev: TradeEvent) {
    const t = this.trade(id);
    if (t.sellerId !== seller.id) throw new ApiError(404, "trade_not_found", "거래를 찾을 수 없어요");
    const allowed = ["SELLER_ACCEPT", "SELLER_DECLINE", "SELLER_HANDED", "SELLER_CANCEL", "SELLER_COMING", "RATE"];
    if (!allowed.includes(ev.type)) throw new ApiError(403, "forbidden", "판매자가 할 수 없는 동작이에요");
    if (ev.type === "RATE") ev = { ...ev, by: "seller" };
    const next = this.applyEvent(t, ev, this.now());
    // 요청을 수락했다는 건 물건이 아직 있다는 확인(T37)
    if (ev.type === "SELLER_ACCEPT") {
      const l = this.d.store.get<Listing>("listings", t.listingId);
      if (l) this.d.store.put("listings", { ...l, confirmedAt: this.now() });
    }
    return this.sellerTradeView(next);
  }

  applyEvent(t: Trade, ev: TradeEvent, now: number): Trade {
    try {
      return this.d.store.tx(() => {
        const r = applyTradeEvent(t, ev, now, this.cfg.trade);
        this.d.store.put("trades", r.trade);
        this.applyEffects(r.trade, r.effects, now);
        return r.trade;
      });
    } catch (e) {
      if (e instanceof TradeError) throw new ApiError(409, e.code, e.message);
      throw e;
    }
  }

  /** 시스템 시계: 만료·노쇼·자동 확인·정산 */
  tick(now = this.now()): number {
    let changed = 0;
    for (const t of this.d.store.list<Trade>("trades", (x) => ["requested", "accepted", "arrived", "completed"].includes(x.status))) {
      const r = applyTradeEvent(t, { type: "TICK" }, now, this.cfg.trade);
      if (r.trade !== t && JSON.stringify(r.trade) !== JSON.stringify(t)) {
        this.d.store.tx(() => {
          this.d.store.put("trades", r.trade);
          this.applyEffects(r.trade, r.effects, now);
        });
        changed++;
      }
    }
    return changed;
  }

  private applyEffects(t: Trade, effects: Effect[], now: number) {
    for (const e of effects) {
      switch (e.kind) {
        case "trust": {
          const userId = e.who === "buyer" ? t.buyerId : t.sellerId;
          this.bumpTrust(userId, e.who, (x) => {
            x[e.field] += 1;
          });
          break;
        }
        case "rating": {
          const userId = e.who === "buyer" ? t.buyerId : t.sellerId;
          this.bumpTrust(userId, e.who, (x) => {
            x.ratingSum += e.stars;
            x.ratingCount += 1;
          });
          break;
        }
        case "handover": {
          // 거래 시간 학습(T36): 다음 추천의 우회 시간에 이 판매자의 실제 기록을 섞는다
          this.bumpTrust(e.sellerId, "seller", (x) => {
            x.handoverSumS = (x.handoverSumS ?? 0) + e.seconds;
            x.handoverCount = (x.handoverCount ?? 0) + 1;
          });
          break;
        }
        case "payment":
          this.d.store.put<LedgerEntry>("ledger", { id: newId("p"), tradeId: t.id, sellerId: t.sellerId, buyerId: t.buyerId, action: e.action, amount: e.amount, at: now });
          break;
        case "listing": {
          const l = this.d.store.get<Listing>("listings", t.listingId);
          if (l) this.d.store.put("listings", { ...l, status: e.status });
          break;
        }
        case "personalization_trade": {
          const u = this.d.store.get<User>("users", t.buyerId);
          if (u) this.d.store.put("users", { ...u, personalization: recordTrade(u.personalization ?? emptyPersonalization(), e.category) });
          break;
        }
        case "notify":
          this.notify(t, e.to, e.type, e.data ?? {}, now);
          break;
      }
    }
  }

  private notify(t: Trade, to: "buyer" | "seller", type: string, data: Record<string, unknown>, now: number) {
    const userId = to === "buyer" ? t.buyerId : t.sellerId;
    const { title, body } = messageFor(t, to, type, data);
    const ev: AppEvent = {
      id: newId("e"),
      userId,
      type,
      at: now,
      tradeId: t.id,
      title,
      body,
      data: { ...data, trade: to === "buyer" ? this.buyerTradeView(t) : this.sellerTradeView(t) },
    };
    this.d.store.put("events", ev);
    this.d.bus.publish(ev);
    // 판매자는 페이지를 닫아 둘 수 있어 웹 푸시로도 보낸다(T24)
    if (to === "seller" && this.d.push) void this.sendPush(userId, { title, body, tag: `jhgo-${t.id}`, url: "/seller/", urgent: type === "request.new" || type === "trade.come_out" || type === "trade.arrived" || type === "trade.waiting" });
  }

  // ───────────────────────── 웹 푸시 (T24) ─────────────────────────

  pushKey(): string | null {
    return this.d.push?.publicKey() ?? null;
  }

  subscribePush(user: User, sub: unknown) {
    if (!this.d.push) throw new ApiError(404, "push_unavailable", "이 서버는 웹 푸시를 쓰지 않아요");
    if (!isPushSubscription(sub)) throw new ApiError(422, "bad_subscription", "알림 구독 정보가 잘못됐어요");
    const id = pushId(sub.endpoint);
    this.d.store.put<PushDoc>("push", { id, userId: user.id, sub, createdAt: this.now() });
    return { ok: true, count: this.d.store.list<PushDoc>("push", (p) => p.userId === user.id).length };
  }

  unsubscribePush(user: User, endpoint: string) {
    const id = pushId(endpoint);
    const p = this.d.store.get<PushDoc>("push", id);
    if (p && p.userId === user.id) this.d.store.remove("push", id);
    return { ok: true };
  }

  pushCount(user: User): number {
    return this.d.store.list<PushDoc>("push", (p) => p.userId === user.id).length;
  }

  private async sendPush(userId: string, payload: { title: string; body: string; tag: string; url: string; urgent?: boolean }) {
    const push = this.d.push;
    if (!push) return;
    for (const p of this.d.store.list<PushDoc>("push", (x) => x.userId === userId)) {
      const r = await push.send(p.sub, payload);
      if (r === "gone") this.d.store.remove("push", p.id);
    }
  }

  /** 화면에 보여 줄 거래 시간 설정(분) */
  tradeConfigView() {
    const m = (ms: number) => Math.round(ms / 60000);
    return {
      sellerWaitMin: m(this.cfg.trade.sellerWaitMs),
      autoConfirmMin: m(this.cfg.trade.autoConfirmMs),
      settleAfterMin: m(this.cfg.trade.settleAfterMs),
      comeOutBeforeMin: Math.round(this.cfg.trade.comeOutBeforeS / 60),
      noShowGraceMin: m(this.cfg.trade.noShowGraceMs),
    };
  }

  events(user: User, since = 0): AppEvent[] {
    return this.d.store
      .list<AppEvent>("events", (e) => e.userId === user.id && e.at > since)
      .sort((a, b) => a.at - b.at)
      .slice(-100);
  }

  // ───────────────────────── 보기 (권한별 정보 노출) ─────────────────────────

  buyerTradeView(t: Trade) {
    const l = this.d.store.get<Listing>("listings", t.listingId);
    const seller = this.d.store.get<User>("users", t.sellerId);
    const revealed = ["accepted", "arrived", "completed", "settled"].includes(t.status);
    return {
      ...t,
      sellerWaitUntil: t.status === "arrived" && t.arrivedAt ? sellerAbsentAllowedAt(t, this.cfg.trade) : null,
      pickupPoint: revealed && l ? l.pickupPoint : null,
      approxArea: l?.approxArea ?? null,
      sizeCm: l?.sizeCm ?? null,
      condition: l?.condition ?? null,
      photos: l?.photos ?? [],
      seller: seller ? { name: maskName(seller.name), ...pickTrust(this.trustSummary(seller.id, "seller")) } : null,
    };
  }

  sellerTradeView(t: Trade) {
    const l = this.d.store.get<Listing>("listings", t.listingId);
    const buyer = this.d.store.get<User>("users", t.buyerId);
    return {
      ...t,
      pickupPoint: l?.pickupPoint ?? null,
      photos: l?.photos ?? [],
      buyer: buyer ? { name: maskName(buyer.name), vehicleModel: t.vehicleModel, ...pickTrust(this.trustSummary(buyer.id, "buyer")) } : null,
    };
  }

  buyerListingView(l: Listing): BuyerListingView {
    const { pickupPoint: _p, ...rest } = l;
    void _p;
    return rest;
  }

  sellerTrades(seller: User) {
    return this.d.store
      .list<Trade>("trades", (t) => t.sellerId === seller.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((t) => this.sellerTradeView(t));
  }

  buyerTrades(buyer: User) {
    return this.d.store
      .list<Trade>("trades", (t) => t.buyerId === buyer.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((t) => this.buyerTradeView(t));
  }

  sellerSummary(seller: User) {
    const ledger = this.d.store.list<LedgerEntry>("ledger", (e) => e.sellerId === seller.id).sort((a, b) => b.at - a.at);
    const trades = this.d.store.list<Trade>("trades", (t) => t.sellerId === seller.id);
    const sum = (f: (t: Trade) => boolean) => trades.filter(f).reduce((a, t) => a + t.price, 0);
    return {
      held: sum((t) => t.payment.status === "held"),
      settled: sum((t) => t.payment.status === "captured"),
      refunded: sum((t) => t.payment.status === "refunded"),
      nextSettleAt: trades.filter((t) => t.status === "completed").map((t) => t.settleAt ?? 0).sort()[0] ?? null,
      ledger: ledger.slice(0, 30).map((e) => ({ ...e, title: trades.find((t) => t.id === e.tradeId)?.title ?? "" })),
      trust: this.trustSummary(seller.id, "seller"),
    };
  }

  private requireRole(u: User, role: "buyer" | "seller") {
    if (u.role !== role) throw new ApiError(403, "forbidden", role === "buyer" ? "구매자(차량) 계정이 필요해요" : "판매자 계정이 필요해요");
  }
}

/** 구독 주소를 저장 키로(짧게) */
function pushId(endpoint: string): string {
  let h = 2166136261;
  for (let i = 0; i < endpoint.length; i++) h = Math.imul(h ^ endpoint.charCodeAt(i), 16777619);
  return `push_${(h >>> 0).toString(36)}_${endpoint.length}`;
}

function pickTrust(t: ReturnType<Service["trustSummary"]>) {
  return { completed: t.completed, responseRate: t.responseRate, rating: t.rating, noShow: t.noShow, canceled: t.canceled };
}

/** 알림 문구 — 사용자에게 보이는 말은 한국어로 짧게 */
export function messageFor(t: Trade, to: "buyer" | "seller", type: string, data: Record<string, unknown>): { title: string; body: string } {
  const item = categoryLabel(t.category);
  const at = (ms: unknown) => (typeof ms === "number" ? kstClock(ms) : "");
  const minutesLeft = (ms: unknown, now: number) => (typeof ms === "number" ? Math.max(1, Math.round((ms - now) / 60000)) : null);
  switch (type) {
    case "request.new": {
      const m = minutesLeft(t.etaAt, t.createdAt);
      return { title: `${item} 사러 오는 차가 있어요`, body: `${m}분 뒤(${at(t.etaAt)}) 도착 예정 · ${t.vehicleModel} · ${t.fitLabel}. 수락하면 대금 ${wonText(t.price)}이 바로 보관돼요.` };
    }
    case "trade.accepted":
      return to === "buyer"
        ? { title: data.auto ? "바로 확정됐어요" : "판매자가 수락했어요", body: `${item} 대금은 보관됐어요. 경유지를 추가할게요.` }
        : { title: data.auto ? "자동 수락했어요" : "수락했어요", body: `대금 ${wonText(t.price)}이 보관됐어요. 도착 예정 ${at(t.etaAt)}` };
    case "trade.declined":
      return { title: "이번엔 어렵대요", body: `${item} 판매자가 지금은 거래가 어렵다고 했어요.` };
    case "trade.expired":
      return { title: "요청이 끝났어요", body: (data.reason as string) ?? "응답 시간이 지났어요." };
    case "trade.on_the_way":
      return { title: "구매자가 오는 중이에요", body: `${at(t.etaAt)} 도착 예정이에요.` };
    case "trade.eta":
      return { title: `도착 예정 ${at(data.etaAt)}`, body: `약 ${Math.max(1, Math.round(Number(data.remainS ?? 0) / 60))}분 남았어요.` };
    case "trade.come_out":
      return { title: "곧 도착해요", body: `${at(data.etaAt)} 도착 예정이에요. 물건을 들고 나와 주세요.` };
    case "trade.arrived":
      return { title: "구매자가 도착했어요", body: "거래 지점에 도착했어요. 물건을 건네 주세요." };
    case "trade.handed":
      return { title: "판매자가 건넸어요", body: "물건을 확인하고 '받았어요'를 눌러 주세요." };
    case "trade.received":
      return to === "seller"
        ? { title: "구매자가 받았어요", body: `${at(data.settleAt)}에 ${wonText(t.price)}이 정산돼요.` }
        : { title: "거래 완료", body: `이의가 있으면 ${at(data.settleAt)}까지 알려 주세요.` };
    case "trade.mismatch":
      return { title: "구매자가 현장에서 거절했어요", body: `사유: ${data.reason as string}. 대금은 구매자에게 환불돼요.` };
    case "trade.refunded":
      return { title: "전액 환불됐어요", body: `${item} 대금 ${wonText(t.price)}을 돌려드렸어요.` };
    case "trade.canceled":
      if (data.by === "seller") return { title: "판매자가 취소했어요", body: `경유지를 해제할게요. 대금은 환불돼요.${data.reason ? ` (${data.reason as string})` : ""}` };
      if (data.system) return { title: "구매자 차 사정으로 취소됐어요", body: `구매자 차의 내비가 경로를 바꾸지 못했어요. ${item}은 다시 판매 중이에요.` };
      return { title: "구매자가 취소했어요", body: `${item} 거래가 취소됐어요.${data.reason ? ` (${data.reason as string})` : ""}` };
    case "trade.seller_coming":
      return { title: "판매자가 나오고 있어요", body: `${josa(item, "을/를")} 들고 나오는 중이에요.` };
    case "trade.waiting":
      return { title: "구매자가 기다리고 있어요", body: "거래 지점에 도착해 기다리는 중이에요. 물건을 들고 나와 주세요." };
    case "trade.seller_no_show":
      return { title: "구매자를 만나지 못해 거래가 끝났어요", body: `구매자가 도착해 기다렸지만 만나지 못했어요. 대금은 구매자에게 환불되고 판매자 신뢰도에 반영돼요. ${item}은 다시 판매 중이에요.` };
    case "trade.evidence":
      return { title: "구매자가 현장 사진을 남겼어요", body: "지난 거래에서 사진을 볼 수 있어요." };
    case "trade.no_show":
      return to === "seller"
        ? { title: "구매자가 오지 않았어요", body: "거래가 끝났고 매물은 다시 판매 중이에요." }
        : { title: "도착하지 않아 취소됐어요", body: "대금은 환불됐어요." };
    case "trade.settled":
      return to === "seller" ? { title: "정산됐어요", body: `${wonText(t.price)}이 정산됐어요.` } : { title: "정산까지 끝났어요", body: `${item} 거래가 마무리됐어요.` };
    default:
      return { title: type, body: "" };
  }
}
