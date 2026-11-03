/** 내비 지도 — 시연 도로망을 SVG로 그린다. 주행 중엔 진행 방향이 위, 정차 중엔 경로 전체를 보여 준다. */
import { useEffect, useRef, useState } from "react";
import { DEMO_NET, toXY, type LatLng, type Route } from "@jhgo/core";
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

export function MapView({ snap, candidates, selectedId = null, onPick, trade, overview, viewport, zoom }: Props) {
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
  /** 핀을 그릴 자리(겹침을 피해 옮긴 자리) */
  const pinAt = new Map<string, [number, number]>();
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
      {/* 핀: 번호 = 오른쪽 목록 순위. 정차 중엔 사진, 주행 중엔 번호만. 고른 핀을 맨 위에.
          핀끼리 겹치면 순위가 낮은 쪽을 옆으로 비켜 놓고 원래 자리와 가는 선으로 잇는다 */}
      {(() => {
        pinAt.clear();
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
