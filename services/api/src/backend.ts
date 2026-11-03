/** 서비스·API·시계·버스를 한 번에 조립한다. Node 서버와 브라우저 시연이 같이 쓴다. */
import { DEMO_NET, Graph, GraphRouter, type RoutingProvider } from "@jhgo/core";
import { createApp } from "./app.ts";
import { DemoClock, EventBus, MemoryStore, RealClock, type Clock, type Store } from "./infra.ts";
import { DEMO_START, seedDemo } from "./seed.ts";
import { Service, type ServiceConfig } from "./service.ts";

export interface BackendOptions {
  /** 시드에 박서연의 카시트를 넣을지(기본 넣음). 체험에서 같이 올리기부터 보여 줄 때 끈다 */
  includeCarSeat?: boolean;
  demo?: boolean;
  store?: Store;
  clock?: Clock;
  router?: RoutingProvider;
  config?: Partial<ServiceConfig>;
  seed?: boolean;
  /** 시연 시계 배속 */
  rate?: number;
  sseHeartbeatMs?: number;
}

/** 시연 모드 기본값: 정산·자동 확인을 짧게(가상 시간) */
export const DEMO_SERVICE_CONFIG: Partial<ServiceConfig> = {
  trade: {
    comeOutBeforeS: 180,
    noShowGraceMs: 20 * 60_000,
    autoConfirmMs: 20 * 60_000,
    settleAfterMs: 10 * 60_000,
    etaNotifyDeltaMs: 60_000,
    minRequestTtlMs: 2 * 60_000,
    maxRequestTtlMs: 20 * 60_000,
  },
};

export function createRouter(): RoutingProvider {
  // 실제 서비스: 외부 길찾기 API(카카오모빌리티·TMAP 등)를 같은 인터페이스로 붙인다(키 필요, 미구현).
  return new GraphRouter(new Graph(DEMO_NET));
}

export function createBackend(o: BackendOptions = {}) {
  const demo = o.demo ?? true;
  const store = o.store ?? new MemoryStore();
  const clock = o.clock ?? (demo ? new DemoClock(DEMO_START, o.rate ?? 1) : new RealClock());
  const bus = new EventBus();
  const svc = new Service({ store, bus, clock, router: o.router ?? createRouter(), config: o.config ?? (demo ? DEMO_SERVICE_CONFIG : undefined) });
  if (o.seed && store.list("users").length === 0) seedDemo(svc, { includeCarSeat: o.includeCarSeat });
  const app = createApp(svc, { demo, sseHeartbeatMs: o.sseHeartbeatMs });
  return { app, svc, store, clock, bus };
}

export type Backend = ReturnType<typeof createBackend>;
