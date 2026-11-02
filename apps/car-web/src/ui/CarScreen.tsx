/** 차량 화면(1280×720 기준, 창 크기에 맞춰 축소) */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEMO_NET, Graph, GraphRouter, pointAtAlong, projectOnPolyline, type Route } from "@jhgo/core";
import type { CarController, CarState } from "../controller.ts";
import type { SimCar } from "../pleos/sim.ts";
import { GoPanel } from "./GoPanel.tsx";
import { BatteryIcon, RailIcon, TurnIcon } from "./icons.tsx";
import { MapView, type MapSnapshot } from "./MapView.tsx";
import { fmtClock, fmtKm, fmtMin } from "./format.ts";
import { Sheet } from "./Sheets.tsx";

export function useCar(c: CarController) {
  return useSyncExternalStore(c.subscribe, c.getState);
}

function useSimSnapshot(sim: SimCar | null): MapSnapshot | null {
  const [snap, setSnap] = useState<MapSnapshot | null>(sim ? sim.snapshot() : null);
  useEffect(() => {
    if (!sim) return;
    let raf = 0;
    const off = sim.onState(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = sim.snapshot();
        setSnap({ route: s.route, s: s.s, position: s.position, heading: s.heading, waypoints: s.waypoints, dest: s.dest });
      });
    });
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sim]);
  return snap;
}

/**
 * 실제 SDK 모드의 지도: 차 위치는 NaviHelper 현재 위치. NaviHelper는 경로 선을 주지 않아서(API_MATRIX)
 * 경로 선은 서버와 같은 경로 계산기로 그린 근사다. 목적지·경유지가 바뀌거나 300m 넘게 벗어나면 다시 그린다.
 */
function useBridgeSnapshot(s: CarState, enabled: boolean): MapSnapshot | null {
  const router = useMemo(() => (enabled ? new GraphRouter(new Graph(DEMO_NET)) : null), [enabled]);
  const cache = useRef<{ key: string; route: Route } | null>(null);
  if (!enabled || !router || !s.location) return null;
  const pos = { lat: s.location.lat, lng: s.location.lng };
  const dest = s.destination ? { lat: s.destination.latitude, lng: s.destination.longitude, name: s.destination.name } : null;
  const waypoints = s.waypoints.map((w) => ({ lat: w.latitude, lng: w.longitude, name: w.name }));
  let route: Route | null = null;
  let along = 0;
  if (dest) {
    const key = [dest, ...waypoints].map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
    const c = cache.current;
    const proj = c && c.key === key ? projectOnPolyline(c.route.line, pos, 0) : null;
    if (c && proj && proj.distM < 300) {
      route = c.route;
      along = proj.alongM;
    } else {
      route = router.route([pos, ...waypoints, dest]);
      if (route) cache.current = { key, route };
    }
  }
  // 내비가 진행 방향을 0으로 주면(알 수 없음) 경로 방향을 쓴다
  const heading = s.location.heading || (route ? pointAtAlong(route.line, along).headingDeg : 0);
  return { route, s: along, position: pos, heading, waypoints, dest };
}

export function CarScreen({ c, sim, now }: { c: CarController; sim: SimCar | null; now: () => number }) {
  const s = useCar(c);
  const simSnap = useSimSnapshot(sim);
  const bridgeSnap = useBridgeSnapshot(s, !sim);
  const snap = sim ? simSnap : bridgeSnap;
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [clockMs, setClockMs] = useState(now());
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1280));
    ro.observe(el);
    setScale(el.clientWidth / 1280);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const id = setInterval(() => setClockMs(now()), 500);
    return () => clearInterval(id);
  }, [now]);

  const sheetOpen = s.screen !== "map" && !s.restricted;
  const overview = !s.restricted;
  const viewport = sheetOpen ? { x: 796, y: 70, w: 484, h: 560 } : { x: 76, y: 70, w: 1280 - 76 - 430, h: 600 };
  const arrival = s.destination ? clockMs + s.destination.remainTime * 1000 : null;
  const mapCandidates = s.screen === "briefing" && s.briefing ? s.briefing.items : s.candidates;

  const railBtn = (name: "dest" | "brief" | "heart", label: string, screen: "destination" | "briefing" | "interests") => (
    <button className={`${s.screen === screen ? "on" : ""} ${s.restricted ? "locked" : ""}`} onClick={() => c.open(screen)} aria-label={label}>
      <RailIcon name={name} />
      {label}
    </button>
  );

  return (
    <div className="c-stage" ref={wrap}>
      <div className="c-stage-inner">
        <div className="c-screen" style={{ transform: `scale(${scale})` }} data-testid="car-screen" data-restricted={s.restricted ? "1" : "0"}>
          {snap ? (
            <MapView snap={snap} candidates={mapCandidates} trade={s.trade} overview={overview} viewport={viewport} zoom={zoom} />
          ) : (
            <div className="c-map" style={{ background: "#18202b" }} />
          )}

          <nav className="c-rail" aria-label="주행중GO! 메뉴">
            <div className="c-rail-logo">
              주행중
              <br />
              GO!
            </div>
            <button className={s.screen === "map" ? "on" : ""} onClick={() => c.open("map")} aria-label="지도">
              <RailIcon name="map" />
              지도
            </button>
            {railBtn("dest", "목적지", "destination")}
            {railBtn("brief", "브리핑", "briefing")}
            {railBtn("heart", "관심사", "interests")}
            <div className="grow" />
            <button onClick={() => c.setMuted(!s.muted)} aria-label={s.muted ? "소리 켜기" : "소리 끄기"}>
              <RailIcon name={s.muted ? "mute" : "sound"} />
              {s.muted ? "소리 꺼짐" : "소리"}
            </button>
          </nav>

          {s.tbt && s.navStatus === "ROUTE_DRIVE" && !sheetOpen && (
            <div className="c-tbt" data-testid="tbt">
              <div className="c-tbt-icon">
                <TurnIcon type={s.tbt.type} />
              </div>
              <div>
                <div className="c-tbt-dist">
                  {s.tbt.distance >= 1000 ? (s.tbt.distance / 1000).toFixed(1) : Math.round(s.tbt.distance / 10) * 10}
                  <small>{s.tbt.distance >= 1000 ? "km" : "m"}</small>
                </div>
                <div className="c-tbt-road">{s.tbt.description}</div>
              </div>
            </div>
          )}

          <div className="c-status">
            {sim && <span className="c-badge-sim">시뮬레이터</span>}
            <span className={`c-status-dot ${s.sse === "open" ? "" : "off"}`} title={s.sse === "open" ? "서버 연결됨" : "서버 연결 끊김"} />
            <span className="c-status-time" data-testid="clock">
              {fmtClock(clockMs)}
            </span>
          </div>

          {s.destination && !sheetOpen && (
            <div className="c-eta" data-testid="eta">
              <div>
                <div className="c-eta-time">{fmtClock(arrival)}</div>
                <div className="c-eta-label">도착 예정</div>
              </div>
              <div>
                <div className="c-eta-num">{fmtMin(s.destination.remainTime)}</div>
                <div className="c-eta-label">{fmtKm(s.destination.remainDistance)}</div>
              </div>
              <div className="c-eta-dest">{s.destination.name}</div>
              <div className="c-eta-batt">
                <BatteryIcon pct={s.soc} />
                {s.soc != null ? `${Math.round(s.soc)}%` : ""}
              </div>
            </div>
          )}

          {!sheetOpen && (
            <div style={{ position: "absolute", right: 440, top: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="c-close" aria-label="지도 확대" onClick={() => setZoom((z) => Math.max(0.35, z * 0.7))}>
                +
              </button>
              <button className="c-close" aria-label="지도 축소" onClick={() => setZoom((z) => Math.min(4, z / 0.7))}>
                −
              </button>
            </div>
          )}

          {!sheetOpen && <GoPanel s={s} c={c} now={clockMs} />}

          {sheetOpen && <Sheet s={s} c={c} />}

          <div className={`c-toasts ${sheetOpen ? "beside-sheet" : ""}`} aria-live="polite">
            {s.toasts.map((t) => (
              <div key={t.id} className={`c-toast ${t.kind}`}>
                {t.text}
              </div>
            ))}
          </div>

          {s.vehicleNeedsPick && s.screen !== "vehicle" && !s.restricted && (
            <div style={{ position: "absolute", left: 92, top: 18, zIndex: 7 }} className="c-banner kraft">
              차 정보에 모델명이 없어요.{" "}
              <button className="c-btn" onClick={() => c.open("vehicle")}>
                차종 고르기
              </button>
            </div>
          )}
          {s.error && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(10,14,20,.8)", zIndex: 9, fontSize: 20 }}>
              서버에 연결하지 못했어요: {s.error}
            </div>
          )}
        </div>
      </div>
      {s.lastSpeech && <p className="c-caption">음성: {s.lastSpeech}</p>}
    </div>
  );
}
