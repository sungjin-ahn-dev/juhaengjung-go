/** 서버 기반 요소 — 시계, 저장소(메모리), 이벤트 버스. 브라우저에서도 그대로 동작한다. */

export interface Clock {
  now(): number;
  rate(): number;
  readonly demo: boolean;
}

export class RealClock implements Clock {
  readonly demo = false;
  now() {
    return Date.now();
  }
  rate() {
    return 1;
  }
}

/**
 * 시연용 시계 — 가상 시각이 실제 시간 × 배속으로 흐른다.
 * 차량 시뮬레이터·판매자 화면·서버가 모두 이 시각을 기준으로 삼아 "도착 예정 18:52"가 서로 맞는다.
 */
export class DemoClock implements Clock {
  readonly demo = true;
  private baseVirtual: number;
  private baseReal: number;
  private r: number;
  constructor(startVirtual: number, rate = 1, private realNow: () => number = () => Date.now()) {
    this.baseVirtual = startVirtual;
    this.baseReal = realNow();
    this.r = rate;
  }
  now() {
    return Math.round(this.baseVirtual + (this.realNow() - this.baseReal) * this.r);
  }
  rate() {
    return this.r;
  }
  set(virtual: number) {
    this.baseVirtual = virtual;
    this.baseReal = this.realNow();
  }
  setRate(rate: number) {
    this.baseVirtual = this.now();
    this.baseReal = this.realNow();
    this.r = Math.max(0, Math.min(120, rate));
  }
}

/** 테스트용: 손으로 돌리는 시계 */
export class ManualClock implements Clock {
  readonly demo = true;
  constructor(public t: number) {}
  now() {
    return this.t;
  }
  rate() {
    return 1;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** config: 서버 설정(웹 푸시 키 등 — 시연 초기화에도 남긴다), push: 판매자 웹 푸시 구독 */
export type Collection = "users" | "listings" | "interests" | "trades" | "trust" | "ledger" | "events" | "push" | "config";

export interface Store {
  get<T>(col: Collection, id: string): T | undefined;
  put<T extends { id: string }>(col: Collection, doc: T): T;
  list<T>(col: Collection, pred?: (d: T) => boolean): T[];
  remove(col: Collection, id: string): void;
  /** 여러 쓰기를 한 번에 — SQLite에서는 트랜잭션 */
  tx<R>(fn: () => R): R;
  clear(): void;
}

export class MemoryStore implements Store {
  protected data = new Map<Collection, Map<string, unknown>>();
  private col(c: Collection) {
    let m = this.data.get(c);
    if (!m) {
      m = new Map();
      this.data.set(c, m);
    }
    return m;
  }
  get<T>(c: Collection, id: string): T | undefined {
    const v = this.col(c).get(id);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  put<T extends { id: string }>(c: Collection, doc: T): T {
    this.col(c).set(doc.id, structuredClone(doc));
    return doc;
  }
  list<T>(c: Collection, pred?: (d: T) => boolean): T[] {
    const out: T[] = [];
    for (const v of this.col(c).values()) {
      const d = structuredClone(v) as T;
      if (!pred || pred(d)) out.push(d);
    }
    return out;
  }
  remove(c: Collection, id: string) {
    this.col(c).delete(id);
  }
  tx<R>(fn: () => R): R {
    return fn();
  }
  /** 시연 초기화 — 설정(config)은 남긴다(웹 푸시 키가 바뀌면 판매자 폰 구독이 끊긴다) */
  clear() {
    for (const k of [...this.data.keys()]) if (k !== "config") this.data.delete(k);
  }
}

export interface AppEvent {
  id: string;
  userId: string;
  type: string;
  at: number;
  tradeId?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export class EventBus {
  private subs = new Map<string, Set<(e: AppEvent) => void>>();
  subscribe(userId: string, fn: (e: AppEvent) => void): () => void {
    let s = this.subs.get(userId);
    if (!s) {
      s = new Set();
      this.subs.set(userId, s);
    }
    s.add(fn);
    return () => s!.delete(fn);
  }
  publish(e: AppEvent) {
    for (const fn of this.subs.get(e.userId) ?? []) {
      try {
        fn(e);
      } catch {
        /* 구독자 오류는 무시 */
      }
    }
  }
  count(userId: string) {
    return this.subs.get(userId)?.size ?? 0;
  }
}

export function newId(prefix: string): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${raw.replace(/-/g, "").slice(0, 12)}`;
}

export function newToken(): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() + crypto.randomUUID() : Math.random().toString(36).repeat(3);
  return raw.replace(/-/g, "");
}

/** "박서연" → "박*연" */
export function maskName(name: string): string {
  const s = [...name];
  if (s.length <= 1) return name;
  if (s.length === 2) return s[0] + "*";
  return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
}
