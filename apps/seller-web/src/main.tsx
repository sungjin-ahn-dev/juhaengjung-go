import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHttpClient, createSyncedClock, type ApiClient, type AppClock } from "@jhgo/api";
import { SellerApp } from "./SellerApp.tsx";

async function start() {
  const params = new URLSearchParams(location.search);
  let client: ApiClient;
  let clock: AppClock;
  if (params.has("local")) {
    const { createLocalBackend, createDirectClock } = await import("@jhgo/api/browser");
    const b = createLocalBackend();
    client = b.client();
    clock = createDirectClock(b.clock as never);
  } else {
    client = createHttpClient(params.get("api") ?? location.origin);
    clock = createSyncedClock(client);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SellerApp client={client} clock={clock} />
    </StrictMode>,
  );
}

void start();
