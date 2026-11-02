/** 차량 앱 조립 — 시뮬레이터(브라우저) 또는 Android 브리지(에뮬레이터·실차) 위에서 동작 */
import { useEffect, useMemo } from "react";
import { DEMO_PLACES } from "@jhgo/core";
import type { ApiClient, AppClock } from "@jhgo/api";
import { CarController } from "./controller.ts";
import { createBridgePlatform, hasNativeBridge } from "./pleos/bridge.ts";
import { createSimPlatform, type SimCar } from "./pleos/sim.ts";
import { createWebVoice } from "./pleos/voice.ts";
import { CarScreen } from "./ui/CarScreen.tsx";
import { VirtualConsole } from "./ui/VirtualConsole.tsx";
import "./styles.css";

export interface CarBoot {
  controller: CarController;
  sim: SimCar | null;
  clock: AppClock;
}

export function bootCar(client: ApiClient, clock: AppClock, opts: { storageKey?: string } = {}): CarBoot {
  let muted = false;
  const voice = createWebVoice({ muted: () => muted });
  if (hasNativeBridge()) {
    const platform = createBridgePlatform(voice, () => clock.now());
    const controller = new CarController(platform, client, clock, { storageKey: opts.storageKey });
    return { controller, sim: null, clock };
  }
  const platform = createSimPlatform(clock, voice, { position: { lat: DEMO_PLACES.start.lat, lng: DEMO_PLACES.start.lng } });
  const controller = new CarController(platform, client, clock, { storageKey: opts.storageKey });
  controller.subscribe(() => {
    muted = controller.state.muted;
  });
  platform.sim.start();
  return { controller, sim: platform.sim, clock };
}

export function CarApp({ boot, onReset, showConsole = true }: { boot: CarBoot; onReset?: () => void; showConsole?: boolean }) {
  useEffect(() => {
    void boot.controller.init();
    return () => boot.controller.dispose();
  }, [boot]);
  const now = useMemo(() => () => boot.clock.now(), [boot]);
  return (
    <div className="c-shell">
      <CarScreen c={boot.controller} sim={boot.sim} now={now} />
      {boot.sim && showConsole && <VirtualConsole sim={boot.sim} clock={boot.clock} onReset={onReset} />}
    </div>
  );
}
