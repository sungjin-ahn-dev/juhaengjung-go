/**
 * 차량 앱 두뇌 — Pleos 포트(내비·차량·주행 제한·음성)와 서버 API를 묶어 여정 10단계를 돌린다.
 *   1 모드   onNavigationStatus           6 말할 때  TBT·방향지시등·조향·제동 → AlertGate
 *   2 후보   getDestinationInfo·위치       7 약속    addWaypoint → getWaypointInfo 재조회
 *   3 우회   requestTrip                   8 만남    경유지 남은 시간 → 도착 예정, onWayPointArrived
 *   4 에너지 requestTrip 도착 배터리       9 건네기  주행 제한 해제 → 현장 확인, 트렁크 열림·닫힘
 *   5 적재   CarInfo·Seat 착석            10 마무리  Odometer, changeRouteOption(COMFORTABLE)
 */
import {
  AlertGate,
  GATE_REASON_KO,
  haversineM,
  josa,
  type DriverSignals,
  type GateReason,
  type GoLevel,
  type GoSetting,
  type Interest,
  type TripCheck,
  type VehicleProfile,
  type ListingBrief,
  type AssistResult,
} from "@jhgo/core";
import type { ApiClient, AppEvent } from "@jhgo/api";
import type { AppClock } from "./clock.ts";
import type { CarPlatform, DestinationInfo, NavigationStatus, TBTInfo, WaypointInfo } from "./pleos/ports.ts";
import { NO_WORDS, YES_WORDS } from "./pleos/voice.ts";

/** 서버가 보내는 매물 보기 — 수락 전이라 정확한 지점에서 잰 값은 없다(거리는 대략 위치 기준, 100m 단위) */
export interface CandidateView {
  listingId: string;
  title: string;
  category: string;
  categoryLabel: string;
  /** 판매자가 쓴 설명 */
  description: string;
  photo: string | null;
  condition: "good" | "fair" | "worn" | null;
  /** 물건 요약 브리핑(T33): 글 요약 + 사진에서 본 상태. 고르면 보여 주고 읽어 준다 */
  brief: ListingBrief | null;
  price: number;
  referencePrice: number;
  fragile: boolean;
  approxArea: { lat: number; lng: number; radiusM: number };
  goLevel: GoLevel;
  interestType: "keyword" | "wish";
  detourMin: number;
  /** 주차·대기가 길어질 때 — "길면 N분"(T36). detourMin과 같으면 범위 없음 */
  detourMaxMin: number;
  handover: { expectedMin: number; big: boolean; source: "rule" | "history" };
  /** 차 세우기 쉬운지(T39) — 판매자가 표시한 경우에만 */
  pickupAccess: "easy" | "hard" | null;
  detourS: number;
  timeToBranchS: number | null;
  /** 경로 매칭: 지금 위치에서 경로를 따라 몇 m 앞인지 */
  aheadM: number | null;
  /** 지금 위치에서 직선 거리 */
  fromHereM: number | null;
  etaAtListing: number;
  available: boolean;
  fit: { kind: "trunk" | "folded3" | "folded" | "none"; label: string };
  energy: { ok: boolean; arrivalSocPct?: number; rangeAfterKm?: number; note: string; unknown?: boolean };
  exclusions: string[];
  inWindow: boolean;
  score: number;
  speech: string;
  seller: { completed: number; rating: number | null; shop: boolean };
}

export interface TradeView {
  id: string;
  source: "drive" | "briefing";
  listingId: string;
  title: string;
  category: string;
  price: number;
  status: string;
  expiresAt: number;
  etaAt: number | null;
  detourMin: number;
  fitLabel: string;
  fragile: boolean;
  autoAccepted: boolean;
  handedAt?: number;
  receivedAt?: number;
  settleAt?: number;
  waypointConfirmedAt?: number;
  arrivedAt?: number;
  nudgedAt?: number;
  /** 판매자가 '지금 나가요'를 누른 시각(T28) */
  sellerComingAt?: number;
  /** 도착 뒤 이 시각이 지나면 '판매자가 안 나왔어요'로 끝낼 수 있다 */
  sellerWaitUntil?: number | null;
  ratings?: { buyerToSeller?: number; sellerToBuyer?: number };
  payment: { status: string; amount: number };
  pickupPoint: { lat: number; lng: number; label: string } | null;
  approxArea: { lat: number; lng: number; radiusM: number } | null;
  sizeCm: { w: number; d: number; h: number } | null;
  condition: string | null;
  photos: string[];
  seller: { name: string; completed: number; responseRate: number | null; rating: number | null } | null;
}

export interface EndResult {
  items: { tradeId: string; title: string; categoryLabel: string; price: number; detourMin: number; separateTripMin: number | null }[];
  addedMin: number | null;
  extraKm: number | null;
  originalMin: number | null;
  actualMin: number | null;
  notes: string[];
}

export type Screen = "map" | "interests" | "briefing" | "destination" | "inspect" | "result" | "vehicle";

export type Alert =
  | { kind: "single"; c: CandidateView; shownAt: number; listening: boolean }
  | { kind: "contention"; pair: CandidateView[]; shownAt: number; listening: boolean };

export interface CarState {
  ready: boolean;
  error: string | null;
  sse: "open" | "closed";
  me: { id: string; name: string } | null;
  vehicle: VehicleProfile | null;
  vehicleNeedsPick: boolean;
  /** 찜은 매물 제목(title)이 붙어 온다 */
  interests: (Interest & { title?: string; listingStatus?: string })[];
  settings: GoSetting | null;
  restricted: boolean;
  navStatus: NavigationStatus;
  destination: DestinationInfo | null;
  waypoints: WaypointInfo[];
  /** NaviHelper 현재 위치(실제 SDK 모드의 지도용) */
  location: { lat: number; lng: number; heading: number } | null;
  tbt: TBTInfo | null;
  soc: number | null;
  fuelRangeKm: number | null;
  row2: boolean | null;
  row3: boolean | null;
  trunkOpen: boolean | null;
  /** 요청할 수 없는 이유(결제 수단 없음·요청 제한) — 있으면 알림을 띄우지 않는다 */
  block: { reason: "payment" | "limit"; text: string; until?: number } | null;
  paymentMethod: { kind: string; label: string } | null;
  /** 결과 카드에서 남긴 판매자 평가(거래 id → 별) */
  ratings: Record<string, number>;
  signals: DriverSignals;
  gate: { ok: boolean; reasons: GateReason[] };
  mode: "route" | "region" | "idle";
  watching: number;
  candidates: CandidateView[];
  route: { distanceM: number; durationS: number; viaNames: string[] } | null;
  alert: Alert | null;
  trade: TradeView | null;
  briefing: { items: CandidateView[]; route: { distanceM: number; durationS: number; viaNames: string[] } | null } | null;
  result: EndResult | null;
  toasts: { id: number; text: string; kind: "info" | "good" | "warn" }[];
  screen: Screen;
  loadedPrompt: boolean;
  fragilePrompt: boolean;
  lastSpeech: string | null;
  /** 마지막으로 알아들은 대답(음성) — 자막에 잠깐 보여 준다 */
  heard: { word: string; at: number } | null;
  /** 펼친 매물의 사진(최대 3장) — 브리핑 카드에서만 받아 온다 */
  briefPhotos: Record<string, string[]>;
  /** 화면에서 고른 매물(목록·핀) — 조수가 "이거"를 알아듣는 기준 */
  focusId: string | null;
  /** 대화로 고르기(T34): 마지막 질문과 답 */
  chat: { q: string; a: string; at: number; source: "rule" | "ai" } | null;
  /** 마이크를 눌러 자유롭게 듣는 중 */
  talking: boolean;
  /** 마지막으로 말한 시각 — 화면 자막은 이 뒤 몇 초만 보인다 */
  speechAt: number;
  holdNote: string | null;
  muted: boolean;
}

const initialState: CarState = {
  ready: false,
  error: null,
  sse: "closed",
  me: null,
  vehicle: null,
  vehicleNeedsPick: false,
  interests: [],
  settings: null,
  restricted: false,
  navStatus: "INACTIVE",
  destination: null,
  location: null,
  waypoints: [],
  tbt: null,
  soc: null,
  fuelRangeKm: null,
  row2: null,
  row3: null,
  trunkOpen: null,
  block: null,
  paymentMethod: null,
  ratings: {},
  signals: {},
  gate: { ok: true, reasons: [] },
  mode: "idle",
  watching: 0,
  candidates: [],
  route: null,
  alert: null,
  trade: null,
  briefing: null,
  result: null,
  toasts: [],
  screen: "map",
  loadedPrompt: false,
  fragilePrompt: false,
  lastSpeech: null,
  heard: null,
  briefPhotos: {},
  focusId: null,
  chat: null,
  talking: false,
  speechAt: 0,
  holdNote: null,
  muted: false,
};

const PARKED_ONLY: Screen[] = ["interests", "briefing", "destination", "inspect", "result", "vehicle"];
const ALERT_TIMEOUT_MS = 15000;
const PICKUP_MATCH_M = 80;

export class CarController {
  state: CarState = initialState;
  private listeners = new Set<() => void>();
  private gate = new AlertGate(undefined, Date.now());
  private tripChecks: Record<string, TripCheck> = {};
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEtaPost = 0;
  private toastSeq = 0;
  private driveStartOdo: number | null = null;
  private fallbackOriginalDest: { latitude: number; longitude: number; name: string } | null = null;
  private lastHoldKey = "";
  private unsubs: (() => void)[] = [];
  private prevTrunk: boolean | null = null;

  constructor(
    readonly p: CarPlatform,
    readonly api: ApiClient,
    readonly clock: AppClock,
    readonly opts: { tickMs?: number; autoLoginName?: string; storageKey?: string } = {},
  ) {}

  // ───────── 상태 ─────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<CarState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  toast(text: string, kind: "info" | "good" | "warn" = "info") {
    const id = ++this.toastSeq;
    this.set({ toasts: [...this.state.toasts.slice(-2), { id, text, kind }] });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) }), 5200);
  }
  /** 시뮬레이터인지 실제 SDK(Android 셸)인지 */
  get platformKind() {
    return this.p.kind;
  }

  private say(text: string) {
    this.set({ lastSpeech: text, speechAt: Date.now() });
    if (!this.state.muted) void this.p.voice.speak(text);
  }
  /** 방금 한 말을 다시(정차 중 자막의 단추) */
  repeat() {
    if (this.state.lastSpeech) this.say(this.state.lastSpeech);
  }
  setMuted(m: boolean) {
    this.set({ muted: m });
    if (m) this.p.voice.stop();
  }
  /** 알림이 뜰 때 짧은 두 음(말보다 먼저 눈길을 끈다). 소리를 끄면 내지 않는다 */
  private chime() {
    if (this.state.muted || typeof window === "undefined") return;
    try {
      const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return;
      const ctx = new AC();
      const t0 = ctx.currentTime;
      for (const [f, at] of [
        [659, 0],
        [880, 0.13],
      ] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.09, t0 + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(t0 + at);
        o.stop(t0 + at + 0.25);
      }
      setTimeout(() => void ctx.close(), 600);
    } catch {
      /* 소리 못 내도 계속 */
    }
  }

  // ───────── 시작 ─────────
  async init() {
    try {
      await this.clock.sync();
      await this.login();
      await this.loadProfile();
      await this.syncVehicle();
      this.bindPlatform();
      this.unsubs.push(
        this.api.subscribe(
          (e) => void this.onEvent(e),
          (s) => {
            // 끊겼다 다시 붙으면 그 사이 놓친 거래 변화(건넸어요·취소 등)를 한 번 맞춘다. 주행 중엔 drive/context가 매 틱 맞추지만 정차 화면에서는 이게 유일하다
            const reconnected = s === "open" && this.state.sse === "closed" && this.state.ready;
            this.set({ sse: s });
            if (reconnected) void this.resyncTrade();
          },
        ),
      );
      this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 1200);
      setInterval(() => void this.clock.sync(), 5000);
      this.set({ ready: true });
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.unsubs.forEach((u) => u());
  }

  private async resyncTrade() {
    const t = this.state.trade;
    if (!t) return;
    try {
      const r = await this.api.call<{ trade: TradeView }>("GET", `/v1/buyer/trades/${t.id}`);
      const ended = !["requested", "accepted", "arrived", "completed"].includes(r.trade.status);
      this.set({ trade: ended ? null : r.trade });
      if (ended) {
        await this.removeOurWaypoint();
        this.set({ screen: this.state.screen === "inspect" ? "map" : this.state.screen });
        this.toast("거래가 끝났어요", "warn");
      }
    } catch {
      /* 다음 이벤트·틱에서 맞춘다 */
    }
  }

  private async login() {
    const key = this.opts.storageKey ?? "jhgo.car.token";
    let token: string | null = this.api.token();
    if (!token) {
      try {
        token = localStorage.getItem(key);
      } catch {
        token = null;
      }
    }
    if (token) {
      this.api.setToken(token);
      try {
        const me = await this.api.call<{ user: { id: string; name: string; role: string } }>("GET", "/v1/me");
        if (me.user.role === "buyer") {
          this.set({ me: me.user });
          return;
        }
      } catch {
        /* 새로 로그인 */
      }
    }
    // 시연: 시드된 구매자 계정으로
    const { users } = await this.api.call<{ users: { id: string; role: string; name: string }[] }>("GET", "/v1/demo/users");
    const buyer = users.find((u) => u.role === "buyer" && u.name === (this.opts.autoLoginName ?? "김주행")) ?? users.find((u) => u.role === "buyer");
    if (!buyer) throw new Error("구매자 계정이 없어요");
    const s = await this.api.call<{ token: string; user: { id: string; name: string } }>("POST", "/v1/session", { userId: buyer.id });
    this.api.setToken(s.token);
    try {
      localStorage.setItem(key, s.token);
    } catch {
      /* 저장 안 돼도 동작 */
    }
    this.set({ me: s.user });
  }

  async loadProfile() {
    const p = await this.api.call<{
      user: { vehicle: VehicleProfile; settings: GoSetting; paymentMethod?: { kind: string; label: string } };
      interests: (Interest & { title?: string })[];
      block: CarState["block"];
    }>("GET", "/v1/buyer/profile");
    this.set({ vehicle: p.user.vehicle, settings: p.user.settings, interests: p.interests, paymentMethod: p.user.paymentMethod ?? null, block: p.block });
  }

  /** 5 적재: Vehicle CarInfo → 차종. 모델명이 없으면 한 번 고르게 한다 */
  async syncVehicle() {
    const info = await this.p.vehicle.carInfo();
    if (!info.model) {
      this.set({ vehicleNeedsPick: !this.state.vehicle });
      return;
    }
    if (this.state.vehicle?.model !== info.model) {
      try {
        const r = await this.api.call<{ vehicle: VehicleProfile }>("PUT", "/v1/buyer/vehicle", { model: info.model, modelYear: info.modelYear ?? undefined });
        this.set({ vehicle: r.vehicle, vehicleNeedsPick: false });
      } catch {
        this.set({ vehicleNeedsPick: true });
      }
    }
  }

  async pickVehicle(model: string) {
    const r = await this.api.call<{ vehicle: VehicleProfile }>("PUT", "/v1/buyer/vehicle", { model });
    this.set({ vehicle: r.vehicle, vehicleNeedsPick: false, screen: "map" });
    this.toast(`${model} 적재 공간으로 판단할게요`, "good");
  }

  private bindPlatform() {
    const { vehicle, navi, restriction } = this.p;
    const upd = (sig: Partial<DriverSignals>) => {
      const signals = { ...this.state.signals, ...sig };
      this.gate.update(signals, Date.now());
      this.set({ signals, gate: this.gate.check(Date.now()) });
    };
    this.unsubs.push(
      vehicle.registerSeatOccupancy(["ROW_2_LEFT", "ROW_2_CENTER", "ROW_2_RIGHT"], (v) => this.set({ row2: v })),
      // 3열(T26): 확인된 SeatValue 범위(ROW_1_LEFT…ROW_3_RIGHT)의 양 끝만 쓴다. 2열 차는 값이 오지 않는다
      vehicle.registerSeatOccupancy(["ROW_3_LEFT", "ROW_3_RIGHT"], (v) => this.set({ row3: v })),
      vehicle.registerEvBatteryStateOfCharge((v) => this.set({ soc: v })),
      vehicle.registerTurnSignalState((v) => upd({ turnSignal: v })),
      vehicle.registerSteeringWheelAngle((v) => upd({ steeringAngleDeg: v })),
      vehicle.registerBrakePedalStatus((v) => upd({ brakePressed: v })),
      vehicle.registerTrunkOpen((v) => this.onTrunk(v)),
      restriction.subscribe((r) => this.onRestriction(r)),
      navi.addListener({
        onNavigationStatus: (s) => {
          this.set({ navStatus: s });
          if (s === "ROUTE_DRIVE" && this.driveStartOdo === null) void vehicle.getOdometerKm().then((o) => (this.driveStartOdo = o));
        },
        onDestinationInfo: (d) => {
          const prev = this.state.destination;
          this.set({ destination: d });
          // 실제 차: 목적지는 Pleos 내비에서 정한다 → 새 목적지가 잡히면(정차 중) 출발 전 브리핑
          const changed = d && (!prev || haversineM({ lat: prev.latitude, lng: prev.longitude }, { lat: d.latitude, lng: d.longitude }) > 100);
          if (this.p.kind === "bridge" && changed && !this.state.restricted && this.state.screen === "map" && !this.state.trade) {
            void this.p.vehicle.getOdometerKm().then((o) => (this.driveStartOdo = o));
            this.open("briefing");
          }
        },
        onTBTInfo: (list) => {
          const t = list[0] ?? null;
          upd({ tbtDistanceM: t?.distance ?? null, tbtIsTurn: t ? !["TURN_STRAIGHT", "TURN_ARRIVE"].includes(t.type) : null });
          this.set({ tbt: t });
        },
        onWayPointInfo: (list) => this.set({ waypoints: list }),
        onWayPointArrived: (w) => void this.onWaypointArrived(w),
        onDestinationArrived: () => void this.onDestinationArrived(),
        onError: (code) => this.onNaviError(code),
      }),
    );
    this.set({ restricted: restriction.requiresDistractionOptimization() });
    void navi.getNavigationStatus().then((s) => this.set({ navStatus: s }));
    void vehicle.getFuelRangeKm().then((f) => this.set({ fuelRangeKm: f }));
  }

  private onRestriction(requiresDO: boolean) {
    const patch: Partial<CarState> = { restricted: requiresDO };
    if (requiresDO && PARKED_ONLY.includes(this.state.screen)) patch.screen = "map";
    // 9 건네기: 경유지에 도착해 정차하면 현장 확인 화면
    if (!requiresDO && this.state.trade && this.state.trade.status === "arrived") patch.screen = "inspect";
    this.set(patch);
  }

  private onTrunk(open: boolean | null) {
    const prev = this.prevTrunk;
    this.prevTrunk = open;
    this.set({ trunkOpen: open });
    // 트렁크가 열렸다 닫히면 "실으셨나요?"
    if (prev === true && open === false && this.state.trade && ["arrived", "accepted"].includes(this.state.trade.status)) {
      this.set({ loadedPrompt: true, screen: this.state.restricted ? this.state.screen : "inspect" });
      this.say("실으셨나요? 확인되면 받았어요를 눌러 주세요.");
    }
  }

  // ───────── 화면 ─────────
  open(screen: Screen) {
    if (this.state.restricted && PARKED_ONLY.includes(screen)) {
      this.toast("정차 후에 볼 수 있어요", "warn");
      return;
    }
    this.set({ screen });
    if (screen === "briefing") void this.loadBriefing();
  }

  // ───────── 목적지 ─────────
  async setDestination(d: { lat: number; lng: number; name: string }) {
    await this.p.navi.requestRoute({ latitude: d.lat, longitude: d.lng, name: d.name });
    this.set({ destination: await this.p.navi.getDestinationInfo(), result: null });
    this.driveStartOdo = await this.p.vehicle.getOdometerKm();
    this.open("briefing");
  }

  private async buildCtx() {
    const { navi, vehicle } = this.p;
    const [navStatus, loc, dest, wps, soc, fuel] = await Promise.all([
      navi.getNavigationStatus(),
      navi.getCurrentLocationInfo(),
      navi.getDestinationInfo(),
      navi.getWaypointInfo(),
      vehicle.getEvBatteryStateOfCharge(),
      vehicle.getFuelRangeKm(),
    ]);
    this.set({
      navStatus,
      destination: dest,
      waypoints: wps,
      soc: soc ?? this.state.soc,
      fuelRangeKm: fuel,
      location: { lat: loc.latitude, lng: loc.longitude, heading: loc.heading ?? 0 },
    });
    const now = this.clock.now();
    for (const [k, v] of Object.entries(this.tripChecks)) if (now - v.checkedAt > 3 * 60_000) delete this.tripChecks[k];
    return {
      now,
      navStatus,
      location: { lat: loc.latitude, lng: loc.longitude },
      destination: dest ? { lat: dest.latitude, lng: dest.longitude, name: dest.name, remainTimeS: dest.remainTime, remainDistM: dest.remainDistance } : null,
      waypointCount: wps.length,
      waypoints: wps.map((w) => ({ lat: w.latitude, lng: w.longitude })),
      socPct: soc,
      fuelRangeKm: fuel,
      seats: { row2Occupied: this.state.row2, row3Occupied: this.state.row3 },
      tripChecks: this.tripChecks,
    };
  }

  async loadBriefing() {
    if (!this.state.destination) {
      this.set({ briefing: null });
      return;
    }
    const ctx = await this.buildCtx();
    const r = await this.api.call<CarState["briefing"]>("POST", "/v1/drive/briefing", { ctx });
    this.set({ briefing: r });
  }

  // ───────── 주행 루프 ─────────
  async tick() {
    if (this.busy || !this.state.ready) return;
    this.busy = true;
    try {
      this.set({ gate: this.gate.check(Date.now()) });
      if (this.state.alert && Date.now() - this.state.alert.shownAt > ALERT_TIMEOUT_MS) this.closeAlert(false);
      const nav = await this.p.navi.getNavigationStatus();
      if (nav !== "ROUTE_DRIVE" && nav !== "FREE_DRIVE") {
        this.set({ navStatus: nav, mode: "idle" });
        return;
      }
      let ctx = await this.buildCtx();
      let ev = await this.api.call<{
        mode: CarState["mode"];
        top: CandidateView | null;
        contention: CandidateView[] | null;
        watching: number;
        candidates: CandidateView[];
        route: CarState["route"];
        activeTrade: TradeView | null;
        block: CarState["block"];
        notices: { type: string; text: string }[];
      }>("POST", "/v1/drive/context", { ctx });
      if (JSON.stringify(ev.block) !== JSON.stringify(this.state.block)) this.set({ block: ev.block });

      for (const n of ev.notices) this.toast(n.text, n.type === "expired" ? "warn" : "info");
      if (ev.activeTrade) this.set({ trade: ev.activeTrade });
      else if (this.state.trade && ["requested", "accepted", "arrived"].includes(this.state.trade.status)) this.set({ trade: null });

      // 3·4 우회·에너지: 처음 보는 1위는 requestTrip으로 시간·도착 배터리를 다시 확인한다
      const top = ev.top;
      const driving = this.p.restriction.requiresDistractionOptimization();
      if (top && driving && !this.state.alert && !this.tripChecks[top.listingId]) {
        try {
          const t = await this.p.navi.requestTrip({ latitude: top.approxArea.lat, longitude: top.approxArea.lng, poiId: top.listingId, poiName: `주행중GO! ${top.categoryLabel}` });
          // 수락 전이라 대략 위치로 잰 값 — 서버는 도착 배터리 예측에만 쓴다
          this.tripChecks[top.listingId] = { distanceM: t.distance, etaS: t.eta, socAtDestPct: t.estimatedSocAtDest, energyConsumption: t.energyConsumption, checkedAt: this.clock.now(), pointIsExact: false };
          ctx = await this.buildCtx();
          ev = await this.api.call("POST", "/v1/drive/context", { ctx });
        } catch {
          /* requestTrip 실패 시 서버 계산값으로 진행 */
        }
      }

      this.set({ mode: ev.mode, watching: ev.watching, candidates: ev.candidates, route: ev.route });

      // 7·8 약속·만남: 확정된 거래는 경유지 남은 시간으로 도착 예정 공유
      const tr = this.state.trade;
      if (tr && tr.status === "accepted" && tr.waypointConfirmedAt && Date.now() - this.lastEtaPost > 4000) {
        const w = this.ourWaypoint(this.state.waypoints, tr);
        if (w) {
          this.lastEtaPost = Date.now();
          const r = await this.api.call<{ trade: TradeView }>("POST", `/v1/buyer/trades/${tr.id}/eta`, { remainS: w.remainTime });
          this.set({ trade: r.trade });
        }
      }

      // 6 말할 때: 알림 대상이 있고 거래 중이 아니면 타이밍 게이트를 통과할 때 말한다
      // 정차 중에는 음성 알림 대신 출발 전 브리핑이 같은 역할을 한다
      const wantAlert = driving && !this.state.alert && !this.state.trade && !!(ev.top || ev.contention);
      if (!wantAlert && this.state.holdNote) {
        this.lastHoldKey = "";
        this.set({ holdNote: null });
      }
      if (wantAlert) {
        const g = this.gate.check(Date.now());
        if (!g.ok) {
          const key = g.reasons.join(",");
          if (key !== this.lastHoldKey) {
            this.lastHoldKey = key;
            this.set({ holdNote: `알림 대기: ${g.reasons.map((r) => GATE_REASON_KO[r]).join(", ")}` });
          }
          return;
        }
        this.lastHoldKey = "";
        this.set({ holdNote: null });
        if (ev.contention && ev.contention.length === 2) this.showContention(ev.contention);
        else if (ev.top && ev.top.exclusions.length === 0) this.showAlert(ev.top);
      }
    } catch (e) {
      console.warn("tick", e);
    } finally {
      this.busy = false;
    }
  }

  private ourWaypoint(list: WaypointInfo[], t: TradeView): WaypointInfo | undefined {
    if (!t.pickupPoint) return undefined;
    return list.find((w) => haversineM({ lat: w.latitude, lng: w.longitude }, t.pickupPoint!) < PICKUP_MATCH_M);
  }

  // ───────── 알림 · 응답 ─────────
  private showAlert(c: CandidateView) {
    this.set({ alert: { kind: "single", c, shownAt: Date.now(), listening: false } });
    void this.api.call("POST", "/v1/drive/alerted", { listingIds: [c.listingId] });
    this.chime();
    this.say(c.speech);
    void this.listenAnswer(YES_WORDS.concat(NO_WORDS), (w) => this.answer(YES_WORDS.includes(w)));
  }

  private showContention(pair: CandidateView[]) {
    this.set({ alert: { kind: "contention", pair, shownAt: Date.now(), listening: false } });
    void this.api.call("POST", "/v1/drive/alerted", { listingIds: pair.map((c) => c.listingId) });
    this.chime();
    const [a, b] = pair;
    const text = a.categoryLabel === b.categoryLabel ? `${a.categoryLabel} 두 곳이 가까워요. 첫 번째? 두 번째?` : `오늘은 어느 쪽? ${a.categoryLabel}? ${b.categoryLabel}?`;
    this.say(text);
    void this.listenAnswer([a.categoryLabel, b.categoryLabel], (w) => this.choose(pair.find((c) => c.categoryLabel === w)!.listingId));
  }

  private async listenAnswer(words: string[], onWord: (w: string) => void) {
    if (!this.p.voice.stt) return;
    await new Promise((r) => setTimeout(r, 2200));
    const shown = this.state.alert;
    if (!shown) return;
    this.set({ alert: { ...shown, listening: true } });
    const w = await this.p.voice.listen(words, 6000);
    if (this.state.alert !== null && this.state.alert.shownAt === shown.shownAt) {
      this.set({ alert: { ...this.state.alert, listening: false }, heard: w ? { word: w, at: Date.now() } : this.state.heard });
      if (w) onWord(w);
    }
  }

  setFocus(listingId: string | null) {
    this.set({ focusId: listingId });
  }

  /** 마이크: 자유로운 한 마디를 듣고 조수에게 묻는다(T34). 알림이 듣는 중이면 그쪽이 먼저 */
  async talk() {
    if (this.state.talking) return;
    if (!this.p.voice.stt) {
      this.toast("이 차에서는 음성 인식이 안 돼요", "warn");
      return;
    }
    this.set({ talking: true });
    try {
      const q = await this.p.voice.listenFree(7000);
      if (q) await this.ask(q);
      else this.toast("못 들었어요. 다시 눌러 말해 주세요", "warn");
    } finally {
      this.set({ talking: false });
    }
  }

  /** 운전자의 말 → 서버 조수(지금 맥락의 사실로 답) → 읽어 주고, 행동이 있으면 그대로 한다 */
  /** opts.quick: Gleo 경로(7초 안에 답해야 함) — 서버가 AI를 짧게만 기다리고 규칙 조수로 */
  async ask(question: string, opts: { quick?: boolean } = {}): Promise<AssistResult | null> {
    const q = question.trim();
    if (!q) return null;
    const a = this.state.alert;
    const alert = a ? (a.kind === "contention" ? { kind: "contention" as const, listingIds: a.pair.map((x) => x.listingId) } : { kind: "single" as const, listingIds: [a.c.listingId] }) : null;
    this.set({ chat: { q, a: "…", at: Date.now(), source: "rule" } });
    try {
      const ctx = await this.buildCtx();
      const r = await this.api.call<AssistResult>("POST", "/v1/assist", { ctx, question: q, focusId: this.state.focusId, alert, driving: this.state.restricted, quick: opts.quick === true });
      this.set({ chat: { q, a: r.text, at: Date.now(), source: r.source }, focusId: r.focusId ?? this.state.focusId });
      this.say(r.text);
      if (r.action) await this.applyAssistAction(r.action);
      return r;
    } catch (e) {
      const msg = "지금은 답하지 못했어요";
      this.set({ chat: { q, a: msg, at: Date.now(), source: "rule" } });
      this.toast(`${msg}: ${(e as Error).message}`, "warn");
      return null;
    }
  }

  private async applyAssistAction(act: NonNullable<AssistResult["action"]>) {
    const a = this.state.alert;
    if (act.type === "choose") {
      if (a?.kind === "contention") this.choose(act.listingId);
      return;
    }
    if (act.type === "dismiss") {
      if (a?.kind === "single") this.closeAlert(true);
      else if (a) this.closeAlert(false);
      return;
    }
    // request: 떠 있는 알림이 그 매물이면 '들를게요'와 같고, 아니면 목록에서 미리 요청
    if (a?.kind === "single" && a.c.listingId === act.listingId) {
      this.set({ alert: null });
      await this.request(act.listingId, "drive");
    } else if (!this.state.trade) {
      await this.request(act.listingId, "briefing");
    } else {
      this.toast("진행 중인 거래가 있어 지금은 요청하지 않아요", "warn");
    }
  }

  /** 지금 목록(주행 후보 또는 브리핑)에서 매물 하나 */
  candidateOf(listingId: string): CandidateView | undefined {
    return this.state.candidates.find((x) => x.listingId === listingId) ?? this.state.briefing?.items.find((x) => x.listingId === listingId);
  }

  /** 물건 요약 브리핑(T33)을 읽어 준다 — 주행 중에 목록을 누르면 사진 대신 이걸로 */
  speakBrief(listingId: string) {
    const c = this.candidateOf(listingId);
    if (!c) return;
    const b = c.brief;
    this.say(b ? b.speech : `${c.categoryLabel}, ${c.description || "판매자 설명이 없어요"}`);
  }

  /** 펼친 카드의 사진 — 한 번만 받아 둔다 */
  async loadBriefPhotos(listingId: string) {
    if (this.state.briefPhotos[listingId]) return;
    try {
      const r = await this.api.call<{ brief: ListingBrief; photos: string[] }>("GET", `/v1/listings/${listingId}/brief`);
      this.set({ briefPhotos: { ...this.state.briefPhotos, [listingId]: r.photos } });
      // 사진 분석이 뒤늦게 끝났을 수 있다 → 목록의 브리핑도 새 것으로
      const upd = (x: CandidateView) => (x.listingId === listingId ? { ...x, brief: r.brief } : x);
      this.set({ candidates: this.state.candidates.map(upd), briefing: this.state.briefing ? { ...this.state.briefing, items: this.state.briefing.items.map(upd) } : null });
    } catch {
      /* 사진 없이 카드만 */
    }
  }

  /** 듣는 중일 때 기대하는 말 — 자막·콘솔 안내용 */
  listenWords(): string[] {
    const a = this.state.alert;
    if (!a) return [];
    return a.kind === "contention" ? a.pair.map((c) => c.categoryLabel) : ["응", "아니"];
  }

  closeAlert(dismiss: boolean) {
    const a = this.state.alert;
    if (!a) return;
    this.set({ alert: null });
    if (dismiss && a.kind === "single") void this.api.call("POST", "/v1/drive/dismiss", { listingId: a.c.listingId });
  }

  /** 경합: 고른 매물을 그날 1위로 — 상세 알림을 다시 묻는다 */
  choose(listingId: string) {
    const a = this.state.alert;
    if (!a || a.kind !== "contention") return;
    const c = a.pair.find((x) => x.listingId === listingId);
    if (!c) return;
    this.set({ alert: null });
    this.showAlert(c);
  }

  /** "들를게요" / "아니요" */
  async answer(yes: boolean) {
    const a = this.state.alert;
    if (!a || a.kind !== "single") return;
    if (!yes) {
      this.closeAlert(true);
      this.say("알겠어요. 다음 매물을 찾을게요.");
      return;
    }
    this.set({ alert: null });
    await this.request(a.c.listingId, "drive");
  }

  async request(listingId: string, source: "drive" | "briefing") {
    try {
      const ctx = await this.buildCtx();
      const r = await this.api.call<{ trade: TradeView }>("POST", "/v1/drive/request", { ctx, listingId, source });
      this.set({ trade: r.trade, screen: source === "briefing" ? "briefing" : this.state.screen });
      if (r.trade.status === "accepted") await this.onAccepted(r.trade);
      else this.say("판매자에게 물어볼게요. 우회 지점 전까지 답을 기다려요.");
    } catch (e) {
      this.toast((e as Error).message, "warn");
    }
  }

  // ───────── 실시간 알림 ─────────
  private async onEvent(e: AppEvent) {
    const trade = (e.data?.trade ?? null) as TradeView | null;
    switch (e.type) {
      case "trade.accepted":
        if (trade) await this.onAccepted(trade);
        break;
      case "trade.declined":
      case "trade.expired":
        this.set({ trade: null });
        this.toast(e.body || e.title, "warn");
        this.say(e.type === "trade.declined" ? "판매자가 이번엔 어렵대요. 다음 매물을 찾을게요." : "응답이 없어 요청을 끝냈어요.");
        break;
      case "trade.canceled":
      case "trade.no_show":
        await this.removeOurWaypoint();
        this.set({ trade: null, screen: this.state.restricted ? "map" : this.state.screen === "inspect" ? "map" : this.state.screen });
        this.toast(e.title, "warn");
        this.say(e.title + ". 경유지를 해제했어요.");
        break;
      case "trade.seller_coming":
        // 판매자가 물건을 들고 나오는 중 — 기다림 패널·거래 카드에 표시, 짧게 알린다
        if (trade) this.set({ trade });
        this.toast("판매자가 나오고 있어요", "info");
        break;
      case "trade.handed":
        if (trade) this.set({ trade });
        // 현장 확인 화면이 열려 있으면 그 안의 안내가 같은 말을 한다
        if (this.state.screen !== "inspect") this.toast("판매자가 건넸다고 표시했어요. 확인해 주세요", "info");
        break;
      case "trade.received":
      case "trade.settled":
      case "trade.refunded":
        if (trade) this.set({ trade: ["settled", "declined_mismatch", "seller_no_show"].includes(trade.status) ? null : trade });
        // 팔린 매물은 다음 평가를 기다리지 않고 목록·핀에서 바로 뺀다
        if (trade && ["completed", "settled"].includes(trade.status)) this.dropCandidate(trade.listingId);
        if (e.type === "trade.settled") this.toast(e.title, "good");
        break;
    }
  }

  /** 7 약속: 수락되면 경유지를 넣고, 다시 조회해 실제로 들어갔는지 확인한 뒤 확정을 알린다 */
  /** 자동 수락이면 요청 응답과 실시간 알림이 둘 다 온다(늦게 올 수도 있다) → 거래마다 한 번만 경유지를 넣는다 */
  private acceptHandled = new Set<string>();

  private async onAccepted(t: TradeView) {
    if (this.acceptHandled.has(t.id)) return;
    this.acceptHandled.add(t.id);
    await this.applyAccepted(t);
  }

  private async applyAccepted(t: TradeView) {
    this.set({ trade: t });
    if (!t.pickupPoint) {
      const r = await this.api.call<{ trade: TradeView }>("GET", `/v1/buyer/trades/${t.id}`);
      t = r.trade;
      this.set({ trade: t });
    }
    if (!t.pickupPoint || t.waypointConfirmedAt) return;
    const pp = t.pickupPoint;
    const req = {
      latitude: pp.lat,
      longitude: pp.lng,
      poiName: `주행중GO! 픽업 · ${categoryShort(t)}`,
      waypointIndex: "FIRST" as const,
      poiId: `jhgo:${t.id}`,
      address: pp.label,
      poiSubId: "",
      poiProvider: "",
    };
    // 반영 확인은 호출 성공이 아니라 getWaypointInfo 재조회로 한다(한 번 더 기다려 본다)
    const confirmed = async () => {
      for (let i = 0; i < 2; i++) {
        const list = await this.p.navi.getWaypointInfo();
        this.set({ waypoints: list });
        if (this.ourWaypoint(list, t)) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    };
    let ok = false;
    try {
      const dest = await this.p.navi.getDestinationInfo();
      const parked = !this.p.restriction.requiresDistractionOptimization();
      if (parked && dest && t.source === "briefing") {
        // 출발 전 브리핑에서 미리 고른 매물: 목적지와 경유지를 한 번에(안 되면 경유지 추가로)
        try {
          await this.p.navi.requestRouteWithWaypoints({ latitude: dest.latitude, longitude: dest.longitude, name: dest.name }, [req]);
          ok = await confirmed();
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        await this.p.navi.addWaypoint(req);
        ok = await confirmed();
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // 11-5 #2 대체: 판매자 지점을 잠시 목적지로 설정, 거래 뒤 원래 목적지로
      try {
        const dest = await this.p.navi.getDestinationInfo();
        if (dest) this.fallbackOriginalDest = { latitude: dest.latitude, longitude: dest.longitude, name: dest.name };
        await this.p.navi.requestRoute({ latitude: pp.lat, longitude: pp.lng, name: req.poiName });
        ok = true;
        this.toast("경유지 대신 판매자 지점을 잠시 목적지로 설정했어요", "info");
      } catch {
        this.toast("경로를 바꾸지 못했어요. 거래를 취소할게요", "warn");
        await this.cancelTrade("차 내비가 경유지를 받지 못했어요", true);
        return;
      }
    }
    const r = await this.api.call<{ trade: TradeView }>("POST", `/v1/buyer/trades/${t.id}/waypoint-confirmed`);
    this.set({ trade: r.trade });
    this.say(`확정됐어요. ${t.autoAccepted ? "판매자가 미리 정해 둔 시간이라 바로 " : ""}경유지를 추가했어요. 대금은 보관됐어요.`);
  }

  private async removeOurWaypoint() {
    const t = this.state.trade;
    try {
      if (this.fallbackOriginalDest) {
        const d = this.fallbackOriginalDest;
        this.fallbackOriginalDest = null;
        await this.p.navi.requestRoute(d);
        return;
      }
      const list = await this.p.navi.getWaypointInfo();
      const idx = t ? list.findIndex((w) => t.pickupPoint && haversineM({ lat: w.latitude, lng: w.longitude }, t.pickupPoint) < PICKUP_MATCH_M) : -1;
      if (idx >= 0) await this.p.navi.removeWaypoint(idx === 0 ? "FIRST" : "SECOND");
    } catch {
      /* 무시 */
    }
  }

  /** 8 만남: 경유지 도착 → 판매자에게 "도착했어요" */
  private async onWaypointArrived(w: WaypointInfo) {
    const t = this.state.trade;
    if (!t || !t.pickupPoint || haversineM({ lat: w.latitude, lng: w.longitude }, t.pickupPoint) > PICKUP_MATCH_M) return;
    try {
      const r = await this.api.call<{ trade: TradeView }>("POST", `/v1/buyer/trades/${t.id}/arrived`);
      this.set({ trade: r.trade, loadedPrompt: false });
      this.say("도착했어요. 판매자에게 알렸어요. 정차하면 물건 확인 화면이 열려요.");
      if (!this.p.restriction.requiresDistractionOptimization()) this.set({ screen: "inspect" });
    } catch (e) {
      this.toast((e as Error).message, "warn");
    }
  }

  private async onDestinationArrived() {
    const t = this.state.trade;
    // 대체 경로로 판매자 지점을 목적지로 잡았던 경우 = 경유지 도착
    if (this.fallbackOriginalDest && t && t.status === "accepted") {
      await this.onWaypointArrived({ name: "", address: "", latitude: t.pickupPoint!.lat, longitude: t.pickupPoint!.lng, remainDistance: 0, remainTime: 0, poiId: "" });
      return;
    }
    const odo = await this.p.vehicle.getOdometerKm();
    const delta = odo !== null && this.driveStartOdo !== null ? Math.round((odo - this.driveStartOdo) * 10) / 10 : null;
    this.driveStartOdo = null;
    try {
      const r = await this.api.call<EndResult>("POST", "/v1/drive/end", { odometerDeltaKm: delta });
      this.set({ result: r, screen: "result", mode: "idle", candidates: [], route: null, alert: null });
      this.say(r.items.length ? `도착했어요. 오늘 ${josa(r.items.map((i) => i.categoryLabel).join(", "), "을/를")} 가는 길에 챙겼어요.` : "도착했어요.");
    } catch {
      /* 무시 */
    }
  }

  private onNaviError(code: string) {
    this.toast(`내비 오류: ${code}`, "warn");
    // 19 오류 처리: 요청 중인 거래가 있고 경유지를 못 넣으면 취소
    const t = this.state.trade;
    // requestTrip 실패(CAUSE_SEARCH_TRIP)는 알림 전 확인일 뿐이라 거래를 건드리지 않는다
    if (t && t.status === "requested" && code !== "CAUSE_SEARCH_TRIP") void this.cancelTrade(`내비 오류 ${code}`, true);
  }

  // ───────── 현장 확인 · 마무리 ─────────
  private dropCandidate(listingId: string) {
    const candidates = this.state.candidates.filter((c) => c.listingId !== listingId);
    const briefing = this.state.briefing ? { ...this.state.briefing, items: this.state.briefing.items.filter((c) => c.listingId !== listingId) } : this.state.briefing;
    this.set({ candidates, briefing });
  }

  async received() {
    const t = this.state.trade;
    if (!t) return;
    const r = await this.api.call<{ trade: TradeView }>("POST", `/v1/buyer/trades/${t.id}/received`);
    await this.removeOurWaypoint();
    this.set({ trade: r.trade.status === "completed" ? { ...r.trade } : null, loadedPrompt: false, screen: "map", fragilePrompt: t.fragile });
    this.dropCandidate(t.listingId);
    this.say(t.fragile ? "거래 완료. 깨지기 쉬운 물건이에요. 편안한 길로 바꿀까요?" : "거래 완료. 출발하면 원래 목적지로 이어 갈게요.");
    setTimeout(() => this.set({ trade: this.state.trade?.status === "completed" ? null : this.state.trade }), 6000);
  }

  async declineMismatch(reason: string) {
    const t = this.state.trade;
    if (!t) return;
    await this.api.call("POST", `/v1/buyer/trades/${t.id}/decline`, { reason });
    await this.removeOurWaypoint();
    this.set({ trade: null, loadedPrompt: false, screen: "map" });
    this.say("거래하지 않았어요. 대금은 전액 환불돼요.");
    this.toast("현장 사진은 폰의 주행중GO!에서 남길 수 있어요", "info");
  }

  /** T20 도착했는데 판매자가 안 보일 때: 다시 알리기 */
  async nudgeSeller() {
    const t = this.state.trade;
    if (!t) return;
    try {
      const r = await this.api.call<{ trade: TradeView }>("POST", `/v1/buyer/trades/${t.id}/nudge`);
      this.set({ trade: r.trade });
      this.toast("판매자에게 다시 알렸어요", "good");
    } catch (e) {
      this.toast((e as Error).message, "warn");
    }
  }

  /** T20 기다려도 안 나오면 거래를 끝낸다 — 전액 환불, 판매자 신뢰도에 반영 */
  async sellerAbsent() {
    const t = this.state.trade;
    if (!t) return;
    try {
      await this.api.call("POST", `/v1/buyer/trades/${t.id}/seller-absent`);
    } catch (e) {
      this.toast((e as Error).message, "warn");
      return;
    }
    await this.removeOurWaypoint();
    this.set({ trade: null, loadedPrompt: false, screen: "map" });
    this.say("판매자를 만나지 못해 거래를 끝냈어요. 대금은 전액 환불돼요. 출발하면 원래 목적지로 이어 갈게요.");
  }

  /** T21 결과 카드에서 판매자 평가 */
  async rate(tradeId: string, stars: number) {
    try {
      await this.api.call("POST", `/v1/buyer/trades/${tradeId}/rate`, { stars });
      this.set({ ratings: { ...this.state.ratings, [tradeId]: stars } });
    } catch (e) {
      this.toast((e as Error).message, "warn");
    }
  }

  /** system: 차 쪽 실패로 앱이 대신 취소(구매자 신뢰도에 반영하지 않음) */
  async cancelTrade(reason = "구매자 취소", system = false) {
    const t = this.state.trade;
    if (!t) return;
    try {
      await this.api.call("POST", `/v1/buyer/trades/${t.id}/cancel`, { reason, system });
    } catch {
      /* 이미 끝난 거래 */
    }
    await this.removeOurWaypoint();
    this.set({ trade: null, screen: this.state.screen === "inspect" ? "map" : this.state.screen });
  }

  async comfortable(yes: boolean) {
    this.set({ fragilePrompt: false });
    if (yes) {
      await this.p.navi.changeRouteOption("COMFORTABLE");
      this.say("편안한 길로 바꿨어요.");
    }
  }

  dismissResult() {
    this.set({ result: null, screen: "map" });
  }

  // ───────── 관심사 · 설정 ─────────
  async addInterest(keyword: string, goLevel: GoLevel) {
    await this.api.call("POST", "/v1/buyer/interests", { type: "keyword", keyword, goLevel });
    await this.loadProfile();
  }
  async addWish(listingId: string, goLevel: GoLevel) {
    await this.api.call("POST", "/v1/buyer/interests", { type: "wish", listingId, goLevel });
    await this.loadProfile();
    this.toast("찜했어요. 다음에 지날 때 먼저 알려 드릴게요", "good");
  }
  /** 찜한 매물의 GO 등급 바꾸기 */
  async setWishLevel(listingId: string, goLevel: GoLevel) {
    await this.api.call("POST", "/v1/buyer/interests", { type: "wish", listingId, goLevel });
    await this.loadProfile();
  }
  async removeInterest(id: string) {
    await this.api.call("DELETE", `/v1/buyer/interests/${id}`);
    await this.loadProfile();
  }
  async saveSettings(s: Partial<GoSetting>) {
    const r = await this.api.call<{ settings: GoSetting }>("PUT", "/v1/buyer/settings", s);
    this.set({ settings: r.settings });
  }
}

function categoryShort(t: TradeView): string {
  const map: Record<string, string> = { car_seat: "카시트", stroller: "유모차", baby_bed: "아기 침대", camping_chair: "캠핑의자" };
  return map[t.category] ?? t.title.slice(0, 8);
}
