/** 내비 지도 — 시연 도로망을 SVG로 그린다. 주행 중엔 진행 방향이 위, 정차 중엔 경로 전체를 보여 준다. */
import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_NET, projectOnPolyline, toXY, type LatLng, type Route } from "@jhgo/core";
import type { TradeView } from "../controller.ts";
import type { RankedItem } from "./GoList.tsx";

export interface MapSnapshot {
  route: Route | null;
  s: number;
  position: LatLng;
  heading: number;
  waypoints: { lat: number; lng: number; name: string }[];
  dest: { lat: number; lng: number; name: string } | null;
}

interface Props {
  snap: MapSnapshot;
  /** 화면 폭(px). 16:9보다 넓은 차 화면에서는 1280보다 크다 */
  width?: number;
  /** 화면 높이(px). 분할 화면(세로에 가까운 창)에서는 720보다 크다 */
  height?: number;
  /** 추천 목록과 같은 순서 — rank가 지도 번호 */
  candidates: RankedItem[];
  selectedId?: string | null;
  onPick?: (listingId: string) => void;
  trade: TradeView | null;
  /** 정차 중 경로 전체 보기 */
  overview: boolean;
  /** 지도가 보이는 영역(px) — 시트·패널을 뺀 부분 */
  viewport: { x: number; y: number; w: number; h: number };
  zoom: number;
  /** 정차 중 경로 전체를 맞출 때 viewport 안쪽으로 비울 여백(px). 아래 도착 정보 카드처럼 지도 위에 얹힌 판을 피한다 */
  pad?: { t: number; r: number; b: number; l: number };
  /** 지도 위에 얹힌 판(회전 안내·도착 정보·확대 단추·음성 자막)의 자리 [x0, y0, x1, y1]. 지명은 여기에 걸치지 않게 둔다 */
  occluders?: Box[];
}

/** 화면 위 네모 [x0, y0, x1, y1] */
export type Box = [number, number, number, number];
const hits = (a: Box, b: Box, gap = 0) => a[0] - gap < b[2] && a[2] + gap > b[0] && a[1] - gap < b[3] && a[3] + gap > b[1];
/** 글자 폭 어림 — 한글은 글자 크기만큼, 영문·숫자는 그 0.58배 */
const textW = (t: string, size: number) => {
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.58;
  return w;
};
/** 지명을 둘 수 있는 자리(지점 기준). 앞의 것부터 써 본다: 오른쪽 위 → 오른쪽 아래 → 왼쪽 위 → 왼쪽 아래 → 위 → 아래 */
const SPOTS = [
  { ax: "start", dx: 10, dy: -9 },
  { ax: "start", dx: 10, dy: 21 },
  { ax: "end", dx: -10, dy: -9 },
  { ax: "end", dx: -10, dy: 21 },
  { ax: "middle", dx: 0, dy: -15 },
  { ax: "middle", dx: 0, dy: 28 },
] as const;
const labelBox = (x: number, y: number, w: number, size: number, k: (typeof SPOTS)[number]): Box => {
  const x0 = k.ax === "start" ? x + k.dx : k.ax === "end" ? x + k.dx - w : x - w / 2;
  const base = y + k.dy;
  return [x0, base - size * 0.92, x0 + w, base + size * 0.28];
};

/** 도로: 아래에 어두운 테두리(casing), 위에 밝은 면. 큰길일수록 넓고 밝다 */
const ROAD_STYLE: Record<string, { w: number; c: string; casing?: string }> = {
  local: { w: 2.5, c: "#2b3646" },
  access: { w: 2, c: "#2b3646" },
  arterial: { w: 5, c: "#3a4a5f", casing: "#111820" },
  urban_expressway: { w: 7, c: "#48596f", casing: "#111820" },
  expressway: { w: 9, c: "#536a86", casing: "#111820" },
};
const ORDER = ["local", "arterial", "urban_expressway", "expressway"];
const NODES = new Map(DEMO_NET.nodes.map((n) => [n.id, n]));
/** 넓게 볼 때 남길 지명 */
const MAJOR = new Set(["suwon_cityhall", "yeongtong", "gwanggyo", "jukjeon", "jeongja", "pangyo", "moran", "segok", "suseo", "garak", "songpa", "jamsil"]);

function angleLerp(a: number, b: number, t: number) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export function MapView({ snap, width = 1280, height = 720, candidates, selectedId = null, onPick, trade, overview, viewport, zoom, pad, occluders }: Props) {
  const W = width;
  const H = height;
  const headingRef = useRef(snap.heading);
  const [, force] = useState(0);
  // 진행 방향을 부드럽게 따라간다
  useEffect(() => {
    if (overview) return;
    const id = setInterval(() => {
      const next = angleLerp(headingRef.current, snap.heading, 0.25);
      if (Math.abs(((next - headingRef.current + 540) % 360) - 180) > 0.05) {
        headingRef.current = next;
        force((x) => x + 1);
      }
    }, 50);
    return () => clearInterval(id);
  }, [snap.heading, overview]);
  // 경로 위에 있는 지명(지점 → 경로를 따라 간 거리 m). 경로가 바뀔 때만 다시 계산한다
  const onRoute = useMemo(() => {
    const m = new Map<string, number>();
    if (!snap.route) return m;
    for (const n of DEMO_NET.nodes) {
      if (n.label === false) continue;
      const pr = projectOnPolyline(snap.route.line, n, 0);
      if (pr && pr.distM < 90) m.set(n.id, pr.alongM);
    }
    return m;
  }, [snap.route]);
  /** 지명마다 지난번에 놓은 자리(SPOTS 번호, 숨겼으면 -1) — 차가 움직여도 지명이 이리저리 옮겨 다니거나 깜빡이지 않게 */
  const spotMemo = useRef(new Map<string, number>());

  // 화면 변환
  let center: LatLng = snap.position;
  let mpp = 11 * zoom;
  let rot = overview ? 0 : headingRef.current;
  const fitPad = pad ?? { t: 60, r: 60, b: 60, l: 60 };
  const fitW = Math.max(80, viewport.w - fitPad.l - fitPad.r);
  const fitH = Math.max(80, viewport.h - fitPad.t - fitPad.b);
  const anchor = overview
    ? { x: viewport.x + fitPad.l + fitW / 2, y: viewport.y + fitPad.t + fitH / 2 }
    : { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h * 0.66 };
  if (overview) {
    const pts: LatLng[] = snap.route ? snap.route.line.points : [snap.position];
    const all = [...pts, snap.position, ...(snap.dest ? [snap.dest] : []), ...candidates.map((c) => c.approxArea)];
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    const ne = toXY({ lat: Math.max(...lats), lng: Math.max(...lngs) }, center);
    const sw = toXY({ lat: Math.min(...lats), lng: Math.min(...lngs) }, center);
    mpp = Math.max((ne.x - sw.x) / fitW, (ne.y - sw.y) / fitH, 8) * zoom;
    rot = 0;
  }
  const cos = Math.cos((-rot * Math.PI) / 180);
  const sin = Math.sin((-rot * Math.PI) / 180);
  const P = (p: LatLng): [number, number] => {
    const m = toXY(p, center);
    const x0 = m.x / mpp;
    const y0 = -m.y / mpp;
    return [anchor.x + x0 * cos - y0 * sin, anchor.y + x0 * sin + y0 * cos];
  };
  const pts = (arr: LatLng[]) => arr.map((p) => P(p).map((v) => v.toFixed(1)).join(",")).join(" ");

  // 도로: 테두리를 먼저 다 그리고 면을 그려 교차로가 자연스럽게 이어지게
  const roadLines = ORDER.flatMap((cls) =>
    DEMO_NET.edges
      .filter((e) => e.cls === cls)
      .map((e, i) => ({ key: `${cls}${i}`, p: pts([NODES.get(e.from)!, ...(e.shape ?? []), NODES.get(e.to)!]), st: ROAD_STYLE[cls] })),
  );
  const roads = (
    <>
      {roadLines.filter((r) => r.st.casing).map((r) => <polyline key={`c${r.key}`} points={r.p} stroke={r.st.casing} strokeWidth={r.st.w + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
      {roadLines.map((r) => (
        <polyline key={r.key} points={r.p} stroke={r.st.c} strokeWidth={r.st.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );

  // 경로: 지나온 부분과 남은 부분
  let routePassed: LatLng[] = [];
  let routeAhead: LatLng[] = [];
  if (snap.route) {
    const { points, cum } = snap.route.line;
    let i = 0;
    while (i < cum.length - 1 && cum[i + 1] < snap.s) i++;
    routePassed = [...points.slice(0, i + 1), snap.position];
    routeAhead = [snap.position, ...points.slice(i + 1)];
  }

  const car = P(snap.position);
  const carRot = overview ? snap.heading : 0;

  // ── 핀 자리: 핀끼리 겹치면 순위가 낮은 쪽을 옆으로 비켜 놓는다(원래 자리와는 가는 선으로 잇는다) ──
  const pinAt = new Map<string, [number, number]>();
  {
    const box = overview ? 64 : 36;
    const placed: [number, number][] = [];
    for (const c of candidates) {
      if (c.rank === null) continue;
      const [x, y] = P(c.approxArea);
      let px = x;
      let py = y;
      for (let k = 0; k < 8; k++) {
        const hit = placed.find(([qx, qy]) => Math.abs(qx - px) < box && Math.abs(qy - py) < box);
        if (!hit) break;
        px = hit[0] + box + 4;
        py = hit[1];
      }
      placed.push([px, py]);
      pinAt.set(c.listingId, [px, py]);
    }
  }

  // ── 지명: 겹치지 않게 놓는다 ──
  // 지도 위에 이미 자리를 차지한 것(얹힌 판·핀·깃발·차)을 모으고, 중요한 지명부터 빈 자리를 찾아 놓는다. 자리가 없으면 그 지명은 쉬게 한다.
  const blocks: Box[] = [...(occluders ?? [])];
  for (const c of candidates) {
    if (trade && trade.listingId === c.listingId && trade.pickupPoint) continue;
    const out = c.rank === null;
    if (!overview && out) continue;
    const on = c.listingId === selectedId;
    const [ox, oy] = P(c.approxArea);
    const [x, y] = pinAt.get(c.listingId) ?? [ox, oy];
    if (out) blocks.push([x - 12, y - 12, x + 12, y + 12]);
    else if (!overview || !c.photo) {
      const r = (on ? 19 : 16) + 4;
      blocks.push([x - r, y - r, x + r, y + r]);
    } else {
      const size = on ? 58 : 46;
      blocks.push([x - size / 2 - 15, y - 12 - size - 15, x + size / 2 + 5, y + 5]);
    }
    if (Math.hypot(x - ox, y - oy) >= 2) blocks.push([ox - 7, oy - 7, ox + 7, oy + 7]);
  }
  if (trade?.pickupPoint) {
    const [x, y] = P(trade.pickupPoint);
    const size = overview ? 54 : 44;
    blocks.push([x - size / 2 - 5, y - 14 - size - 5, x + size / 2 + 5, y + 10]);
  }
  for (const w of snap.waypoints) {
    const [x, y] = P(w);
    blocks.push([x - 14, y - 14, x + 14, y + 14]);
  }
  if (snap.dest) {
    const [x, y] = P(snap.dest);
    blocks.push([x - 8, y - 40, x + 26, y + 8]);
  }
  blocks.push([car[0] - 26, car[1] - 26, car[0] + 26, car[1] + 26]);
  // 남은 경로 선: 14px마다 한 점씩 찍어 두고, 지명이 그 위에 올라가지 않는 자리를 먼저 찾는다(선 위 글자는 읽기 어렵다)
  const routeDots: [number, number][] = [];
  for (let i = 0; i < routeAhead.length - 1; i++) {
    const a = P(routeAhead[i]);
    const b = P(routeAhead[i + 1]);
    if ((a[0] < -60 && b[0] < -60) || (a[0] > W + 60 && b[0] > W + 60) || (a[1] < -60 && b[1] < -60) || (a[1] > H + 60 && b[1] > H + 60)) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 14));
    for (let k = 0; k <= n; k++) routeDots.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  // 목적지에 가장 가까운 지명을 가장 먼저 놓는다(깃발 옆 이름)
  let destId: string | null = null;
  if (snap.dest) {
    let best = 1500;
    for (const n of DEMO_NET.nodes) {
      if (n.label === false) continue;
      const d = toXY(n, snap.dest);
      const m = Math.hypot(d.x, d.y);
      if (m < best) {
        best = m;
        destId = n.id;
      }
    }
  }
  const wanted: { id: string; name: string; x: number; y: number; tier: number; order: number }[] = [];
  for (const n of DEMO_NET.nodes) {
    if (n.label === false || !(mpp < 22 || MAJOR.has(n.id))) continue;
    const [x, y] = P(n);
    if (x < viewport.x - 30 || x > viewport.x + viewport.w + 30 || y < -10 || y > H + 10) continue;
    const along = onRoute.get(n.id);
    const ahead = along !== undefined && along >= snap.s - 300;
    // 0 목적지 옆 · 1 남은 경로 위 · 2 큰 지명 · 3 나머지
    const tier = n.id === destId ? 0 : ahead ? 1 : MAJOR.has(n.id) ? 2 : 3;
    wanted.push({ id: n.id, name: n.name, x, y, tier, order: along ?? 1e9 });
  }
  wanted.sort((a, b) => a.tier - b.tier || a.order - b.order);
  const LABEL = [
    { size: 15, fill: "#c9d2de" },
    { size: 15, fill: "#c9d2de" },
    { size: 14, fill: "#93a1b4" },
    { size: 13, fill: "#7c899b" },
  ];
  const labelLimit: Box = [viewport.x + 4, 4, viewport.x + viewport.w - 4, H - 4];
  const placedLabels: Box[] = [];
  const nextSpots = new Map<string, number>();
  const labels = wanted.map((l) => {
    const st = LABEL[l.tier];
    const w = textW(l.name, st.size) + 2;
    const prev = spotMemo.current.get(l.id);
    // 숨겨져 있던 지명은 자리가 넉넉해졌을 때만 다시 보인다
    const gap = prev === -1 ? 9 : 3;
    const tries = prev !== undefined && prev >= 0 ? [prev, ...SPOTS.map((_, i) => i).filter((i) => i !== prev)] : SPOTS.map((_, i) => i);
    let spot = -1;
    for (const i of tries) {
      const b = labelBox(l.x, l.y, w, st.size, SPOTS[i]);
      if (b[0] < labelLimit[0] || b[2] > labelLimit[2] || b[1] < labelLimit[1] || b[3] > labelLimit[3]) continue;
      if (blocks.some((o) => hits(b, o, gap)) || placedLabels.some((o) => hits(b, o, gap + 3))) continue;
      // 남은 경로 선 위에는 올리지 않는다
      if (routeDots.some(([rx, ry]) => rx > b[0] - 8 && rx < b[2] + 8 && ry > b[1] - 8 && ry < b[3] + 8)) continue;
      spot = i;
      break;
    }
    nextSpots.set(l.id, spot);
    if (spot < 0) return null;
    const k = SPOTS[spot];
    placedLabels.push(labelBox(l.x, l.y, w, st.size, k));
    return (
      <text key={l.id} x={l.x + k.dx} y={l.y + k.dy} fontSize={st.size} fill={st.fill} textAnchor={k.ax}>
        {l.name}
      </text>
    );
  });
  spotMemo.current = nextSpots;

  return (
    <svg className="c-map" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="내비 지도">
      <defs>
        <radialGradient id="car-beam" cx="50%" cy="100%" r="100%">
          <stop offset="0" stopColor="#57d2e6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#57d2e6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#18202b" />
      <g>{roads}</g>
      {routePassed.length > 1 && <polyline points={pts(routePassed)} stroke="#3a4c62" strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {routeAhead.length > 1 && (
        <>
          {/* 빛 번짐: 필터(feGaussianBlur) 대신 반투명 굵은 선 두 겹 — 차량 WebView에서 매 틱 그려도 가볍게 */}
          <polyline points={pts(routeAhead)} stroke="#57d2e6" strokeOpacity={0.09} strokeWidth={30} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts(routeAhead)} stroke="#57d2e6" strokeOpacity={0.16} strokeWidth={19} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts(routeAhead)} stroke="#0b3640" strokeWidth={13} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts(routeAhead)} stroke="#57d2e6" strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {/* 공개 범위(대략 위치 500m). 주행 중엔 1위와 고른 것만 */}
      {candidates.map((c) => {
        if (trade && trade.listingId === c.listingId && trade.pickupPoint) return null;
        const on = c.listingId === selectedId;
        const out = c.rank === null;
        if (!overview && (out || (!on && c.rank !== 1))) return null;
        const [x, y] = P(c.approxArea);
        const r = Math.max(10, c.approxArea.radiusM / mpp);
        return (
          <circle
            key={`a-${c.listingId}`}
            cx={x}
            cy={y}
            r={r}
            fill={out ? "rgba(142,155,173,0.06)" : on ? "rgba(217,178,124,0.24)" : "rgba(217,178,124,0.12)"}
            stroke={out ? "#5b687a" : "#d9b27c"}
            strokeOpacity={on ? 1 : 0.55}
            strokeWidth={on ? 2.5 : 1.5}
            strokeDasharray={out ? "5 5" : undefined}
          />
        );
      })}
      <g>{labels}</g>
      {/* 핀: 번호 = 오른쪽 목록 순위. 정차 중엔 사진, 주행 중엔 번호만. 고른 핀을 맨 위에.
          핀끼리 겹치면 순위가 낮은 쪽을 옆으로 비켜 놓고 원래 자리와 가는 선으로 잇는다 */}
      {(() => {
        return candidates.map((c) => {
          const at = pinAt.get(c.listingId);
          if (!at) return null;
          const [x, y] = P(c.approxArea);
          if (Math.hypot(at[0] - x, at[1] - y) < 2) return null;
          return (
            <g key={`l-${c.listingId}`}>
              <line x1={x} y1={y} x2={at[0]} y2={at[1]} stroke="#d9b27c" strokeWidth={1.5} strokeOpacity={0.8} />
              <circle cx={x} cy={y} r={3.5} fill="#d9b27c" />
            </g>
          );
        });
      })()}
      {[...candidates]
        .sort((a, b) => (a.listingId === selectedId ? 1 : 0) - (b.listingId === selectedId ? 1 : 0) || (b.rank ?? 99) - (a.rank ?? 99))
        .map((c) => {
          if (trade && trade.listingId === c.listingId && trade.pickupPoint) return null;
          const on = c.listingId === selectedId;
          const out = c.rank === null;
          if (!overview && out) return null;
          const [x, y] = pinAt.get(c.listingId) ?? P(c.approxArea);
          const pick = onPick ? () => onPick(c.listingId) : undefined;
          if (out) {
            return (
              <g key={`p-${c.listingId}`} onClick={pick} style={{ cursor: pick ? "pointer" : undefined }} data-testid={`pin-${c.categoryLabel}`}>
                <circle cx={x} cy={y} r={on ? 9 : 7} fill="#5b687a" stroke="#18202b" strokeWidth={2} />
              </g>
            );
          }
          if (!overview || !c.photo) {
            const rr = on ? 19 : 16;
            return (
              <g key={`p-${c.listingId}`} onClick={pick} style={{ cursor: pick ? "pointer" : undefined }} data-testid={`pin-${c.categoryLabel}`}>
                <circle cx={x} cy={y} r={rr} fill="#d9b27c" stroke={on ? "#ffffff" : "#1d1a16"} strokeWidth={on ? 3 : 2.5} />
                <text x={x} y={y + 6} fontSize={on ? 20 : 17} fontFamily="var(--font-sign)" textAnchor="middle" fill="#1d1a16" style={{ stroke: "none" }}>
                  {c.rank}
                </text>
              </g>
            );
          }
          const size = on ? 58 : 46;
          const top = y - 12 - size;
          const clip = `clip-${c.listingId}`;
          return (
            <g key={`p-${c.listingId}`} onClick={pick} style={{ cursor: pick ? "pointer" : undefined }} data-testid={`pin-${c.categoryLabel}`}>
              <path d={`M${x} ${y} L${x - 8} ${y - 13} L${x + 8} ${y - 13} Z`} fill={on ? "#ffffff" : "#d9b27c"} />
              <rect x={x - size / 2} y={top} width={size} height={size} rx={11} fill="#1d1a16" stroke={on ? "#ffffff" : "#d9b27c"} strokeWidth={3} />
              <clipPath id={clip}>
                <rect x={x - size / 2 + 3} y={top + 3} width={size - 6} height={size - 6} rx={8} />
              </clipPath>
              <image href={c.photo} x={x - size / 2 + 3} y={top + 3} width={size - 6} height={size - 6} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
              <circle cx={x - size / 2 + 2} cy={top + 2} r={12} fill="#d9b27c" stroke="#1d1a16" strokeWidth={2} />
              <text x={x - size / 2 + 2} y={top + 8} fontSize={16} fontFamily="var(--font-sign)" textAnchor="middle" fill="#1d1a16" style={{ stroke: "none" }}>
                {c.rank}
              </text>
            </g>
          );
        })}
      {trade?.pickupPoint &&
        (() => {
          const [x, y] = P(trade.pickupPoint);
          const photo = trade.photos[0];
          const size = overview ? 54 : 44;
          const top = y - 14 - size;
          return (
            <g data-testid="pickup-pin">
              <circle cx={x} cy={y} r={7} fill="#d8ae74" stroke="#2a1c0c" strokeWidth={2.5} />
              <path d={`M${x} ${y - 2} L${x - 8} ${y - 14} L${x + 8} ${y - 14} Z`} fill="#d8ae74" />
              <rect x={x - size / 2} y={top} width={size} height={size} rx={12} fill="#2a1c0c" stroke="#d8ae74" strokeWidth={3} />
              {photo ? (
                <>
                  <clipPath id="clip-pickup">
                    <rect x={x - size / 2 + 3} y={top + 3} width={size - 6} height={size - 6} rx={9} />
                  </clipPath>
                  <image href={photo} x={x - size / 2 + 3} y={top + 3} width={size - 6} height={size - 6} preserveAspectRatio="xMidYMid slice" clipPath="url(#clip-pickup)" />
                </>
              ) : (
                <text x={x} y={top + size / 2 + 6} fontSize={17} fontWeight={800} textAnchor="middle" fill="#d8ae74" style={{ stroke: "none" }}>
                  P
                </text>
              )}
            </g>
          );
        })()}
      {snap.waypoints
        .filter((w) => !trade?.pickupPoint || Math.abs(w.lat - trade.pickupPoint.lat) + Math.abs(w.lng - trade.pickupPoint.lng) > 0.0005)
        .map((w, i) => {
          const [x, y] = P(w);
          return <circle key={i} cx={x} cy={y} r={11} fill="#d9b27c" stroke="#1d1a16" strokeWidth={3} />;
        })}
      {snap.dest &&
        (() => {
          const [x, y] = P(snap.dest);
          return (
            <g>
              <path d={`M${x} ${y} v-34`} stroke="#e8edf3" strokeWidth={3} />
              <path d={`M${x} ${y - 34} h20 l-6 7 l6 7 h-20 z`} fill="#e8edf3" />
              <circle cx={x} cy={y} r={5} fill="#e8edf3" />
            </g>
          );
        })()}
      <g transform={`translate(${car[0]} ${car[1]}) rotate(${carRot})`}>
        {!overview && <path d="M0 0 L-70 -150 Q0 -190 70 -150 Z" fill="url(#car-beam)" />}
        <circle r={28} fill="rgba(87,210,230,0.14)" />
        <circle r={19} fill="rgba(87,210,230,0.18)" />
        <path d="M0 -17 L12 13 L0 7 L-12 13 Z" fill="#ffffff" stroke="#0b3640" strokeWidth={2.5} strokeLinejoin="round" />
      </g>
    </svg>
  );
}
