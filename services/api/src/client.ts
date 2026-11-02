/**
 * 앱에서 쓰는 API 클라이언트.
 *  - createHttpClient: 서버에 fetch + SSE(EventSource)
 *  - createLocalClient: 같은 페이지 안 백엔드(app.fetch)에 직접 — 브라우저 시연용
 */
import type { AppEvent } from "./infra.ts";

export interface ApiClient {
  readonly kind: "http" | "local";
  token(): string | null;
  setToken(t: string | null): void;
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** 내 알림 구독. 반환값으로 구독 해제 */
  subscribe(onEvent: (e: AppEvent) => void, onState?: (s: "open" | "closed") => void): () => void;
  /** 서버 시계 (가상 시계 포함) */
  clock(): Promise<{ now: number; rate: number; demo: boolean }>;
}

export class ApiCallError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiCallError(res.status, data.error ?? "error", data.message ?? `오류 ${res.status}`);
  return data as T;
}

export function createHttpClient(base: string, initialToken: string | null = null): ApiClient {
  let tok = initialToken;
  const root = base.replace(/\/$/, "");
  return {
    kind: "http",
    token: () => tok,
    setToken: (t) => {
      tok = t;
    },
    async call<T>(method: string, path: string, body?: unknown) {
      const res = await fetch(root + path, {
        method,
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return parse<T>(res);
    },
    subscribe(onEvent, onState) {
      if (!tok) return () => {};
      let es: EventSource | null = null;
      let stopped = false;
      let retry = 1000;
      const open = () => {
        if (stopped) return;
        es = new EventSource(`${root}/v1/stream?token=${encodeURIComponent(tok!)}`);
        es.addEventListener("hello", () => {
          retry = 1000;
          onState?.("open");
        });
        es.addEventListener("app", (m) => {
          try {
            onEvent(JSON.parse((m as MessageEvent).data));
          } catch {
            /* 무시 */
          }
        });
        es.onerror = () => {
          onState?.("closed");
          es?.close();
          if (!stopped) setTimeout(open, (retry = Math.min(retry * 2, 15000)));
        };
      };
      open();
      return () => {
        stopped = true;
        es?.close();
      };
    },
    clock() {
      return this.call("GET", "/v1/clock");
    },
  };
}

export interface LocalBackendLike {
  app: { fetch: (req: Request) => Response | Promise<Response> };
  bus: { subscribe(userId: string, fn: (e: AppEvent) => void): () => void };
  svc: { userByToken(t: string | null | undefined): { id: string } | undefined };
  clock: { now(): number; rate(): number; demo: boolean };
}

export function createLocalClient(b: LocalBackendLike, initialToken: string | null = null): ApiClient {
  let tok = initialToken;
  return {
    kind: "local",
    token: () => tok,
    setToken: (t) => {
      tok = t;
    },
    async call<T>(method: string, path: string, body?: unknown) {
      const res = await b.app.fetch(
        new Request("http://local" + path, {
          method,
          headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return parse<T>(res);
    },
    subscribe(onEvent, onState) {
      const u = b.svc.userByToken(tok);
      if (!u) return () => {};
      const off = b.bus.subscribe(u.id, (e) => setTimeout(() => onEvent(e), 0));
      setTimeout(() => onState?.("open"), 0);
      return () => {
        off();
        onState?.("closed");
      };
    },
    async clock() {
      return { now: b.clock.now(), rate: b.clock.rate(), demo: b.clock.demo };
    },
  };
}
