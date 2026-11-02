/**
 * Android 셸(apps/car-android) 브리지 — WebView에 주입된 window.PleosBridge가 실제 Pleos SDK를 부른다.
 *   JS → Kotlin: PleosBridge.call(id, method, argsJson)
 *   Kotlin → JS: window.__pleos.resolve(id, okJson) / reject(id, message) / emit(event, json)
 * 메서드 이름은 ports.ts와 같다. Kotlin 쪽 구현: apps/car-android/app/src/main/java/.../PleosBridge.kt
 */
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
import type { RouteOption } from "@jhgo/core";

interface NativeBridge {
  call(id: string, method: string, argsJson: string): void;
}

declare global {
  interface Window {
    PleosBridge?: NativeBridge;
    __pleos?: {
      resolve(id: string, json: string): void;
      reject(id: string, message: string): void;
      emit(event: string, json: string): void;
    };
  }
}

export function hasNativeBridge(): boolean {
  return typeof window !== "undefined" && !!window.PleosBridge;
}

export function createBridgePlatform(voice: VoicePort, now: () => number = () => Date.now()): CarPlatform {
  const native = window.PleosBridge!;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const logs = new Set<(e: SdkLogEntry) => void>();
  let seq = 0;
  let requiresDO = true;

  const log = (dir: SdkLogEntry["dir"], api: string, text: string) => logs.forEach((l) => l({ at: now(), dir, api, text }));
  const on = (event: string, fn: (v: unknown) => void) => {
    let s = listeners.get(event);
    if (!s) listeners.set(event, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  };
  window.__pleos = {
    resolve(id, json) {
      pending.get(id)?.resolve(json ? JSON.parse(json) : null);
      pending.delete(id);
    },
    reject(id, message) {
      pending.get(id)?.reject(new Error(message));
      pending.delete(id);
    },
    emit(event, json) {
      const v = json ? JSON.parse(json) : null;
      if (event === "restriction") requiresDO = !!v;
      if (shouldLog(event, v)) log("event", event.split(".")[0], `${event} ${json?.slice(0, 120) ?? ""}`);
      listeners.get(event)?.forEach((f) => f(v));
    },
  };
  // 자주 오는 이벤트(TBT·목적지·경유지 갱신·조향각)는 내용이 바뀔 때만, 그래도 30초에 한 번은 남긴다
  const lastLogged = new Map<string, { key: string; at: number }>();
  function shouldLog(event: string, v: unknown): boolean {
    const keyOf = NOISY[event];
    if (!keyOf) return true;
    const key = keyOf(v);
    const prev = lastLogged.get(event);
    const t = Date.now();
    if (prev && prev.key === key && t - prev.at < 30_000) return false;
    lastLogged.set(event, { key, at: t });
    return true;
  }

  function call<T>(method: string, args: unknown = {}, timeoutMs = 8000): Promise<T> {
    const id = `c${++seq}`;
    // 1초마다 부르는 조회는 기록하지 않는다(로그가 조회로 덮이지 않게)
    if (!QUIET.has(method)) log("call", method.split(".")[0], `${method}${describeArgs(args)}`);
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      native.call(id, method, JSON.stringify(args));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} 응답 없음`));
        }
      }, timeoutMs);
    });
  }
  const sub = <T>(method: string, event: string, cb: (v: T) => void, args: unknown = {}) => {
    const off = on(event, (v) => cb(v as T));
    call(method, args).catch(() => cb(null as T));
    return off;
  };

  const navi: NaviPort = {
    getNavigationStatus: () => call<NavigationStatus>("NaviHelper.getNavigationStatus"),
    getDestinationInfo: () => call<DestinationInfo | null>("NaviHelper.getDestinationInfo"),
    getCurrentLocationInfo: () => call<CurrentLocationInfo>("NaviHelper.getCurrentLocationInfo"),
    getWaypointInfo: () => call<WaypointInfo[]>("NaviHelper.getWaypointInfo"),
    getTBTInfo: () => call<TBTInfo[]>("NaviHelper.getTBTInfo"),
    requestTrip: (req) => call<TripInfo>("NaviHelper.requestTrip", req),
    addWaypoint: (req: RequestWaypointInfo) => call<void>("NaviHelper.addWaypoint", req),
    removeWaypoint: (idx: WaypointIndex) => call<void>("NaviHelper.removeWaypoint", { idx }),
    requestRoute: (dest) => call<void>("NaviHelper.requestRoute", dest),
    requestRouteWithWaypoints: (dest, waypoints) => call<void>("NaviHelper.requestRouteWithWaypoints", { dest, waypoints }),
    changeRouteOption: (o: RouteOption) => call<void>("NaviHelper.changeRouteOption", { option: o }),
    cancelRoute: () => call<void>("NaviHelper.cancelRoute"),
    addListener(l: NaviListener) {
      const offs = [
        on("NaviHelper.onNavigationStatus", (v) => l.onNavigationStatus?.(v as NavigationStatus)),
        on("NaviHelper.onDestinationInfo", (v) => l.onDestinationInfo?.(v as DestinationInfo | null)),
        on("NaviHelper.onCurrentLocationInfo", (v) => l.onCurrentLocationInfo?.(v as CurrentLocationInfo)),
        on("NaviHelper.onWayPointInfo", (v) => l.onWayPointInfo?.(v as WaypointInfo[])),
        on("NaviHelper.onWayPointArrived", (v) => l.onWayPointArrived?.(v as WaypointInfo)),
        on("NaviHelper.onTBTInfo", (v) => l.onTBTInfo?.(v as TBTInfo[])),
        on("NaviHelper.onTripInfo", (v) => l.onTripInfo?.(v as TripInfo)),
        on("NaviHelper.onRouteOptionChanged", (v) => l.onRouteOptionChanged?.(v as RouteOption)),
        on("NaviHelper.onError", (v) => l.onError?.(v as never)),
        on("NaviHelper.onDestinationArrived", () => l.onDestinationArrived?.()),
      ];
      return () => offs.forEach((o) => o());
    },
  };

  const vehicle: VehiclePort = {
    carInfo: () => call<CarInfo>("Vehicle.getCarInfo"),
    capabilities: () => call<Record<string, AccessType>>("Vehicle.capabilities"),
    registerSeatOccupancy: (area: SeatValue[], cb) => sub("Vehicle.registerSeatOccupancy", "Vehicle.onSeatOccupancyUpdated", cb, { area }),
    getEvBatteryStateOfCharge: () => call<number | null>("Vehicle.getEvBatteryStateOfCharge"),
    registerEvBatteryStateOfCharge: (cb) => sub("Vehicle.registerEvBatteryStateOfCharge", "Vehicle.onEvBatteryStateOfChargeUpdated", cb),
    getFuelRangeKm: () => call<number | null>("Vehicle.getFuelRangeKm"),
    registerTurnSignalState: (cb) => sub<TurnSignalValue | null>("Vehicle.registerTurnSignalState", "Vehicle.onTurnSignalStateUpdated", cb),
    registerSteeringWheelAngle: (cb) => sub("Vehicle.registerSteeringWheelAngle", "Vehicle.onSteeringWheelAngleUpdated", cb),
    registerBrakePedalStatus: (cb) => sub("Vehicle.registerBrakePedalStatus", "Vehicle.onBrakePedalStatusUpdated", cb),
    getOdometerKm: () => call<number | null>("Vehicle.getOdometerKm"),
    registerTrunkOpen: (cb) => sub("Vehicle.registerTrunkOpen", "Vehicle.onTrunkOpenUpdated", cb),
  };

  const restriction: DrivingRestrictionPort = {
    requiresDistractionOptimization: () => requiresDO,
    subscribe(cb) {
      const off = on("restriction", (v) => cb(!!v));
      call<boolean>("CarUx.current").then((v) => {
        requiresDO = !!v;
        cb(requiresDO);
      });
      return off;
    },
  };

  return { kind: "bridge", navi, vehicle, restriction, voice: createNativeVoice(call, voice), onLog: (cb) => (logs.add(cb), () => logs.delete(cb)) };
}

const NOISY: Record<string, (v: unknown) => string> = {
  "NaviHelper.onTBTInfo": (v) => {
    const t = (v as TBTInfo[] | null)?.[0];
    return t ? `${t.type}|${t.description}` : "";
  },
  "NaviHelper.onDestinationInfo": (v) => (v as DestinationInfo | null)?.name ?? "",
  "NaviHelper.onWayPointInfo": (v) => ((v as WaypointInfo[] | null) ?? []).map((w) => w.name).join(","),
  "NaviHelper.onCurrentLocationInfo": () => "",
  "Vehicle.onSteeringWheelAngleUpdated": (v) => String(Math.round(Number(v) / 10)),
  "Vehicle.onEvBatteryStateOfChargeUpdated": (v) => String(v),
};

const QUIET = new Set([
  "NaviHelper.getNavigationStatus",
  "NaviHelper.getCurrentLocationInfo",
  "NaviHelper.getDestinationInfo",
  "NaviHelper.getWaypointInfo",
  "Vehicle.getEvBatteryStateOfCharge",
  "Vehicle.getFuelRangeKm",
]);

function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object" || Object.keys(args as object).length === 0) return "";
  const a = args as Record<string, unknown>;
  const name = a.poiName ?? a.text ?? a.option ?? a.idx;
  return name ? `(${String(name).slice(0, 40)})` : "";
}

/**
 * 음성: 셸이 Pleos TextToSpeech(ON_DEVICE)를 먼저, 안 되면 안드로이드 TTS를 쓴다(Kotlin 쪽 판단).
 * 듣기는 안드로이드 SpeechRecognizer — Pleos SpeechToText는 사용 신청 준비 중.
 * 셸이 음성을 못 쓰면 웹 음성(Web Speech API)으로 내려간다.
 */
function createNativeVoice(call: <T>(method: string, args?: unknown, timeoutMs?: number) => Promise<T>, fallback: VoicePort): VoicePort {
  let caps = { tts: false, stt: false };
  call<{ tts: boolean; stt: boolean }>("Voice.capabilities", {}, 6000)
    .then((c) => (caps = { tts: !!c?.tts, stt: !!c?.stt }))
    .catch(() => {});
  return {
    get tts() {
      return caps.tts || fallback.tts;
    },
    get stt() {
      return caps.stt || fallback.stt;
    },
    async speak(text) {
      if (!caps.tts) return fallback.speak(text);
      await call("Voice.speak", { text }, Math.min(30000, 4000 + text.length * 200)).catch(() => fallback.speak(text));
    },
    async listen(words, timeoutMs) {
      if (!caps.stt) return fallback.listen(words, timeoutMs);
      return call<string | null>("Voice.listen", { words, timeoutMs }, timeoutMs + 4000).catch(() => null);
    },
    stop() {
      if (caps.tts) void call("Voice.stop").catch(() => {});
      fallback.stop();
    },
  };
}
