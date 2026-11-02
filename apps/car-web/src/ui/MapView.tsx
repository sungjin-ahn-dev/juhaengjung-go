/** 내비 지도 — 시연 도로망을 SVG로 그린다. 주행 중엔 진행 방향이 위, 정차 중엔 경로 전체를 보여 준다. */
import { useEffect, useRef, useState } from "react";
import { DEMO_NET, toXY, type LatLng, type Route } from "@jhgo/core";
import type { CandidateView, TradeView } from "../controller.ts";

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
  candidates: CandidateView[];
  trade: TradeView | null;
  /** 정차 중 경로 전체 보기 */
  overview: boolean;
  /** 지도가 보이는 영역(px) — 시트·패널을 뺀 부분 */
  viewport: { x: number; y: number; w: number; h: number };
  zoom: number;
}

const W = 1280;
const H = 720;
const ROAD_STYLE: Record<string, { w: number; c: string }> = {
  local: { w: 2.5, c: "#2a3545" },
  access: { w: 2, c: "#2a3545" },
  arterial: { w: 4.5, c: "#36455a" },
  urban_expressway: { w: 6, c: "#44566f" },
  expressway: { w: 7.5, c: "#4d6280" },
};
const ORDER = ["local", "arterial", "urban_expressway", "expressway"];
const NODES = new Map(DEMO_NET.nodes.map((n) => [n.id, n]));
/** 넓게 볼 때 남길 지명 */
const MAJOR = new Set(["suwon_cityhall", "yeongtong", "gwanggyo", "jukjeon", "jeongja", "pangyo", "moran", "segok", "suseo", "garak", "songpa", "jamsil"]);

function angleLerp(a: number, b: number, t: number) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export function MapView({ snap, candidates, trade, overview, viewport, zoom }: Props) {
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

  // 화면 변환
  let center: LatLng = snap.position;
  let mpp = 11 * zoom;
  let rot = overview ? 0 : headingRef.current;
  const anchor = overview
    ? { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 }
    : { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h * 0.66 };
  if (overview) {
    const pts: LatLng[] = snap.route ? snap.route.line.points : [snap.position];
    const all = [...pts, snap.position, ...(snap.dest ? [snap.dest] : []), ...candidates.map((c) => c.approxArea)];
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    const ne = toXY({ lat: Math.max(...lats), lng: Math.max(...lngs) }, center);
    const sw = toXY({ lat: Math.min(...lats), lng: Math.min(...lngs) }, center);
    mpp = Math.max((ne.x - sw.x) / (viewport.w - 120), (ne.y - sw.y) / (viewport.h - 120), 8) * zoom;
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

  // 도로
  const roads = ORDER.flatMap((cls) =>
    DEMO_NET.edges
      .filter((e) => e.cls === cls)
      .map((e, i) => {
        const a = NODES.get(e.from)!;
        const b = NODES.get(e.to)!;
        const st = ROAD_STYLE[cls];
        return <polyline key={`${cls}${i}`} points={pts([a, ...(e.shape ?? []), b])} stroke={st.c} strokeWidth={st.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      }),
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

  const labels = DEMO_NET.nodes
    .filter((n) => n.label !== false && (mpp < 22 || MAJOR.has(n.id)))
    .map((n) => {
      const [x, y] = P(n);
      if (x < viewport.x - 40 || x > viewport.x + viewport.w + 40 || y < -20 || y > H + 20) return null;
      return (
        <text key={n.id} x={x + 8} y={y - 8} fontSize={14} fill="#97a6ba">
          {n.name}
        </text>
      );
    });

  const car = P(snap.position);
  const carRot = overview ? snap.heading : 0;

  return (
    <svg className="c-map" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="내비 지도">
      <rect width={W} height={H} fill="#18202b" />
      <g>{roads}</g>
      {routePassed.length > 1 && <polyline points={pts(routePassed)} stroke="#3e5066" strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {routeAhead.length > 1 && (
        <>
          <polyline points={pts(routeAhead)} stroke="#0d3a44" strokeWidth={13} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts(routeAhead)} stroke="#57d2e6" strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      <g>{labels}</g>
      {candidates.map((c) => {
        const [x, y] = P(c.approxArea);
        const r = Math.max(10, c.approxArea.radiusM / mpp);
        const excluded = c.exclusions.length > 0;
        const revealed = trade && trade.listingId === c.listingId && trade.pickupPoint;
        if (revealed) return null;
        const label = c.categoryLabel;
        const wLabel = 16 + label.length * 15;
        return (
          <g key={c.listingId} opacity={excluded ? 0.55 : 1}>
            <circle cx={x} cy={y} r={r} fill={excluded ? "rgba(142,155,173,0.10)" : "rgba(217,178,124,0.20)"} stroke={excluded ? "#6b7889" : "#d9b27c"} strokeWidth={2} strokeDasharray={excluded ? "6 5" : undefined} />
            <rect x={x - wLabel / 2} y={y - r - 34} width={wLabel} height={28} rx={14} fill={excluded ? "#2b3646" : "#d9b27c"} />
            <text x={x} y={y - r - 15} fontSize={15} fontWeight={700} textAnchor="middle" fill={excluded ? "#aab6c6" : "#1d1a16"} style={{ stroke: "none" }}>
              {label}
            </text>
          </g>
        );
      })}
      {trade?.pickupPoint &&
        (() => {
          const [x, y] = P(trade.pickupPoint);
          return (
            <g>
              <circle cx={x} cy={y} r={15} fill="#d9b27c" stroke="#1d1a16" strokeWidth={3} />
              <text x={x} y={y + 5} fontSize={15} fontWeight={800} textAnchor="middle" fill="#1d1a16" style={{ stroke: "none" }}>
                P
              </text>
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
        <circle r={26} fill="rgba(87,210,230,0.16)" />
        <path d="M0 -17 L12 13 L0 7 L-12 13 Z" fill="#ffffff" stroke="#0d3a44" strokeWidth={2.5} strokeLinejoin="round" />
      </g>
    </svg>
  );
}
