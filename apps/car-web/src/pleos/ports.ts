/**
 * Pleos SDK 포트 — 차량 앱은 이 인터페이스로만 차와 대화한다.
 * 이름과 값은 공식 레퍼런스(Vehicle SDK 2.3.2, NaviHelper SDK 3.0.5)의 시그니처를 따른다(docs/API_MATRIX.md).
 *   - 브라우저: sim.ts (시뮬레이터 + 가상 콘솔)
 *   - Pleos Connect 에뮬레이터·실차: bridge.ts → Android 셸(apps/car-android)이 실제 SDK 호출
 */
import type { TurnType, RouteOption } from "@jhgo/core";

/** NaviHelper NavigationStatus */
export type NavigationStatus = "INACTIVE" | "INITIALIZING" | "FREE_DRIVE" | "ROUTE_DRIVE";

/** NaviHelper DestinationInfo (remainDistance m, remainTime s) */
export interface DestinationInfo {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  remainDistance: number;
  remainTime: number;
}

/** NaviHelper CurrentLocationInfo */
export interface CurrentLocationInfo {
  latitude: number;
  longitude: number;
  heading: number;
  address: string;
}

/** NaviHelper WaypointInfo */
export interface WaypointInfo {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  remainDistance: number;
  remainTime: number;
  poiId: string;
}

/** NaviHelper TBTInfo(type: TurnType, distance: Double, description: String) */
export interface TBTInfo {
  type: TurnType;
  distance: number;
  description: string;
}

/** NaviHelper TripInfo(distance, eta, estimatedSocAtDest, energyConsumption, summary) */
export interface TripInfo {
  distance: number;
  eta: number;
  estimatedSocAtDest: number | null;
  energyConsumption: number | null;
  summary: string;
}

export type WaypointIndex = "FIRST" | "SECOND" | "ALL";

/** NaviHelper RequestWaypointInfo */
export interface RequestWaypointInfo {
  latitude: number;
  longitude: number;
  poiName: string;
  waypointIndex: WaypointIndex;
  poiId: string;
  address: string;
  poiSubId: string;
  poiProvider: string;
}

/** NaviHelper NaviErrorCode */
export type NaviErrorCode =
  | "CAUSE_LOW_BATTERY"
  | "CAUSE_SEARCH_ROUTE_OVER_DISTANCE"
  | "CAUSE_SEARCH_ROUTE"
  | "CAUSE_SEARCH_ROUTE_TOO_SHORT_DISTANCE"
  | "CAUSE_SEARCH_TRIP";

export interface NaviListener {
  onNavigationStatus?(s: NavigationStatus): void;
  onDestinationInfo?(d: DestinationInfo | null): void;
  onCurrentLocationInfo?(l: CurrentLocationInfo): void;
  onWayPointInfo?(list: WaypointInfo[]): void;
  onWayPointArrived?(w: WaypointInfo): void;
  onTBTInfo?(list: TBTInfo[]): void;
  onTripInfo?(t: TripInfo): void;
  onRouteOptionChanged?(o: RouteOption): void;
  onError?(code: NaviErrorCode): void;
  /** 목적지 도착 — Pleos는 TURN_ARRIVE/내비 상태로 알 수 있다 */
  onDestinationArrived?(): void;
}

export interface NaviPort {
  getNavigationStatus(): Promise<NavigationStatus>;
  getDestinationInfo(): Promise<DestinationInfo | null>;
  getCurrentLocationInfo(): Promise<CurrentLocationInfo>;
  getWaypointInfo(): Promise<WaypointInfo[]>;
  getTBTInfo(): Promise<TBTInfo[]>;
  /** 안내를 바꾸지 않고 지점까지 거리·ETA·도착 배터리 예측 (권한 NAVI_ROUTE) */
  requestTrip(req: { latitude: number; longitude: number; poiId: string; poiName: string }): Promise<TripInfo>;
  /** 권한 NAVI_ROUTE_SEARCH, 경유지 최대 2개 */
  addWaypoint(req: RequestWaypointInfo): Promise<void>;
  removeWaypoint(idx: WaypointIndex): Promise<void>;
  requestRoute(dest: { latitude: number; longitude: number; name: string }): Promise<void>;
  requestRouteWithWaypoints(dest: { latitude: number; longitude: number; name: string }, waypoints: RequestWaypointInfo[]): Promise<void>;
  changeRouteOption(o: RouteOption): Promise<void>;
  cancelRoute(): Promise<void>;
  addListener(l: NaviListener): () => void;
}

/** Vehicle CapabilityConfig.accessType */
export type AccessType = "NONE" | "READ" | "WRITE" | "READ_WRITE";
/** Vehicle SeatValue */
export type SeatValue = "ROW_1_LEFT" | "ROW_1_RIGHT" | "ROW_2_LEFT" | "ROW_2_CENTER" | "ROW_2_RIGHT" | "ROW_3_LEFT" | "ROW_3_RIGHT";
/** Vehicle TurnSignalValue */
export type TurnSignalValue = "OFF" | "LEFT" | "RIGHT";

export interface CarInfo {
  manufacturer: string | null;
  model: string | null;
  modelYear: number | null;
}

export interface VehiclePort {
  /** Vehicle.getCarInfo() — 모델명 제공 여부는 확인 필요(API_MATRIX) */
  carInfo(): Promise<CarInfo>;
  /** 도메인별 check…Capabilities 결과 */
  capabilities(): Promise<Record<string, AccessType>>;
  /** Seat.registerSeatOccupancy(area, listener) → onSeatOccupancyUpdated(Boolean?) */
  registerSeatOccupancy(area: SeatValue[], cb: (occupied: boolean | null) => void): () => void;
  /** EvBattery.getEvBatteryStateOfCharge → % */
  getEvBatteryStateOfCharge(): Promise<number | null>;
  registerEvBatteryStateOfCharge(cb: (pct: number | null) => void): () => void;
  /** Fuel — 주행 가능 거리(제공 항목 확인 필요) */
  getFuelRangeKm(): Promise<number | null>;
  /** TurnSignal.registerTurnSignalState → onTurnSignalStateUpdated(TurnSignalValue?) */
  registerTurnSignalState(cb: (s: TurnSignalValue | null) => void): () => void;
  /** SteeringWheel.registerSteeringWheelAngle → 전륜 조향각(°), 좌측 음수 */
  registerSteeringWheelAngle(cb: (deg: number | null) => void): () => void;
  /** Brake.registerBrakePedalStatus → Boolean? */
  registerBrakePedalStatus(cb: (pressed: boolean | null) => void): () => void;
  /** Odometer — km */
  getOdometerKm(): Promise<number | null>;
  /** Door 도메인 트렁크 열림 (차량 안 SDK 제공 여부 확인 필요) */
  registerTrunkOpen(cb: (open: boolean | null) => void): () => void;
}

/** AAOS CarUxRestrictionsManager.getCurrentCarUxRestrictions().isRequiresDistractionOptimization */
export interface DrivingRestrictionPort {
  requiresDistractionOptimization(): boolean;
  subscribe(cb: (requiresDO: boolean) => void): () => void;
}

export interface VoicePort {
  readonly tts: boolean;
  readonly stt: boolean;
  speak(text: string): Promise<void>;
  /** 정해진 단어 중 하나를 듣는다(못 들으면 null) */
  listen(words: string[], timeoutMs: number): Promise<string | null>;
  /** 자유로운 한 마디를 듣는다 — 대화로 고르기(T34). 못 들으면 null */
  listenFree(timeoutMs: number): Promise<string | null>;
  stop(): void;
  /** 시뮬레이터 전용: 마이크 대신 이 말을 들은 것으로 친다(듣는 중이 아니면 false). 실제 SDK 모드에는 없다 */
  hear?(word: string): boolean;
}

export interface SdkLogEntry {
  at: number;
  dir: "call" | "event" | "info";
  api: string;
  text: string;
}

export interface CarPlatform {
  kind: "sim" | "bridge";
  navi: NaviPort;
  vehicle: VehiclePort;
  restriction: DrivingRestrictionPort;
  voice: VoicePort;
  /** SDK 호출·이벤트 기록 (가상 콘솔에 표시) */
  onLog(cb: (e: SdkLogEntry) => void): () => void;
}
