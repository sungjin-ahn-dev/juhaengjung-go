/**
 * 차량 화면 — 기준 1280×720. 창에 맞춰 축소하고, 16:9보다 넓은 차 화면(1920×720)에서는 지도를 그만큼 넓힌다.
 * 왼쪽 레일, 위 회전 안내·상태, 아래 도착 정보, 오른쪽 추천 목록·알림·거래 카드, 정차 중엔 왼쪽 시트.
 * 분할 화면(Pleos Connect 1:1 분할처럼 세로에 가까운 창)에서는 폭 860 기준으로 다시 배치한다 — 지도는 위, 목록·알림·거래 카드는 아래.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEMO_NET, Graph, GraphRouter, pointAtAlong, projectOnPolyline, type Route } from "@jhgo/core";
import type { CarController, CarState } from "../controller.ts";
import type { SimCar } from "../pleos/sim.ts";
import { GoList, rankItems } from "./GoList.tsx";
import { GoPanel } from "./GoPanel.tsx";
import { BatteryIcon, RailIcon, TurnIcon, UI } from "./icons.tsx";
import { MapView, type MapSnapshot } from "./MapView.tsx";
import { fmtClock, fmtKm, fmtMin } from "./format.ts";
import { Sheet } from "./Sheets.tsx";

export function useCar(c: CarController) {
  return useSyncExternalStore(c.subscribe, c.getState);
}

const BASE_W = 1280;
const BASE_H = 720;
const RAIL_W = 84;
const SIDE_W = 412;
const SHEET_W = 760;
/** 분할 화면 배치의 기준 폭(레일 84 + 시트 760 + 여백) */
const SPLIT_W = 860;
/** 창의 가로÷세로가 이보다 작으면 분할 화면 배치(4:3 창부터) */
const SPLIT_ASPECT = 1.45;
/** 분할 화면에서 아래 카드 영역이 차지할 수 있는 최대 높이(화면 높이 대비): 정차 중엔 목록이 길고, 주행 중엔 카드 하나라 지도를 더 준다 */
const SPLIT_PANEL_STOPPED = 0.56;
const SPLIT_PANEL_DRIVING = 0.4;

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

/** 말한 문장을 몇 초 동안 자막으로. 정차 중에는 다시 듣기 단추 */
function VoiceLine({ s, c, now, sheetOpen }: { s: CarState; c: CarController; now: number; sheetOpen: boolean }) {
  const listening = !!s.alert?.listening || s.talking;
  const heard = s.heard && now - s.heard.at < 3000 ? s.heard.word : null;
  const chat = s.chat && now - s.chat.at < 14000 ? s.chat : null;
  const fresh = s.lastSpeech && now - s.speechAt < (s.alert ? 20000 : 9000);
  if (!fresh && !listening && !heard && !chat) return null;
  const Mic = UI.mic;
  const Sound = UI.sound;
  const words = s.talking ? [] : c.listenWords();
  return (
    <div className={`c-voice ${sheetOpen ? "beside-sheet" : ""}`} aria-live="polite">
      <div className={`c-voice-pill ${listening ? "listen" : ""}`} data-testid="voice-line">
        {listening ? <Mic size={24} aria-hidden="true" /> : <Sound size={24} aria-hidden="true" />}
        <div>
          {s.talking ? (
            <span>물어보세요. 흠집, 가격, 얼마나 돌아가는지, "카시트로 할게"</span>
          ) : heard ? (
            <span data-testid="voice-heard">"{heard}" — 알아들었어요</span>
          ) : chat ? (
            <span data-testid="voice-chat">
              <small className="c-voice-q">"{chat.q}"</small>
              {chat.a}
            </span>
          ) : (
            s.lastSpeech
          )}
          {listening && !heard && words.length > 0 && (
            <small>
              <span className="c-wave" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>{" "}
              듣고 있어요. {words.map((w) => `"${w}"`).join(" 또는 ")}
            </small>
          )}
        </div>
        {!s.restricted && !listening && (
          <button onClick={() => c.repeat()} aria-label="다시 듣기">
            <Sound size={20} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function CarScreen({ c, sim, now }: { c: CarController; sim: SimCar | null; now: () => number }) {
  const s = useCar(c);
  const simSnap = useSimSnapshot(sim);
  const bridgeSnap = useBridgeSnapshot(s, !sim);
  const snap = sim ? simSnap : bridgeSnap;
  const wrap = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, w: BASE_W, h: BASE_H, split: false, top: 0 });
  const [zoom, setZoom] = useState(1);
  const [clockMs, setClockMs] = useState(now());
  const [wall, setWall] = useState(Date.now());
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const aspect = ch > 0 ? cw / ch : BASE_W / BASE_H;
      if (aspect < SPLIT_ASPECT) {
        // 분할 화면: 폭 860 기준, 높이는 창 비율대로(창을 꽉 채운다)
        setFit({ scale: cw / SPLIT_W, w: SPLIT_W, h: Math.max(600, Math.round(SPLIT_W / aspect)), split: true, top: 0 });
        return;
      }
      // 16:9보다 넓으면 화면 폭을 늘려 지도가 넓어지게, 좁으면 기준 폭을 그대로 줄이고 위아래 가운데에 둔다
      const w = Math.max(BASE_W, Math.round(BASE_H * aspect));
      const scale = cw / w;
      const gap = ch - BASE_H * scale;
      setFit({ scale, w, h: BASE_H, split: false, top: gap > 2 ? gap / 2 : 0 });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      setClockMs(now());
      setWall(Date.now());
    }, 500);
    return () => clearInterval(id);
  }, [now]);

  // 출발 전 브리핑은 따로 시트를 띄우지 않고 지도 + 오른쪽 추천 목록으로 보여 준다
  const sheetOpen = s.screen !== "map" && s.screen !== "briefing" && !s.restricted;
  const overview = !s.restricted;
  const W = fit.w;
  const H = fit.h;
  const split = fit.split;
  const splitPanel = s.restricted ? SPLIT_PANEL_DRIVING : SPLIT_PANEL_STOPPED;
  // 분할 화면: 지도는 아래 카드 영역 위쪽에만 보인다(시트가 열리면 지도는 가려진다)
  const viewport = split
    ? { x: RAIL_W, y: 70, w: W - RAIL_W, h: Math.round(H * (1 - splitPanel)) - 70 }
    : sheetOpen
      ? { x: RAIL_W + SHEET_W, y: 70, w: W - RAIL_W - SHEET_W, h: 560 }
      : { x: RAIL_W, y: 70, w: W - RAIL_W - SIDE_W - 28, h: 600 };
  const arrival = s.destination ? clockMs + s.destination.remainTime * 1000 : null;
  const ranked = rankItems(s);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 목록에서 사라진 매물을 고른 채로 두지 않는다
  const selected = selectedId && ranked.some((x) => x.listingId === selectedId) ? selectedId : null;
  // 주행 중 알림·거래가 뜨면 목록은 접고 카드만
  const showList = !(s.restricted && (s.alert || s.trade));
  const Plus = UI.plus;
  const Minus = UI.minus;

  const railBtn = (name: "dest" | "brief" | "heart", label: string, screen: "destination" | "briefing" | "interests") => (
    <button className={`${s.screen === screen ? "on" : ""} ${s.restricted ? "locked" : ""}`} onClick={() => c.open(screen)} aria-label={label}>
      <RailIcon name={name} />
      {label}
    </button>
  );

  return (
    <div className="c-stage" ref={wrap}>
      <div className="c-stage-inner">
        <div
          className={`c-screen ${split ? "split" : ""}`}
          style={{ transform: `scale(${fit.scale})`, width: W, height: H, top: fit.top, ["--split-panel" as string]: `${Math.round(splitPanel * 100)}%` }}
          data-testid="car-screen"
          data-restricted={s.restricted ? "1" : "0"}
          data-layout={split ? "split" : "wide"}
        >
          {snap ? (
            <MapView
              snap={snap}
              width={W}
              height={H}
              candidates={ranked}
              selectedId={selected}
              onPick={(id) => {
                setSelectedId(id);
                c.setFocus(id);
                c.speakBrief(id);
              }}
              trade={s.trade}
              overview={overview}
              viewport={viewport}
              zoom={zoom}
            />
          ) : (
            <div className="c-map" style={{ background: "var(--map)" }} />
          )}
          <div className="c-map-grad" aria-hidden="true" />

          <nav className="c-rail" aria-label="주행중GO! 메뉴">
            <div className="c-rail-logo">
              주행중
              <br />
              <em>GO!</em>
            </div>
            <button className={s.screen === "map" ? "on" : ""} onClick={() => c.open("map")} aria-label="지도">
              <RailIcon name="map" />
              지도
            </button>
            {railBtn("dest", "목적지", "destination")}
            {railBtn("brief", "브리핑", "briefing")}
            {railBtn("heart", "관심사", "interests")}
            <div className="grow" />
            {/* 대화로 고르기(T34): 누르고 말하면 조수가 답한다. 알림이 듣는 중이면 그 표시 */}
            <button className={s.talking || s.alert?.listening ? "mic on" : "mic"} onClick={() => void c.talk()} aria-label="말하기" data-testid="rail-talk">
              <RailIcon name="mic" />
              {s.talking || s.alert?.listening ? "듣는 중" : "말하기"}
            </button>
            <button onClick={() => c.setMuted(!s.muted)} aria-label={s.muted ? "소리 켜기" : "소리 끄기"}>
              <RailIcon name={s.muted ? "mute" : "sound"} />
              {s.muted ? "소리 꺼짐" : "소리"}
            </button>
          </nav>

          {s.tbt && s.navStatus === "ROUTE_DRIVE" && !sheetOpen && (
            <div className="c-tbt c-card" data-testid="tbt">
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

          <div className="c-status c-card">
            {sim && <span className="c-badge-sim">시뮬레이터</span>}
            <span className={`c-status-dot ${s.sse === "open" ? "" : "off"}`} title={s.sse === "open" ? "서버 연결됨" : "서버 연결 끊김"} />
            <span className="c-status-time" data-testid="clock">
              {fmtClock(clockMs)}
            </span>
          </div>

          {s.destination && !sheetOpen && (
            <div className="c-eta c-card" data-testid="eta">
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
            <div className="c-zoom c-card">
              <button aria-label="지도 확대" onClick={() => setZoom((z) => Math.max(0.35, z * 0.7))}>
                <Plus size={22} aria-hidden="true" />
              </button>
              <button aria-label="지도 축소" onClick={() => setZoom((z) => Math.min(4, z / 0.7))}>
                <Minus size={22} aria-hidden="true" />
              </button>
            </div>
          )}

          {!sheetOpen && (
            <div className="c-side">
              {showList && (
                <GoList
                  s={s}
                  c={c}
                  items={ranked}
                  selectedId={selected}
                  onSelect={(id) => {
                    // 고르면 바로 설명해 준다(T33) — 같은 걸 다시 누르면 접는다
                    const next = selected === id ? null : id;
                    setSelectedId(next);
                    c.setFocus(next);
                    if (next) c.speakBrief(next);
                  }}
                />
              )}
              <GoPanel s={s} c={c} now={clockMs} />
            </div>
          )}

          {sheetOpen && <Sheet s={s} c={c} />}

          <VoiceLine s={s} c={c} now={wall} sheetOpen={sheetOpen} />

          <div className={`c-toasts ${sheetOpen ? "beside-sheet" : ""}`} aria-live="polite">
            {s.toasts.map((t) => (
              <div key={t.id} className={`c-toast ${t.kind}`}>
                {t.text}
              </div>
            ))}
          </div>

          {s.vehicleNeedsPick && s.screen !== "vehicle" && !s.restricted && (
            <div style={{ position: "absolute", left: RAIL_W + 16, top: 18, zIndex: 7 }} className="c-banner kraft">
              차 정보에 모델명이 없어요.
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
    </div>
  );
}
