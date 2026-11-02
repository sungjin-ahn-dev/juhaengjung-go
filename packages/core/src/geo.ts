/** 좌표 계산 — 하버사인 거리, 국소 평면 좌표, 폴리라인 투영·보간. 외부 의존성 없음. */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 진행 방향(도). 북=0, 동=90. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** b − a 를 −180~180 범위로. 양수 = 오른쪽으로 꺾임. */
export function turnAngleDeg(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** 원점 기준 국소 평면 좌표(미터). 수 km~수십 km 범위에서 충분히 정확하다. */
export function toXY(p: LatLng, origin: LatLng): { x: number; y: number } {
  const kx = 111320 * Math.cos(toRad(origin.lat));
  return { x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * 110574 };
}

export function fromXY(x: number, y: number, origin: LatLng): LatLng {
  const kx = 111320 * Math.cos(toRad(origin.lat));
  return { lat: origin.lat + y / 110574, lng: origin.lng + x / kx };
}

export interface Polyline {
  points: LatLng[];
  /** 각 점까지의 누적 거리(m) */
  cum: number[];
}

export function makePolyline(points: LatLng[]): Polyline {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
  return { points, cum };
}

export function polylineLength(pl: Polyline): number {
  return pl.cum.length ? pl.cum[pl.cum.length - 1] : 0;
}

export interface Projection {
  /** 폴리라인 위 가장 가까운 점까지의 누적 거리 */
  alongM: number;
  /** 수직 거리 */
  distM: number;
  segIndex: number;
  point: LatLng;
}

/**
 * 점을 폴리라인에 투영한다. fromAlongM 이전 구간은 건너뛴다(이미 지나온 길에 다시 붙지 않게).
 */
export function projectOnPolyline(pl: Polyline, p: LatLng, fromAlongM = 0): Projection | null {
  if (pl.points.length < 2) return null;
  let best: Projection | null = null;
  for (let i = 0; i < pl.points.length - 1; i++) {
    if (pl.cum[i + 1] < fromAlongM) continue;
    const a = pl.points[i];
    const b = pl.points[i + 1];
    const A = toXY(a, a);
    const B = toXY(b, a);
    const P = toXY(p, a);
    const len2 = B.x * B.x + B.y * B.y;
    let t = len2 === 0 ? 0 : (P.x * B.x + P.y * B.y) / len2;
    t = Math.max(0, Math.min(1, t));
    const segLen = pl.cum[i + 1] - pl.cum[i];
    let along = pl.cum[i] + t * segLen;
    if (along < fromAlongM) {
      // 구간 안에서 fromAlong 이전이면 fromAlong 지점으로 당긴다
      along = fromAlongM;
      t = segLen === 0 ? 0 : (fromAlongM - pl.cum[i]) / segLen;
    }
    const qx = A.x + (B.x - A.x) * t;
    const qy = A.y + (B.y - A.y) * t;
    const q = fromXY(qx, qy, a);
    const d = haversineM(q, p);
    if (!best || d < best.distM) best = { alongM: along, distM: d, segIndex: i, point: q };
  }
  return best;
}

/** 누적 거리 s 위치의 점과 진행 방향 */
export function pointAtAlong(pl: Polyline, s: number): { point: LatLng; segIndex: number; headingDeg: number } {
  const n = pl.points.length;
  if (n === 0) throw new Error("빈 폴리라인");
  if (n === 1) return { point: pl.points[0], segIndex: 0, headingDeg: 0 };
  const total = pl.cum[n - 1];
  const x = Math.max(0, Math.min(total, s));
  let i = 0;
  // 이진 탐색
  let lo = 0;
  let hi = n - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pl.cum[mid] <= x) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const a = pl.points[i];
  const b = pl.points[i + 1];
  const segLen = pl.cum[i + 1] - pl.cum[i];
  const t = segLen === 0 ? 0 : (x - pl.cum[i]) / segLen;
  return {
    point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
    segIndex: i,
    headingDeg: bearingDeg(a, b),
  };
}

/** id로 정해지는 가짜 중심(150~350m 이동)과 반경 — 수락 전에는 이 범위만 보인다. */
export function approxArea(p: LatLng, seed: string, radiusM = 500): { lat: number; lng: number; radiusM: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = ((h >>> 0) % 10000) / 10000;
  const v = (((h >>> 0) / 10000) % 10000) / 10000;
  const dist = 150 + 200 * u;
  const ang = 2 * Math.PI * v;
  const q = fromXY(Math.cos(ang) * dist, Math.sin(ang) * dist, p);
  return { lat: round6(q.lat), lng: round6(q.lng), radiusM };
}

export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
