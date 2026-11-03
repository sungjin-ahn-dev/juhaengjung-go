/**
 * Pleos SDK 시뮬레이터 — 브라우저에서 NaviHelper·Vehicle·CarUxRestrictions를 흉내 낸다.
 * 시연 도로망 위를 실제로 달리며 TBT·경유지 도착·배터리·주행거리·방향지시등·조향·제동 신호를 낸다.
 * 가상 콘솔(Virtual Console)에서 기어·좌석·방향지시등·배터리·트렁크를 바꿀 수 있다.
 */
import {
  DEMO_NET,
  Graph,
  GraphRouter,
  haversineM,
  nextManeuver,
  pointAtAlong,
  speedAtAlong,
  timeAtAlong,
  vehicleByModel,
  type LatLng,
  type Route,
  type RouteOption,
  type TurnType,
} from "@jhgo/core";
import type {
  AccessType,
  CarInfo,
  CarPlatform,
  CurrentLocationInfo,
  DestinationInfo,
  DrivingRestrictionPort,
  NavigationStatus,
  NaviListener,
  NaviPort,
  RequestWaypointInfo,
  SdkLogEntry,
  SeatValue,
  TBTInfo,
  TripInfo,
  TurnSignalValue,
  VehiclePort,
  VoicePort,
  WaypointIndex,
  WaypointInfo,
} from "./ports.ts";

export interface SimClock {
  now(): number;
  rate(): number;
}

export interface SimState {
  gear: "P" | "D";
  model: string;
  carInfoHasModel: boolean;
  socPct: number;
  fuelRangeKm: number | null;
  odometerKm: number;
  row2Occupied: boolean;
  row3Occupied: boolean;
  turnSignal: TurnSignalValue;
  steeringDeg: number;
  brake: boolean;
  trunkOpen: boolean;
  /** 자동 운전 행동: 회전 전 방향지시등, 회전 중 조향, 감속 시 제동 */
  autoDriver: boolean;
  navStatus: NavigationStatus;
  position: LatLng;
  heading: number;
  speedKph: number;
  routeOption: RouteOption;
}

interface ActiveWaypoint {
  req: RequestWaypointInfo;
  alongM: number;
}

const TURNISH: TurnType[] = ["TURN_LEFT", "TURN_RIGHT", "TURN_SHARP_L", "TURN_SHARP_R", "TURN_UTURN", "TURN_KEEP_L", "TURN_KEEP_R", "TURN_ENTER_IC_R", "TURN_EXIT_IC_R", "TURN_WAY"];
const LEFTISH: TurnType[] = ["TURN_LEFT", "TURN_SHARP_L", "TURN_KEEP_L", "TURN_UTURN"];

export const TURN_KO: Record<TurnType, string> = {
  TURN_LEFT: "좌회전",
  TURN_RIGHT: "우회전",
  TURN_SHARP_L: "급좌회전",
  TURN_SHARP_R: "급우회전",
  TURN_KEEP_L: "왼쪽 방향",
  TURN_KEEP_R: "오른쪽 방향",
  TURN_STRAIGHT: "직진",
  TURN_ENTER_IC_R: "고속도로 진입",
  TURN_EXIT_IC_R: "고속도로 출구",
  TURN_UTURN: "유턴",
  TURN_WAY: "경유지",
  TURN_ARRIVE: "목적지",
};

export class SimCar implements NaviPort, VehiclePort, DrivingRestrictionPort {
  readonly router = new GraphRouter(new Graph(DEMO_NET));
  route: Route | null = null;
  s = 0;
  dest: { lat: number; lng: number; name: string } | null = null;
  wps: ActiveWaypoint[] = [];
  readonly st: SimState;
  private naviListeners = new Set<NaviListener>();
  private vListeners = {
    seat: new Set<(v: boolean | null) => void>(),
    seat3: new Set<(v: boolean | null) => void>(),
    soc: new Set<(v: number | null) => void>(),
    signal: new Set<(v: TurnSignalValue | null) => void>(),
    steer: new Set<(v: number | null) => void>(),
    brake: new Set<(v: boolean | null) => void>(),
    trunk: new Set<(v: boolean | null) => void>(),
    restriction: new Set<(v: boolean) => void>(),
  };
  private logListeners = new Set<(e: SdkLogEntry) => void>();
  private stateListeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastEmit = 0;
  private lastTbtKey = "";
  private manual: { signal?: { v: TurnSignalValue; until: number }; steer?: { v: number; until: number }; brake?: { v: boolean; until: number } } = {};
  private lastSocInt = -1;

  constructor(
    readonly clock: SimClock,
    init: { position: LatLng; model?: string; socPct?: number } = { position: { lat: 37.2636, lng: 127.0286 } },
  ) {
    this.st = {
      gear: "P",
      model: init.model ?? "아이오닉 5",
      carInfoHasModel: true,
      socPct: init.socPct ?? 62,
      fuelRangeKm: null,
      odometerKm: 12840.2,
      row2Occupied: false,
      row3Occupied: false,
      turnSignal: "OFF",
      steeringDeg: 0,
      brake: false,
      trunkOpen: false,
      autoDriver: true,
      navStatus: "INACTIVE",
      position: { ...init.position },
      heading: 45,
      speedKph: 0,
      routeOption: "RECOMMENDED",
    };
  }

  // ───────── 실행 루프 ─────────
  start() {
    if (this.timer) return;
    this.lastTick = this.clock.now();
    this.timer = setInterval(() => this.tick(), 100);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onState(cb: () => void) {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  onLog(cb: (e: SdkLogEntry) => void) {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }
  private log(dir: SdkLogEntry["dir"], api: string, text: string) {
    const e = { at: this.clock.now(), dir, api, text };
    for (const l of this.logListeners) l(e);
  }
  private changed() {
    for (const l of this.stateListeners) l();
  }

  tick() {
    const now = this.clock.now();
    const dtS = Math.max(0, Math.min(120, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const st = this.st;
    let moved = 0;
    if (st.gear === "D" && this.route) {
      const r = this.route;
      const total = r.distanceM;
      const nextWp = this.wps[0];
      const stopAt = nextWp ? nextWp.alongM : total;
      const m = nextManeuver(r, this.s);
      let v = speedAtAlong(r, this.s);
      const toStop = stopAt - this.s;
      if (m && TURNISH.includes(m.type) && m.type !== "TURN_WAY" && m.distanceM < 80 && !["TURN_ENTER_IC_R", "TURN_EXIT_IC_R", "TURN_KEEP_L", "TURN_KEEP_R"].includes(m.type)) v = Math.min(v, 25);
      if (toStop < 150) v = Math.min(v, 20);
      st.speedKph = v;
      const ds = Math.min((v / 3.6) * dtS, Math.max(0, toStop));
      this.s += ds;
      moved = ds;
      if (stopAt - this.s < 0.5) {
        if (nextWp) this.arriveWaypoint();
        else this.arriveDestination();
      }
      const p = pointAtAlong(r.line, this.s);
      st.position = p.point;
      st.heading = p.headingDeg;
    } else {
      st.speedKph = 0;
    }
    if (moved > 0) {
      st.odometerKm += moved / 1000;
      const rate = vehicleByModel(st.model)?.defaultSocPctPerKm ?? 0.22;
      st.socPct = Math.max(0, st.socPct - (moved / 1000) * rate);
      const si = Math.floor(st.socPct);
      if (si !== this.lastSocInt) {
        this.lastSocInt = si;
        for (const l of this.vListeners.soc) l(Math.round(st.socPct * 10) / 10);
      }
    }
    this.driverBehavior(now);
    if (now - this.lastEmit > 1000 * Math.max(1, this.clock.rate() / 10)) {
      this.lastEmit = now;
      const loc = this.locationInfo();
      for (const l of this.naviListeners) l.onCurrentLocationInfo?.(loc);
    }
    this.emitTbt();
    this.changed();
  }

  private driverBehavior(now: number) {
    const st = this.st;
    let signal: TurnSignalValue = "OFF";
    let steer = (Math.random() - 0.5) * 0.6;
    let brake = false;
    if (st.autoDriver && st.gear === "D" && this.route) {
      const m = nextManeuver(this.route, this.s);
      // 지난 회전(20m 이내)도 조향 중으로 본다
      const prev = this.route.maneuvers.filter((x) => x.alongM <= this.s).at(-1);
      if (m && TURNISH.includes(m.type) && m.distanceM < 250) signal = LEFTISH.includes(m.type) ? "LEFT" : "RIGHT";
      if (prev && this.s - prev.alongM < 20 && TURNISH.includes(prev.type)) signal = LEFTISH.includes(prev.type) ? "LEFT" : "RIGHT";
      const near = [m && m.distanceM < 40 ? m : null, prev && this.s - prev.alongM < 40 ? prev : null].find(
        (x) => x && ["TURN_LEFT", "TURN_RIGHT", "TURN_SHARP_L", "TURN_SHARP_R", "TURN_UTURN"].includes(x.type),
      );
      if (near) steer = LEFTISH.includes(near.type) ? -12 : 12;
      const stopAt = this.wps[0]?.alongM ?? this.route.distanceM;
      if ((m && m.distanceM < 60 && ["TURN_LEFT", "TURN_RIGHT", "TURN_SHARP_L", "TURN_SHARP_R", "TURN_UTURN"].includes(m.type)) || stopAt - this.s < 120) brake = true;
    }
    if (this.manual.signal && now < this.manual.signal.until) signal = this.manual.signal.v;
    if (this.manual.steer && now < this.manual.steer.until) steer = this.manual.steer.v;
    if (this.manual.brake && now < this.manual.brake.until) brake = this.manual.brake.v;
    if (st.gear === "P" && !(this.manual.signal && now < this.manual.signal.until)) signal = "OFF";
    if (signal !== st.turnSignal) {
      st.turnSignal = signal;
      for (const l of this.vListeners.signal) l(signal);
      this.log("event", "TurnSignal", `onTurnSignalStateUpdated(${signal})`);
    }
    if (Math.abs(steer - st.steeringDeg) > 0.5) {
      st.steeringDeg = Math.round(steer * 10) / 10;
      for (const l of this.vListeners.steer) l(st.steeringDeg);
    }
    if (brake !== st.brake) {
      st.brake = brake;
      for (const l of this.vListeners.brake) l(brake);
    }
  }

  private emitTbt() {
    const list = this.tbtList();
    const key = list.length ? `${list[0].type}|${Math.round(list[0].distance / 50)}` : "none";
    if (key === this.lastTbtKey) return;
    this.lastTbtKey = key;
    for (const l of this.naviListeners) l.onTBTInfo?.(list);
  }

  private tbtList(): TBTInfo[] {
    if (!this.route || this.st.navStatus !== "ROUTE_DRIVE") return [];
    const m = nextManeuver(this.route, this.s);
    if (!m) return [];
    return [{ type: m.type, distance: Math.round(m.distanceM), description: m.type === "TURN_ARRIVE" ? "목적지" : `${m.roadName}${m.atName ? ` · ${m.atName}` : ""}` }];
  }

  private arriveWaypoint() {
    const w = this.wps.shift()!;
    this.setGear("P");
    const info: WaypointInfo = { ...this.wpInfo(w), remainDistance: 0, remainTime: 0 };
    this.log("event", "NaviHelper", `onWayPointArrived(${w.req.poiName})`);
    for (const l of this.naviListeners) l.onWayPointArrived?.(info);
    for (const l of this.naviListeners) l.onWayPointInfo?.(this.wps.map((x) => this.wpInfo(x)));
  }

  private arriveDestination() {
    this.setGear("P");
    this.log("event", "NaviHelper", "목적지 도착 (TURN_ARRIVE)");
    const done = this.dest;
    this.route = null;
    this.dest = null;
    this.wps = [];
    this.s = 0;
    this.setNavStatus("INACTIVE");
    for (const l of this.naviListeners) l.onDestinationInfo?.(null);
    if (done) for (const l of this.naviListeners) l.onDestinationArrived?.();
  }

  private setNavStatus(s: NavigationStatus) {
    if (this.st.navStatus === s) return;
    this.st.navStatus = s;
    this.log("event", "NaviHelper", `onNavigationStatus(${s})`);
    for (const l of this.naviListeners) l.onNavigationStatus?.(s);
  }

  private reroute() {
    if (!this.dest) return;
    const pts = [this.st.position, ...this.wps.map((w) => ({ lat: w.req.latitude, lng: w.req.longitude })), this.dest];
    const r = this.router.route(pts, this.st.routeOption);
    if (!r) throw new Error("CAUSE_SEARCH_ROUTE");
    this.route = r;
    this.s = 0;
    this.wps.forEach((w, i) => (w.alongM = r.viaAlongM[i] ?? r.distanceM));
    this.lastTbtKey = "";
  }

  // ───────── 가상 콘솔 조작 ─────────
  setGear(g: "P" | "D") {
    if (this.st.gear === g) return;
    this.st.gear = g;
    this.lastTick = this.clock.now();
    if (g === "D" && this.st.navStatus === "INACTIVE") this.setNavStatus(this.route ? "ROUTE_DRIVE" : "FREE_DRIVE");
    this.log("event", "CarUxRestrictions", `requiresDistractionOptimization=${g === "D"}`);
    for (const l of this.vListeners.restriction) l(g === "D");
    this.changed();
  }
  setRow2Occupied(v: boolean) {
    this.st.row2Occupied = v;
    this.log("event", "Seat", `onSeatOccupancyUpdated(ROW_2, ${v})`);
    for (const l of this.vListeners.seat) l(v);
    this.changed();
  }
  setRow3Occupied(v: boolean) {
    this.st.row3Occupied = v;
    this.log("event", "Seat", `onSeatOccupancyUpdated(ROW_3, ${v})`);
    for (const l of this.vListeners.seat3) l(v);
    this.changed();
  }
  pulseTurnSignal(v: TurnSignalValue, ms = 4000) {
    this.manual.signal = { v, until: this.clock.now() + ms * Math.max(1, this.clock.rate()) };
    this.driverBehavior(this.clock.now());
    this.changed();
  }
  pulseSteering(deg: number, ms = 3000) {
    this.manual.steer = { v: deg, until: this.clock.now() + ms * Math.max(1, this.clock.rate()) };
    this.driverBehavior(this.clock.now());
  }
  pulseBrake(ms = 2000) {
    this.manual.brake = { v: true, until: this.clock.now() + ms * Math.max(1, this.clock.rate()) };
    this.driverBehavior(this.clock.now());
  }
  setSoc(pct: number) {
    this.st.socPct = Math.max(0, Math.min(100, pct));
    this.lastSocInt = -1;
    for (const l of this.vListeners.soc) l(Math.round(this.st.socPct * 10) / 10);
    this.changed();
  }
  setTrunk(open: boolean) {
    this.st.trunkOpen = open;
    this.log("event", "Door", `트렁크 ${open ? "열림" : "닫힘"}`);
    for (const l of this.vListeners.trunk) l(open);
    this.changed();
  }
  setModel(model: string, hasModel = this.st.carInfoHasModel) {
    this.st.model = model;
    this.st.carInfoHasModel = hasModel;
    this.changed();
  }
  setAutoDriver(v: boolean) {
    this.st.autoDriver = v;
    this.changed();
  }
  /** 목적지 없이 달리기(FREE_DRIVE) — 정해진 길을 따라 달린다 */
  startFreeDrive(points: LatLng[]) {
    const r = this.router.route([this.st.position, ...points]);
    if (!r) return;
    this.route = r;
    this.s = 0;
    this.dest = null;
    this.wps = [];
    this.setNavStatus("FREE_DRIVE");
    for (const l of this.naviListeners) l.onDestinationInfo?.(null);
    this.changed();
  }
  teleport(p: LatLng) {
    this.st.position = { ...p };
    this.route = null;
    this.dest = null;
    this.wps = [];
    this.s = 0;
    this.setNavStatus("INACTIVE");
    this.changed();
  }

  // ───────── NaviPort ─────────
  private locationInfo(): CurrentLocationInfo {
    const near = this.router.graph.nearestNode(this.st.position);
    return { latitude: this.st.position.lat, longitude: this.st.position.lng, heading: Math.round(this.st.heading), address: near.node.name };
  }
  private wpInfo(w: ActiveWaypoint): WaypointInfo {
    const r = this.route;
    const remainDistance = r ? Math.max(0, w.alongM - this.s) : 0;
    const remainTime = r ? Math.max(0, timeAtAlong(r, w.alongM) - timeAtAlong(r, this.s)) : 0;
    return { name: w.req.poiName, address: w.req.address, latitude: w.req.latitude, longitude: w.req.longitude, remainDistance: Math.round(remainDistance), remainTime: Math.round(remainTime), poiId: w.req.poiId };
  }

  async getNavigationStatus() {
    return this.st.navStatus;
  }
  async getDestinationInfo(): Promise<DestinationInfo | null> {
    if (!this.dest || !this.route) return null;
    const r = this.route;
    return {
      latitude: this.dest.lat,
      longitude: this.dest.lng,
      name: this.dest.name,
      address: this.dest.name,
      remainDistance: Math.round(Math.max(0, r.distanceM - this.s)),
      remainTime: Math.round(Math.max(0, r.durationS - timeAtAlong(r, this.s))),
    };
  }
  async getCurrentLocationInfo() {
    return this.locationInfo();
  }
  async getWaypointInfo() {
    return this.wps.map((w) => this.wpInfo(w));
  }
  async getTBTInfo() {
    return this.tbtList();
  }
  async requestTrip(req: { latitude: number; longitude: number; poiId: string; poiName: string }): Promise<TripInfo> {
    this.log("call", "NaviHelper", `requestTrip(${req.poiName})`);
    const r = this.router.route([this.st.position, { lat: req.latitude, lng: req.longitude }]);
    if (!r) {
      for (const l of this.naviListeners) l.onError?.("CAUSE_SEARCH_TRIP");
      throw new Error("CAUSE_SEARCH_TRIP");
    }
    const km = r.distanceM / 1000;
    const rate = vehicleByModel(this.st.model)?.defaultSocPctPerKm ?? 0.22;
    const isEv = vehicleByModel(this.st.model)?.powertrain === "ev";
    const info: TripInfo = {
      distance: Math.round(r.distanceM),
      eta: Math.round(r.durationS),
      estimatedSocAtDest: isEv ? Math.round((this.st.socPct - km * rate * 1.05) * 10) / 10 : null,
      energyConsumption: isEv ? Math.round(km * 0.165 * 100) / 100 : null,
      summary: `${km.toFixed(1)}km · ${Math.round(r.durationS / 60)}분`,
    };
    this.log("event", "NaviHelper", `onTripInfo(distance=${info.distance}m, eta=${info.eta}s, soc=${info.estimatedSocAtDest ?? "-"}%)`);
    for (const l of this.naviListeners) l.onTripInfo?.(info);
    return info;
  }
  async addWaypoint(req: RequestWaypointInfo) {
    this.log("call", "NaviHelper", `addWaypoint(${req.poiName}, ${req.waypointIndex})`);
    if (!this.dest) {
      for (const l of this.naviListeners) l.onError?.("CAUSE_SEARCH_ROUTE");
      throw new Error("CAUSE_SEARCH_ROUTE");
    }
    if (this.wps.length >= 2) {
      for (const l of this.naviListeners) l.onError?.("CAUSE_SEARCH_ROUTE");
      throw new Error("경유지는 최대 2개");
    }
    const w: ActiveWaypoint = { req, alongM: 0 };
    if (req.waypointIndex === "FIRST") this.wps.unshift(w);
    else this.wps.push(w);
    this.reroute();
    await this.emitRouteChanged();
  }
  async removeWaypoint(idx: WaypointIndex) {
    this.log("call", "NaviHelper", `removeWaypoint(${idx})`);
    if (idx === "ALL") this.wps = [];
    else if (idx === "FIRST") this.wps.shift();
    else this.wps.splice(1, 1);
    this.reroute();
    await this.emitRouteChanged();
  }
  /** 경로가 바뀌면 내비가 하듯 경유지·목적지 정보를 바로 다시 알려 준다 */
  private async emitRouteChanged() {
    for (const l of this.naviListeners) l.onWayPointInfo?.(this.wps.map((x) => this.wpInfo(x)));
    const d = await this.getDestinationInfo();
    for (const l of this.naviListeners) l.onDestinationInfo?.(d);
    this.changed();
  }
  async requestRoute(dest: { latitude: number; longitude: number; name: string }) {
    this.log("call", "NaviHelper", `requestRoute(${dest.name})`);
    this.dest = { lat: dest.latitude, lng: dest.longitude, name: dest.name };
    this.wps = [];
    this.reroute();
    this.setNavStatus("ROUTE_DRIVE");
    const d = await this.getDestinationInfo();
    for (const l of this.naviListeners) l.onDestinationInfo?.(d);
    this.changed();
  }
  async requestRouteWithWaypoints(dest: { latitude: number; longitude: number; name: string }, waypoints: RequestWaypointInfo[]) {
    this.log("call", "NaviHelper", `requestRouteWithWaypoints(${dest.name}, 경유 ${waypoints.length})`);
    this.dest = { lat: dest.latitude, lng: dest.longitude, name: dest.name };
    this.wps = waypoints.slice(0, 2).map((req) => ({ req, alongM: 0 }));
    this.reroute();
    this.setNavStatus("ROUTE_DRIVE");
    const d = await this.getDestinationInfo();
    for (const l of this.naviListeners) l.onDestinationInfo?.(d);
    for (const l of this.naviListeners) l.onWayPointInfo?.(this.wps.map((x) => this.wpInfo(x)));
    this.changed();
  }
  async changeRouteOption(o: RouteOption) {
    this.log("call", "NaviHelper", `changeRouteOption(${o})`);
    this.st.routeOption = o;
    this.reroute();
    for (const l of this.naviListeners) l.onRouteOptionChanged?.(o);
    this.changed();
  }
  async cancelRoute() {
    this.log("call", "NaviHelper", "cancelRoute()");
    this.route = null;
    this.dest = null;
    this.wps = [];
    this.setNavStatus(this.st.gear === "D" ? "FREE_DRIVE" : "INACTIVE");
    this.changed();
  }
  addListener(l: NaviListener) {
    this.naviListeners.add(l);
    return () => this.naviListeners.delete(l);
  }

  // ───────── VehiclePort ─────────
  async carInfo(): Promise<CarInfo> {
    const kia = ["EV6", "EV9", "쏘렌토", "스포티지", "카니발", "레이"].includes(this.st.model);
    this.log("call", "Vehicle", "getCarInfo()");
    return { manufacturer: kia ? "Kia" : "Hyundai", model: this.st.carInfoHasModel ? this.st.model : null, modelYear: 2026 };
  }
  async capabilities(): Promise<Record<string, AccessType>> {
    this.log("call", "Vehicle", "check…Capabilities()");
    const ev = vehicleByModel(this.st.model)?.powertrain === "ev";
    return { Seat: "READ", EvBattery: ev ? "READ" : "NONE", Fuel: ev ? "NONE" : "READ", TurnSignal: "READ", SteeringWheel: "READ", Brake: "READ", Odometer: "READ", Door: "READ", CarInfo: "READ" };
  }
  registerSeatOccupancy(area: SeatValue[], cb: (v: boolean | null) => void) {
    this.log("call", "Vehicle", `Seat.registerSeatOccupancy(${area.join(",")})`);
    const row3 = area.some((a) => a.startsWith("ROW_3"));
    const set = row3 ? this.vListeners.seat3 : this.vListeners.seat;
    set.add(cb);
    cb(row3 ? this.st.row3Occupied : this.st.row2Occupied);
    return () => set.delete(cb);
  }
  async getEvBatteryStateOfCharge() {
    return vehicleByModel(this.st.model)?.powertrain === "ev" ? Math.round(this.st.socPct * 10) / 10 : null;
  }
  registerEvBatteryStateOfCharge(cb: (v: number | null) => void) {
    this.vListeners.soc.add(cb);
    cb(Math.round(this.st.socPct * 10) / 10);
    return () => this.vListeners.soc.delete(cb);
  }
  async getFuelRangeKm() {
    return vehicleByModel(this.st.model)?.powertrain === "ev" ? null : Math.round(this.st.socPct * 6);
  }
  registerTurnSignalState(cb: (v: TurnSignalValue | null) => void) {
    this.log("call", "Vehicle", "TurnSignal.registerTurnSignalState()");
    this.vListeners.signal.add(cb);
    cb(this.st.turnSignal);
    return () => this.vListeners.signal.delete(cb);
  }
  registerSteeringWheelAngle(cb: (v: number | null) => void) {
    this.log("call", "Vehicle", "SteeringWheel.registerSteeringWheelAngle()");
    this.vListeners.steer.add(cb);
    cb(this.st.steeringDeg);
    return () => this.vListeners.steer.delete(cb);
  }
  registerBrakePedalStatus(cb: (v: boolean | null) => void) {
    this.log("call", "Vehicle", "Brake.registerBrakePedalStatus()");
    this.vListeners.brake.add(cb);
    cb(this.st.brake);
    return () => this.vListeners.brake.delete(cb);
  }
  async getOdometerKm() {
    return Math.round(this.st.odometerKm * 10) / 10;
  }
  registerTrunkOpen(cb: (v: boolean | null) => void) {
    this.vListeners.trunk.add(cb);
    cb(this.st.trunkOpen);
    return () => this.vListeners.trunk.delete(cb);
  }

  // ───────── DrivingRestrictionPort ─────────
  requiresDistractionOptimization() {
    return this.st.gear === "D";
  }
  subscribe(cb: (v: boolean) => void) {
    this.vListeners.restriction.add(cb);
    return () => this.vListeners.restriction.delete(cb);
  }

  /** 지도 그리기용 스냅샷 */
  snapshot() {
    return {
      route: this.route,
      s: this.s,
      dest: this.dest,
      waypoints: this.wps.map((w) => ({ lat: w.req.latitude, lng: w.req.longitude, name: w.req.poiName, alongM: w.alongM })),
      ...this.st,
    };
  }

  /** 다른 위치까지 거리(m) — 콘솔 표시용 */
  distanceTo(p: LatLng) {
    return haversineM(this.st.position, p);
  }
}

export function createSimPlatform(clock: SimClock, voice: VoicePort, init?: ConstructorParameters<typeof SimCar>[1]): CarPlatform & { sim: SimCar } {
  const sim = new SimCar(clock, init);
  return { kind: "sim", navi: sim, vehicle: sim, restriction: sim, voice, onLog: (cb) => sim.onLog(cb), sim };
}
