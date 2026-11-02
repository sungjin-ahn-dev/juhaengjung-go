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
  categoryDef,
  categoryLabel,
  createTrade,
  DEFAULT_GO_SETTING,
  DEFAULT_TRADE_CONFIG,
  emptyPersonalization,
  emptyTrust,
  evaluate,
  isAvailableAt,
  kstClock,
  kstParts,
  needsMeasuredSize,
  personalizationNote,
  projectOnPolyline,
  recordSkip,
  recordTrade,
  referencePrice,
  responseRate,
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
  type Route,
  type RoutingProvider,
  type SizeCm,
  type Trade,
  type TradeConfig,
  type TradeEvent,
  type Trust,
  type VehicleProfile,
} from "@jhgo/core";
import { maskName, newId, newToken, type AppEvent, type Clock, type EventBus, type Store } from "./infra.ts";

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
  sizeSource: "ai" | "seller_measured";
  photos?: string[];
  pickupPoint: { lat: number; lng: number; label: string };
  availability?: Availability[];
  autoAccept?: boolean;
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
      sizeSource: i.sizeSource,
      photos,
      approxArea: approxArea(p, id),
      pickupPoint: { lat: p.lat, lng: p.lng, label: p.label.slice(0, 40) },
      availability,
      autoAccept: !!i.autoAccept,
      status: "active",
      createdAt: this.now(),
    };
    this.d.store.put("listings", listing);
    return listing;
  }

  updateListing(seller: User, id: string, patch: Partial<Pick<Listing, "status" | "autoAccept" | "availability" | "price">>): Listing {
    const l = this.d.store.get<Listing>("listings", id);
    if (!l || l.sellerId !== seller.id) throw new ApiError(404, "listing_not_found", "매물을 찾을 수 없어요");
    const busy = this.d.store.list<Trade>("trades", (t) => t.listingId === id && ACTIVE_STATUSES.includes(t.status)).length > 0;
    if (patch.status && busy && patch.status !== "reserved") throw new ApiError(409, "listing_busy", "진행 중인 거래가 있어 지금은 바꿀 수 없어요");
    const next: Listing = { ...l };
    if (patch.status && ["active", "sold", "hidden"].includes(patch.status)) next.status = patch.status;
    if (patch.autoAccept !== undefined) next.autoAccept = !!patch.autoAccept;
    if (patch.availability) next.availability = patch.availability;
    if (patch.price !== undefined && Number.isFinite(patch.price) && patch.price >= 0) next.price = Math.round(patch.price);
    this.d.store.put("listings", next);
    return next;
  }

  sellerListings(seller: User): Listing[] {
    return this.d.store.list<Listing>("listings", (l) => l.sellerId === seller.id).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ───────────────────────── 구매자: 차·설정·관심사 ─────────────────────────

  setVehicle(buyer: User, v: { model: string } | VehicleProfile): VehicleProfile {
    this.requireRole(buyer, "buyer");
    const base = vehicleByModel(v.model);
    const profile: VehicleProfile | undefined = "trunk" in v && v.trunk ? (v as VehicleProfile) : base;
    if (!profile) throw new ApiError(422, "unknown_model", `${v.model}의 적재 공간 정보가 아직 없어요`);
    this.d.store.put("users", { ...buyer, vehicle: { ...profile, modelYear: (v as VehicleProfile).modelYear ?? profile.modelYear } });
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
    this.d.store.put("users", { ...buyer, settings: next });
    return next;
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
    const listings = this.d.store.list<Listing>("listings", (l) => l.status === "active" && l.sellerId !== buyer.id);
    const sellerTrust: Record<string, Trust> = {};
    for (const l of listings) sellerTrust[l.sellerId] ??= this.trust(l.sellerId, "seller");
    return evaluate({
      ctx,
      vehicle: buyer.vehicle ?? vehicleByModel("아이오닉 5")!,
      listings,
      interests: this.interests(buyer),
      settings: buyer.settings ?? DEFAULT_GO_SETTING,
      multipliers: buyer.personalization?.multipliers ?? {},
      sellerTrust,
      router: this.d.router,
      baseRoute: s?.baseRoute ?? null,
      currentAlongM: s?.currentAlongM ?? 0,
      dismissed: s?.dismissed,
      config: this.cfg.match,
      ignoreWindow,
    });
  }

  candidateView(c: Candidate) {
    return {
      listingId: c.listingId,
      title: c.title,
      category: c.category,
      categoryLabel: c.categoryLabel,
      price: c.price,
      referencePrice: c.referencePrice,
      fragile: c.fragile,
      approxArea: c.approxArea,
      goLevel: c.goLevel,
      interestType: c.interestType,
      detourMin: c.detourMin,
      detourS: c.detourS,
      tCurToListingS: c.tCurToListingS,
      distCurToListingM: c.distCurToListingM,
      timeToBranchS: c.timeToBranchS,
      branchAlongM: c.branchAlongM,
      etaAtListing: c.etaAtListing,
      fit: c.fit,
      energy: c.energy,
      exclusions: c.exclusions,
      inWindow: c.inWindow,
      score: c.score,
      parts: c.parts,
      speech: c.speech,
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
    return {
      mode: ev.mode,
      route: s ? { distanceM: Math.round(s.baseRoute.distanceM), durationS: Math.round(s.baseRoute.durationS), viaNames: s.baseRoute.viaNames } : null,
      items: ev.candidates.map((c) => ({ ...this.candidateView(c), photo: this.d.store.get<Listing>("listings", c.listingId)?.photos[0] ?? null })),
    };
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
    const active = this.activeTradeOf(buyer.id);
    const fresh = (c: Candidate | null) => (c && !s?.alerted.has(c.listingId) ? c : null);
    let top = active ? null : fresh(ev.top);
    let contention = active || !ev.contention ? null : ev.contention.every((c) => !s?.alerted.has(c.listingId)) ? ev.contention : null;
    if (!top && contention) top = contention[0];
    if (top && contention && !contention.some((c) => c.listingId === top!.listingId)) contention = null;
    for (const n of s?.notices.splice(0) ?? []) notices.push(n);
    return {
      mode: ev.mode,
      now,
      alongM: Math.round(s?.currentAlongM ?? 0),
      route: s ? { distanceM: Math.round(s.baseRoute.distanceM), durationS: Math.round(s.baseRoute.durationS), viaNames: s.baseRoute.viaNames } : null,
      top: top ? this.candidateView(top) : null,
      contention: contention ? contention.map((c) => this.candidateView(c)) : null,
      watching: ev.candidates.filter((c) => c.exclusions.length === 0).length,
      candidates: ev.candidates.map((c) => this.candidateView(c)),
      activeTrade: active ? this.buyerTradeView(active) : null,
      notices,
    };
  }

  /** 차가 실제로 알림을 띄웠다고 알려 준다 — 다시 알리지 않고, 지나치면 개인화 신호 */
  markAlerted(buyer: User, listingIds: string[]) {
    const s = this.drives.get(buyer.id);
    if (!s) return;
    for (const id of listingIds) {
      const l = this.d.store.get<Listing>("listings", id);
      if (l && !s.alerted.has(id)) s.alerted.set(id, { at: this.now(), category: l.category });
    }
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
    if (this.activeTradeOf(buyer.id)) throw new ApiError(409, "trade_in_progress", "진행 중인 거래가 끝나면 다음 매물을 요청할 수 있어요");
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
    const allowed = ["WAYPOINT_CONFIRMED", "ETA", "ARRIVED", "BUYER_RECEIVED", "BUYER_DECLINE_MISMATCH", "BUYER_CANCEL", "RATE"];
    if (!allowed.includes(ev.type)) throw new ApiError(403, "forbidden", "구매자가 할 수 없는 동작이에요");
    if (ev.type === "RATE") ev = { ...ev, by: "buyer" };
    return this.buyerTradeView(this.applyEvent(t, ev, this.now()));
  }

  sellerTradeEvent(seller: User, id: string, ev: TradeEvent) {
    const t = this.trade(id);
    if (t.sellerId !== seller.id) throw new ApiError(404, "trade_not_found", "거래를 찾을 수 없어요");
    const allowed = ["SELLER_ACCEPT", "SELLER_DECLINE", "SELLER_HANDED", "SELLER_CANCEL", "RATE"];
    if (!allowed.includes(ev.type)) throw new ApiError(403, "forbidden", "판매자가 할 수 없는 동작이에요");
    if (ev.type === "RATE") ev = { ...ev, by: "seller" };
    return this.sellerTradeView(this.applyEvent(t, ev, this.now()));
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
      ledger: ledger.slice(0, 30),
      trust: this.trustSummary(seller.id, "seller"),
    };
  }

  private requireRole(u: User, role: "buyer" | "seller") {
    if (u.role !== role) throw new ApiError(403, "forbidden", role === "buyer" ? "구매자(차량) 계정이 필요해요" : "판매자 계정이 필요해요");
  }
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
      return data.by === "seller"
        ? { title: "판매자가 취소했어요", body: `경유지를 해제할게요. 대금은 환불돼요.${data.reason ? ` (${data.reason as string})` : ""}` }
        : { title: "구매자가 취소했어요", body: `${item} 거래가 취소됐어요.${data.reason ? ` (${data.reason as string})` : ""}` };
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
