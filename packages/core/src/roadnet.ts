/**
 * 도로망과 경로 계산.
 *
 * NaviHelper에는 경로 선(폴리라인)과 "여기 들르면 몇 분 더" 같은 가정 경로 계산이 없다(API_MATRIX).
 * 그래서 서버는 RoutingProvider로 경로 선·구간 시간을 계산한다. 실제 서비스에서는 외부 길찾기 API
 * (카카오모빌리티·TMAP 등)를 같은 인터페이스로 붙이고, 시연·테스트는 이 파일의 GraphRouter(시연 지역 도로망)를 쓴다.
 */
import { bearingDeg, haversineM, makePolyline, turnAngleDeg, type LatLng, type Polyline } from "./geo.ts";

export type RoadClass = "expressway" | "urban_expressway" | "arterial" | "local" | "access";

export interface RoadNode extends LatLng {
  id: string;
  name: string;
  /** 지도에 지명 표시 */
  label?: boolean;
}

export interface RoadEdge {
  from: string;
  to: string;
  name: string;
  cls: RoadClass;
  speedKph: number;
  /** 중간 모양 점(선택) */
  shape?: LatLng[];
}

export interface RoadNet {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

/** Pleos NaviHelper TurnType 중 이 앱이 쓰는 값 (API_MATRIX: TurnType 43종) */
export type TurnType =
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "TURN_SHARP_L"
  | "TURN_SHARP_R"
  | "TURN_KEEP_L"
  | "TURN_KEEP_R"
  | "TURN_STRAIGHT"
  | "TURN_ENTER_IC_R"
  | "TURN_EXIT_IC_R"
  | "TURN_UTURN"
  | "TURN_WAY"
  | "TURN_ARRIVE";

export type RouteOption = "RECOMMENDED" | "SHORT_TIME" | "SHORT_DISTANCE" | "COMFORTABLE";

export interface RouteStep {
  name: string;
  cls: RoadClass;
  fromAlongM: number;
  toAlongM: number;
  timeS: number;
  speedKph: number;
}

export interface Maneuver {
  alongM: number;
  type: TurnType;
  /** 들어가는 도로 이름 */
  roadName: string;
  /** 갈림 지점 이름 */
  atName: string;
}

export interface Route {
  line: Polyline;
  /** 각 점까지의 누적 시간(초) */
  cumTimeS: number[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
  maneuvers: Maneuver[];
  /** 경유지(중간 점)들의 누적 거리 */
  viaAlongM: number[];
  /** 지나는 노드 이름(중복 제거) — 화면 요약용 */
  viaNames: string[];
  option: RouteOption;
}

export interface RoutingProvider {
  /** points[0] 출발, 마지막 도착, 사이는 경유지 */
  route(points: LatLng[], option?: RouteOption): Route | null;
}

interface Adj {
  to: string;
  edge: RoadEdge;
  forward: boolean;
  lenM: number;
}

export class Graph {
  readonly nodes = new Map<string, RoadNode>();
  readonly adj = new Map<string, Adj[]>();

  constructor(readonly net: RoadNet) {
    for (const n of net.nodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    for (const e of net.edges) {
      const a = this.nodes.get(e.from);
      const b = this.nodes.get(e.to);
      if (!a || !b) throw new Error(`도로망 오류: ${e.from}–${e.to}`);
      const pts = [a, ...(e.shape ?? []), b];
      const lenM = makePolyline(pts).cum[pts.length - 1];
      this.adj.get(e.from)!.push({ to: e.to, edge: e, forward: true, lenM });
      this.adj.get(e.to)!.push({ to: e.from, edge: e, forward: false, lenM });
    }
  }

  node(id: string): RoadNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`없는 노드 ${id}`);
    return n;
  }

  nearestNode(p: LatLng): { node: RoadNode; distM: number } {
    let best: RoadNode | null = null;
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = haversineM(n, p);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return { node: best!, distM: bd };
  }
}

const ACCESS_SPEED_KPH = 20;

function edgeCostS(a: Adj, option: RouteOption): number {
  const base = a.lenM / (a.edge.speedKph / 3.6);
  if (option === "SHORT_DISTANCE") return a.lenM;
  if (option === "COMFORTABLE") {
    // 편안한 길: 골목(local)과 급한 길을 덜 쓰도록 가중
    if (a.edge.cls === "local") return base * 1.5;
    if (a.edge.cls === "expressway" || a.edge.cls === "urban_expressway") return base * 0.95;
  }
  return base;
}

/** 시연 지역 도로망으로 경로를 계산한다(Dijkstra). */
export class GraphRouter implements RoutingProvider {
  private cache = new Map<string, Route | null>();
  constructor(readonly graph: Graph) {}

  private dijkstra(src: string, dst: string, option: RouteOption): Adj[] | null {
    if (src === dst) return [];
    const dist = new Map<string, number>([[src, 0]]);
    const prev = new Map<string, { from: string; via: Adj }>();
    const done = new Set<string>();
    // 노드 수가 수십 개라 단순 선형 탐색으로 충분하다
    while (true) {
      let u: string | null = null;
      let ud = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < ud) {
        u = k;
        ud = v;
      }
      if (u === null) return null;
      if (u === dst) break;
      done.add(u);
      for (const a of this.graph.adj.get(u) ?? []) {
        const nd = ud + edgeCostS(a, option);
        if (nd < (dist.get(a.to) ?? Infinity)) {
          dist.set(a.to, nd);
          prev.set(a.to, { from: u, via: a });
        }
      }
    }
    const path: Adj[] = [];
    let cur = dst;
    while (cur !== src) {
      const p = prev.get(cur);
      if (!p) return null;
      path.unshift(p.via);
      cur = p.from;
    }
    return path;
  }

  route(points: LatLng[], option: RouteOption = "RECOMMENDED"): Route | null {
    if (points.length < 2) return null;
    const key =
      option + "|" + points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");
    if (this.cache.has(key)) return this.cache.get(key)!;
    const r = this.compute(points, option);
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }

  private compute(points: LatLng[], option: RouteOption): Route | null {
    const pts: LatLng[] = [];
    const segTime: number[] = [];
    const segInfo: { name: string; cls: RoadClass; speed: number }[] = [];
    const nodeAt: (string | null)[] = [];
    const viaIdx: number[] = [];
    const viaNames: string[] = [];

    const pushPoint = (p: LatLng, nodeId: string | null, timeS: number, info?: { name: string; cls: RoadClass; speed: number }) => {
      const last = pts[pts.length - 1];
      if (last && haversineM(last, p) < 0.5) {
        if (nodeId && !nodeAt[nodeAt.length - 1]) nodeAt[nodeAt.length - 1] = nodeId;
        return;
      }
      if (pts.length > 0) {
        segTime.push(timeS);
        segInfo.push(info ?? { name: "진입로", cls: "access", speed: ACCESS_SPEED_KPH });
      }
      pts.push(p);
      nodeAt.push(nodeId);
    };

    for (let leg = 0; leg < points.length - 1; leg++) {
      const from = points[leg];
      const to = points[leg + 1];
      const sn = this.graph.nearestNode(from).node;
      const tn = this.graph.nearestNode(to).node;
      if (leg === 0) pushPoint(from, null, 0);
      // 출발점 → 가장 가까운 노드
      const accessIn = haversineM(from, sn);
      pushPoint(sn, sn.id, accessIn / (ACCESS_SPEED_KPH / 3.6));
      const path = this.dijkstra(sn.id, tn.id, option);
      if (!path) return null;
      let curId = sn.id;
      for (const a of path) {
        const e = a.edge;
        const shape = e.shape ? (a.forward ? e.shape : [...e.shape].reverse()) : [];
        const target = this.graph.node(a.to);
        const chain = [...shape, target];
        const total = a.lenM;
        let prevP: LatLng = this.graph.node(curId);
        for (let k = 0; k < chain.length; k++) {
          const q = chain[k];
          const d = haversineM(prevP, q);
          const t = (total === 0 ? 0 : d) / (e.speedKph / 3.6);
          pushPoint(q, k === chain.length - 1 ? target.id : null, t, { name: e.name, cls: e.cls, speed: e.speedKph });
          prevP = q;
        }
        curId = a.to;
        if (target.label !== false && !viaNames.includes(target.name)) viaNames.push(target.name);
      }
      // 노드 → 도착점
      const accessOut = haversineM(tn, to);
      pushPoint(to, null, accessOut / (ACCESS_SPEED_KPH / 3.6));
      if (leg < points.length - 2) viaIdx.push(pts.length - 1);
    }

    const line = makePolyline(pts);
    const cumTimeS = [0];
    for (let i = 0; i < segTime.length; i++) cumTimeS.push(cumTimeS[i] + segTime[i]);

    // 구간(step): 같은 도로 이름이 이어지는 구간을 묶는다
    const steps: RouteStep[] = [];
    for (let i = 0; i < segInfo.length; i++) {
      const s = segInfo[i];
      const last = steps[steps.length - 1];
      if (last && last.name === s.name && last.cls === s.cls) {
        last.toAlongM = line.cum[i + 1];
        last.timeS += segTime[i];
      } else {
        steps.push({ name: s.name, cls: s.cls, fromAlongM: line.cum[i], toAlongM: line.cum[i + 1], timeS: segTime[i], speedKph: s.speed });
      }
    }

    // 회전 안내(TBT): 도로가 바뀌거나 크게 꺾이는 점
    const maneuvers: Maneuver[] = [];
    const viaAlong = viaIdx.map((i) => line.cum[i]);
    for (let i = 1; i < pts.length - 1; i++) {
      const inInfo = segInfo[i - 1];
      const outInfo = segInfo[i];
      const ang = turnAngleDeg(bearingDeg(pts[i - 1], pts[i]), bearingDeg(pts[i], pts[i + 1]));
      const isVia = viaIdx.includes(i);
      const roadChanged = inInfo.name !== outInfo.name;
      if (!isVia && !roadChanged && Math.abs(ang) < 40) continue;
      if (inInfo.cls === "access" || (outInfo.cls === "access" && !isVia)) continue;
      let type: TurnType;
      const exp = (c: RoadClass) => c === "expressway" || c === "urban_expressway";
      if (isVia) type = "TURN_WAY";
      else if (exp(outInfo.cls) && !exp(inInfo.cls)) type = "TURN_ENTER_IC_R";
      else if (!exp(outInfo.cls) && exp(inInfo.cls)) type = "TURN_EXIT_IC_R";
      else if (Math.abs(ang) > 150) type = "TURN_UTURN";
      else if (ang > 100) type = "TURN_SHARP_R";
      else if (ang < -100) type = "TURN_SHARP_L";
      else if (ang > 40) type = "TURN_RIGHT";
      else if (ang < -40) type = "TURN_LEFT";
      else if (ang > 12) type = "TURN_KEEP_R";
      else if (ang < -12) type = "TURN_KEEP_L";
      else type = "TURN_STRAIGHT";
      const atNode = nodeAt[i] ? this.graph.node(nodeAt[i]!).name : "";
      maneuvers.push({ alongM: line.cum[i], type, roadName: outInfo.name, atName: atNode });
    }
    maneuvers.push({ alongM: line.cum[pts.length - 1], type: "TURN_ARRIVE", roadName: "", atName: "도착" });

    return {
      line,
      cumTimeS,
      distanceM: line.cum[pts.length - 1],
      durationS: cumTimeS[cumTimeS.length - 1],
      steps,
      maneuvers,
      viaAlongM: viaAlong,
      viaNames,
      option,
    };
  }
}

/** 누적 거리 s 지점까지 걸리는 누적 시간(초) — 경로 안에서 선형 보간 */
export function timeAtAlong(r: Route, s: number): number {
  const cum = r.line.cum;
  const n = cum.length;
  if (s <= 0) return 0;
  if (s >= cum[n - 1]) return r.cumTimeS[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg === 0 ? 0 : (s - cum[lo]) / seg;
  return r.cumTimeS[lo] + t * (r.cumTimeS[hi] - r.cumTimeS[lo]);
}

/** 누적 거리 s에서의 제한 속도(구간 속도, km/h) */
export function speedAtAlong(r: Route, s: number): number {
  for (const st of r.steps) if (s >= st.fromAlongM && s <= st.toAlongM) return st.speedKph;
  return r.steps.length ? r.steps[r.steps.length - 1].speedKph : 30;
}

/** 다음 회전 안내 */
export function nextManeuver(r: Route, s: number): (Maneuver & { distanceM: number }) | null {
  for (const m of r.maneuvers) if (m.alongM > s + 1) return { ...m, distanceM: m.alongM - s };
  return null;
}
