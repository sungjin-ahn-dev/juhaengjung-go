/** 차량 앱 조립 — 시뮬레이터(브라우저) 또는 Android 브리지(에뮬레이터·실차) 위에서 동작 */
import { useEffect, useMemo, useState } from "react";
import { DEMO_PLACES } from "@jhgo/core";
import type { ApiClient, AppClock } from "@jhgo/api";
import { CarController } from "./controller.ts";
import { createBridgePlatform, hasNativeBridge } from "./pleos/bridge.ts";
import { createSimPlatform, type SimCar } from "./pleos/sim.ts";
import type { CarPlatform, SdkLogEntry } from "./pleos/ports.ts";
import { fmtClock } from "./ui/format.ts";
import { createWebVoice } from "./pleos/voice.ts";
import { CarScreen } from "./ui/CarScreen.tsx";
import { VirtualConsole } from "./ui/VirtualConsole.tsx";
import "../../seller-web/src/font.css";
import "./styles.css";

export interface CarBoot {
  controller: CarController;
  sim: SimCar | null;
  clock: AppClock;
  platform: CarPlatform;
}

export function bootCar(client: ApiClient, clock: AppClock, opts: { storageKey?: string } = {}): CarBoot {
  let muted = false;
  const voice = createWebVoice({ muted: () => muted, sim: !hasNativeBridge() });
  if (hasNativeBridge()) {
    const platform = createBridgePlatform(voice, () => clock.now());
    const controller = new CarController(platform, client, clock, { storageKey: opts.storageKey });
    controller.subscribe(() => {
      muted = controller.state.muted;
    });
    return { controller, sim: null, clock, platform };
  }
  const platform = createSimPlatform(clock, voice, { position: { lat: DEMO_PLACES.start.lat, lng: DEMO_PLACES.start.lng } });
  const controller = new CarController(platform, client, clock, { storageKey: opts.storageKey });
  controller.subscribe(() => {
    muted = controller.state.muted;
  });
  platform.sim.start();
  return { controller, sim: platform.sim, clock, platform };
}

export function CarApp({ boot, onReset, showConsole = true }: { boot: CarBoot; onReset?: () => void; showConsole?: boolean }) {
  useEffect(() => {
    (window as unknown as { __jhgoCar?: CarBoot }).__jhgoCar = boot; // 점검용
    void boot.controller.init();
    return () => boot.controller.dispose();
  }, [boot]);
  const now = useMemo(() => () => boot.clock.now(), [boot]);
  // 실기기 배치(화면 가득)는 SDK 모드에서, 시뮬레이터에서는 `?device`로 미리 본다(1920×720 같은 화면 확인용)
  const device = !boot.sim || (typeof location !== "undefined" && new URLSearchParams(location.search).has("device"));
  return (
    <div className={`c-shell ${device ? "device" : ""}`}>
      <CarScreen c={boot.controller} sim={boot.sim} now={now} />
      {boot.sim && showConsole && !device && <VirtualConsole sim={boot.sim} clock={boot.clock} controller={boot.controller} hear={(w) => !!boot.platform.voice.hear?.(w)} onReset={onReset} />}
      {!boot.sim && <SdkLogDrawer platform={boot.platform} />}
    </div>
  );
}

/** 실제 SDK(Android 셸)로 돌 때: 호출·이벤트 기록을 접었다 펴는 서랍 — 시연 때 SDK를 실제로 부르는지 보여 준다 */
function SdkLogDrawer({ platform }: { platform: CarPlatform }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<SdkLogEntry[]>([]);
  useEffect(() => platform.onLog((e) => setLogs((l) => [...l.slice(-300), e])), [platform]);
  return (
    <>
      <button className="c-sdklog-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        SDK 기록 {logs.length}
      </button>
      {open && (
        <aside className="c-sdklog" aria-label="SDK 호출·이벤트 기록">
          {logs
            .slice()
            .reverse()
            .map((l, i) => (
              <div key={i} className={l.dir}>
                {fmtClock(l.at)} {l.dir === "call" ? "→" : "←"} {l.text}
              </div>
            ))}
        </aside>
      )}
    </>
  );
}
