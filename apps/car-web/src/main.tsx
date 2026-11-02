import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHttpClient, createSyncedClock, type ApiClient, type AppClock } from "@jhgo/api";
import { CarApp, bootCar } from "./CarApp.tsx";

async function start() {
  const params = new URLSearchParams(location.search);
  let client: ApiClient;
  let clock: AppClock;
  let onReset: () => void;
  if (params.has("local")) {
    // 서버 없이 페이지 안에서 서버 코드를 그대로 돌린다
    const { createLocalBackend, createDirectClock } = await import("@jhgo/api/browser");
    const b = createLocalBackend();
    client = b.client();
    clock = createDirectClock(b.clock as never);
    onReset = () => location.reload();
  } else {
    const base = params.get("api") ?? location.origin;
    client = createHttpClient(base);
    clock = createSyncedClock(client);
    onReset = async () => {
      await client.call("POST", "/v1/demo/reset", {});
      try {
        localStorage.removeItem("jhgo.car.token");
      } catch {
        /* 무시 */
      }
      location.reload();
    };
  }
  const boot = bootCar(client, clock);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <CarApp boot={boot} onReset={onReset} />
    </StrictMode>,
  );
}

void start();
