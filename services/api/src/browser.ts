/** 브라우저 시연: 서버 코드를 페이지 안에서 그대로 돌린다(메모리 저장소 + 가상 시계). */
import { createBackend } from "./backend.ts";
import { createLocalClient } from "./client.ts";

export function createLocalBackend(opts: { rate?: number; includeCarSeat?: boolean } = {}) {
  const b = createBackend({ demo: true, seed: true, rate: opts.rate ?? 1, includeCarSeat: opts.includeCarSeat });
  const timer = setInterval(() => b.svc.tick(), 500);
  return {
    ...b,
    client: (token: string | null = null) => createLocalClient(b, token),
    stop: () => clearInterval(timer),
  };
}

export { createLocalClient, createHttpClient, createSyncedClock, createDirectClock } from "./client.ts";
export type { ApiClient, AppClock } from "./client.ts";
