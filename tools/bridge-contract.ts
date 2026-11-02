/**
 * Android 셸 브리지 계약 시험 — 차량 웹이 "실제 SDK 모드"(window.PleosBridge가 있을 때)로 끝까지 도는지 본다.
 * Kotlin PleosBackend와 같은 프로토콜(docs/BRIDGE.md)로 답하는 가짜 브리지를 페이지에 넣고,
 * 이 스크립트가 내비 역할(위치·남은 시간·TBT·경유지·도착 콜백)을 하며 차를 움직인다.
 *   node node_modules/tsx/dist/cli.mjs tools/bridge-contract.ts
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_NET, DEMO_PLACES, Graph, GraphRouter, nextManeuver, pointAtAlong, timeAtAlong, type LatLng, type Route } from "../packages/core/src/index.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tools/out");
const PORT = 8792;
const BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error("확인 실패: " + msg);
  log("✓", msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(method: string, p: string, token?: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as T;
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

/** 페이지 안 가짜 브리지: Kotlin PleosBackend와 같은 메서드·결과·이벤트 */
const MOCK = `
(() => {
  const st = {
    status: "FREE_DRIVE", dest: null, loc: { latitude: ${DEMO_PLACES.start.lat}, longitude: ${DEMO_PLACES.start.lng}, heading: 0, address: "" },
    wps: [], tbt: [], restricted: false, soc: 62, odoKm: 0, failAddWaypoint: false,
  };
  const calls = [];
  const hav = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b.latitude - a.latitude) * r, dLo = (b.longitude - a.longitude) * r;
    const x = Math.sin(dLa/2)**2 + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(x)); };
  const emit = (event, payload) => window.__pleos && window.__pleos.emit(event, JSON.stringify(payload ?? null));
  const handlers = {
    "NaviHelper.getNavigationStatus": () => st.status,
    "NaviHelper.getDestinationInfo": () => (st.status === "ROUTE_DRIVE" ? st.dest : null),
    "NaviHelper.getCurrentLocationInfo": () => st.loc,
    "NaviHelper.getWaypointInfo": () => st.wps,
    "NaviHelper.getTBTInfo": () => st.tbt,
    "NaviHelper.requestTrip": (a) => {
      const d = hav(st.loc, a); const eta = Math.round(d / 11);
      return { distance: Math.round(d), eta, estimatedSocAtDest: Math.round(st.soc - d / 1000 * 0.24), energyConsumption: d / 1000 * 0.16, summary: "" };
    },
    "NaviHelper.addWaypoint": (a) => {
      // Kotlin: onError(CAUSE_SEARCH_ROUTE)를 받으면 이벤트를 내보내고 호출을 실패로 끝낸다
      if (st.failAddWaypoint || st.wps.length >= 2) { setTimeout(() => emit("NaviHelper.onError", "CAUSE_SEARCH_ROUTE"), 5); throw new Error("NAVI_CAUSE_SEARCH_ROUTE"); }
      st.wps.push({ name: a.poiName, address: a.address, latitude: a.latitude, longitude: a.longitude, remainDistance: Math.round(hav(st.loc, a)), remainTime: 300, poiId: a.poiId });
      setTimeout(() => emit("NaviHelper.onWayPointInfo", st.wps), 30);
      return null;
    },
    "NaviHelper.removeWaypoint": (a) => { if (a.idx === "ALL") st.wps = []; else if (a.idx === "FIRST") st.wps.shift(); else st.wps.splice(1, 1); return null; },
    "NaviHelper.changeRouteOption": () => null,
    "NaviHelper.cancelRoute": () => { st.status = "FREE_DRIVE"; st.dest = null; return null; },
    "NaviHelper.requestRoute": () => { throw new Error("UNVERIFIED_ROUTE_INFO"); },
    "NaviHelper.requestRouteWithWaypoints": () => { throw new Error("UNVERIFIED_ROUTE_INFO"); },
    "Vehicle.getCarInfo": () => ({ manufacturer: null, model: null, modelYear: null }),
    "Vehicle.capabilities": () => ({ steeringWheelAngle: "READ", evBatteryStateOfCharge: "READ" }),
    "Vehicle.registerSeatOccupancy": () => null,
    "Vehicle.getEvBatteryStateOfCharge": () => st.soc,
    "Vehicle.registerEvBatteryStateOfCharge": () => null,
    "Vehicle.getFuelRangeKm": () => null,
    "Vehicle.registerTurnSignalState": () => null,
    "Vehicle.registerSteeringWheelAngle": () => null,
    "Vehicle.registerBrakePedalStatus": () => null,
    "Vehicle.getOdometerKm": () => st.odoKm,
    "Vehicle.registerTrunkOpen": () => null,
    "CarUx.current": () => st.restricted,
    "Voice.capabilities": () => ({ tts: true, stt: false, ttsEngine: "pleos" }),
    "Voice.speak": () => null,
    "Voice.stop": () => null,
    "Voice.listen": () => null,
  };
  window.PleosBridge = {
    call(id, method, argsJson) {
      const args = argsJson ? JSON.parse(argsJson) : {};
      calls.push({ method, args, at: Date.now() });
      setTimeout(() => {
        const h = handlers[method];
        try {
          if (!h) throw new Error("알 수 없는 메서드: " + method);
          window.__pleos.resolve(id, JSON.stringify(h(args) ?? null));
        } catch (e) { window.__pleos.reject(id, String(e.message || e)); }
      }, 5);
    },
  };
  window.__mock = { st, calls, emit, set(p) { Object.assign(st, p); } };
})();
`;

type MockCall = { method: string; args: Record<string, unknown> };

(async () => {
  const db = path.join(OUT, "bridge.sqlite");
  for (const f of [db, db + "-wal", db + "-shm"]) fs.rmSync(f, { force: true });
  const server = spawn(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "services/api/src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), JHGO_DB: db },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => {
    const s = String(d);
    if (!s.includes("ExperimentalWarning") && !s.includes("trace-warnings")) process.stderr.write("[server] " + s);
  });
  const browser = await chromium.launch();
  let driving: { stop: boolean } | null = null;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE + "/v1/health")).ok) break;
      } catch {}
      await sleep(500);
    }
    await api("POST", "/v1/demo/reset", undefined, { includeCarSeat: true, rate: 1 });
    const { users } = await api<{ users: { id: string; role: string; name: string }[] }>("GET", "/v1/demo/users");
    const park = users.find((u) => u.name === "박서연")!;
    const { token: sellerToken } = await api<{ token: string }>("POST", "/v1/session", undefined, { userId: park.id });
    const buyer = users.find((u) => u.role === "buyer")!;
    const { token: buyerToken } = await api<{ token: string }>("POST", "/v1/session", undefined, { userId: buyer.id });

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => log("페이지 오류:", e.message));
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") if (!m.text().includes("ERR_TUNNEL")) log("콘솔:", m.text().slice(0, 200));
    });
    await page.addInitScript(MOCK);
    await page.goto(BASE + "/car/", { waitUntil: "load" });
    await page.getByTestId("car-screen").waitFor();
    const calls = () => page.evaluate(() => (window as unknown as { __mock: { calls: MockCall[] } }).__mock.calls.map((c) => ({ method: c.method, args: c.args })));
    const mock = {
      set: (p: Record<string, unknown>) => page.evaluate((x) => (window as unknown as { __mock: { set(p: unknown): void } }).__mock.set(x), p),
      emit: (event: string, payload: unknown) => page.evaluate(([e, v]) => (window as unknown as { __mock: { emit(e: string, v: unknown): void } }).__mock.emit(e as string, v), [event, payload] as const),
      wps: () => page.evaluate(() => (window as unknown as { __mock: { st: { wps: { latitude: number; longitude: number }[] } } }).__mock.st.wps),
    };
    const waitCall = async (method: string, pred: (c: MockCall) => boolean = () => true, timeout = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const c = (await calls()).find((x) => x.method === method && pred(x));
        if (c) return c;
        await sleep(200);
      }
      throw new Error(`${method} 호출을 기다리다 시간 초과`);
    };

    // ── 부팅: 실제 SDK 모드 ──
    await page.waitForTimeout(1500);
    check(!(await page.locator(".c-badge-sim").count()), "시뮬레이터 표시 없음(브리지 모드)");
    for (const m of ["Vehicle.registerSeatOccupancy", "Vehicle.registerTurnSignalState", "Vehicle.registerSteeringWheelAngle", "Vehicle.registerBrakePedalStatus", "CarUx.current", "Vehicle.getCarInfo", "Voice.capabilities"])
      await waitCall(m, () => true, 8000);
    check(true, "부팅 때 좌석·방향지시등·조향·브레이크 리스너, 주행 중 여부, 차 정보, 음성 능력을 브리지로 요청");
    const seatCall = (await calls()).find((c) => c.method === "Vehicle.registerSeatOccupancy")!;
    check(JSON.stringify(seatCall.args.area) === JSON.stringify(["ROW_2_LEFT", "ROW_2_CENTER", "ROW_2_RIGHT"]), "2열 좌석 3곳을 SeatValue 이름으로 등록");
    await mock.emit("Vehicle.onSeatOccupancyUpdated", true);

    // ── 목적지는 Pleos 내비에서: 목적지가 잡히면(정차 중) 브리핑이 저절로 열린다 ──
    const g = new Graph(DEMO_NET);
    const router = new GraphRouter(g);
    const home = DEMO_PLACES.home;
    let route: Route = router.route([DEMO_PLACES.start, home])!;
    const destInfo = (remainTimeS: number, remainDistM: number) => ({ latitude: home.lat, longitude: home.lng, name: "송파 집", address: "", remainDistance: Math.round(remainDistM), remainTime: Math.round(remainTimeS) });
    await mock.set({ status: "ROUTE_DRIVE", dest: destInfo(route.durationS, route.distanceM) });
    await mock.emit("NaviHelper.onNavigationStatus", "ROUTE_DRIVE");
    await mock.emit("NaviHelper.onDestinationInfo", destInfo(route.durationS, route.distanceM));
    const brief = page.getByTestId("sheet-briefing");
    await brief.getByText("이번 길에 관심 매물").waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    const bt = await brief.innerText();
    check(bt.includes("회전형 카시트") && bt.includes("2열에 사람이 있어"), "내비 목적지 → 출발 전 브리핑(2열 착석 이벤트 반영)");
    await page.screenshot({ path: path.join(OUT, "bridge-01-briefing.png") });
    await page.getByRole("button", { name: "지도", exact: true }).click();

    // ── 주행: 이 스크립트가 내비가 되어 위치·남은 시간·TBT를 준다 ──
    let rate = 10;
    await api("POST", "/v1/demo/clock", undefined, { rate });
    await mock.set({ restricted: true });
    await mock.emit("restriction", true);
    let tv = 0; // 현재 경로에서 지난 시간(초)
    let viaAlong: number | null = null;
    let paused = false;
    const alongAt = (r: Route, t: number) => {
      let lo = 0;
      let hi = r.distanceM;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (timeAtAlong(r, mid) < t) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    let odo = 0;
    let prev: LatLng = DEMO_PLACES.start;
    const state = { arrivedAtPickup: false, arrivedHome: false };
    driving = { stop: false };
    const drive = driving;
    const loop = (async () => {
      while (!drive.stop) {
        await sleep(250);
        if (paused) continue;
        try {
          await step();
        } catch (e) {
          log("주행 루프 오류:", (e as Error).message);
        }
      }
    })();
    async function step() {
      {
        tv += 0.25 * rate;
        const s = Math.min(alongAt(route, tv), route.distanceM);
        const p = pointAtAlong(route.line, s);
        const dLat = (p.point.lat - prev.lat) * 111000;
        const dLng = (p.point.lng - prev.lng) * 88000;
        odo += Math.sqrt(dLat * dLat + dLng * dLng) / 1000;
        prev = p.point;
        const m = nextManeuver(route, s);
        const tbt = m ? [{ type: m.type, distance: Math.round(m.distanceM), description: m.roadName }] : [];
        const wps = viaAlong !== null ? (await mock.wps()).map((w) => ({ ...w, remainDistance: Math.max(0, Math.round(viaAlong! - s)), remainTime: Math.max(0, Math.round(timeAtAlong(route, viaAlong!) - tv)) })) : [];
        await mock.set({
          loc: { latitude: p.point.lat, longitude: p.point.lng, heading: p.headingDeg, address: "" },
          dest: destInfo(route.durationS - timeAtAlong(route, s), route.distanceM - s),
          tbt,
          odoKm: odo,
          ...(viaAlong !== null ? { wps } : {}),
        });
        await mock.emit("NaviHelper.onTBTInfo", tbt);
        // 경유지 도착 → 정차 · onWayPointArrived(Kotlin은 지금 위치를 실어 보낸다) · 경유지 목록에서 빠짐
        if (viaAlong !== null && !state.arrivedAtPickup && s >= viaAlong - 5) {
          log(`경유지 도착 (along ${Math.round(s)} / ${Math.round(viaAlong)})`);
          state.arrivedAtPickup = true;
          paused = true;
          await mock.set({ restricted: false, wps: [] });
          await mock.emit("restriction", false);
          await mock.emit("NaviHelper.onWayPointArrived", { name: "", address: "", poiId: "", remainDistance: 0, remainTime: 0, latitude: p.point.lat, longitude: p.point.lng, raw: "WaypointArrivedInfo(...)" });
          await mock.emit("NaviHelper.onWayPointInfo", []);
          viaAlong = null;
        }
        // 목적지 도착: Kotlin은 ROUTE_DRIVE → INACTIVE 전환(300m 안)에서 onDestinationArrived를 만든다
        if (s >= route.distanceM - 1 && !state.arrivedHome) {
          state.arrivedHome = true;
          paused = true;
          await mock.set({ status: "INACTIVE", restricted: false });
          await mock.emit("restriction", false);
          await mock.emit("NaviHelper.onNavigationStatus", "INACTIVE");
          await mock.emit("NaviHelper.onDestinationArrived", null);
        }
      }
    }

    // 캠핑의자 알림: requestTrip으로 확인 → 알림 카드 + 음성(Voice.speak)
    const alert = page.getByTestId("alert");
    await alert.waitFor({ timeout: 60000 });
    check((await alert.innerText()).includes("캠핑의자"), "주행 중 캠핑의자 알림");
    const trip = await waitCall("NaviHelper.requestTrip", (c) => String(c.args.poiName).includes("캠핑의자"), 3000);
    check(typeof trip.args.latitude === "number" && String(trip.args.poiId).length > 0, "NaviHelper.requestTrip(대략 위치, poiId, poiName) 호출");
    await waitCall("Voice.speak", (c) => String(c.args.text).includes("캠핑의자"), 5000);
    check(true, "알림 문장을 셸 음성(Voice.speak → Pleos TTS)으로 말함");
    await page.screenshot({ path: path.join(OUT, "bridge-02-alert.png") });

    // T19: 내비가 경유지를 거부하면(경로 탐색 실패) 판매자 요청을 취소하고, 구매자 잘못이 아니니 신뢰도에 넣지 않는다
    await mock.set({ failAddWaypoint: true });
    const failFrom = (await calls()).length;
    await alert.getByRole("button", { name: "들를게요" }).click(); // 이캠핑: 자동 수락 시간대 → 바로 확정 → 경유지 시도
    await page.getByText("경로를 바꾸지 못했어요").waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500); // 늦게 오는 실시간 '수락' 알림이 경유지를 다시 넣지 않는지 본다
    const failCalls = (await calls()).slice(failFrom);
    const failTo = failFrom + failCalls.length;
    const { trades: buyerTrades } = await api<{ trades: { id: string; status: string; category: string; reason?: string }[] }>("GET", "/v1/buyer/trades", buyerToken);
    const camp = buyerTrades.find((t) => t.category === "camping_chair");
    check(camp?.status === "canceled", "경유지 실패 → 캠핑의자 거래 취소(대금 환불)");
    check(failCalls.filter((c) => c.method === "NaviHelper.addWaypoint").length === 1, "자동 수락이어도 경유지 추가는 한 번만(요청 응답·실시간 알림 중복 방지)");
    const prof = await api<{ trust: { canceled: number } }>("GET", "/v1/buyer/profile", buyerToken);
    check(prof.trust && prof.trust.canceled === 0, "차 쪽 실패 취소는 구매자 신뢰도(취소 횟수)에 넣지 않음");
    await mock.set({ failAddWaypoint: false });

    rate = 30;
    await api("POST", "/v1/demo/clock", undefined, { rate });
    const cont = page.getByTestId("contention");
    await cont.waitFor({ timeout: 90000 });
    check((await cont.innerText()).includes("카시트"), "경합 질문(카시트·유모차)");
    await cont.getByRole("button", { name: /카시트/ }).click();
    await alert.waitFor({ timeout: 10000 });
    await alert.getByRole("button", { name: "들를게요" }).click();
    await page.getByTestId("trade").waitFor();

    // 판매자 수락(API) → 차: addWaypoint → getWaypointInfo로 확인 → 확정
    let tradeId = "";
    for (let i = 0; i < 40 && !tradeId; i++) {
      const { trades } = await api<{ trades: { id: string; status: string }[] }>("GET", "/v1/seller/trades", sellerToken);
      tradeId = trades.find((t) => t.status === "requested")?.id ?? "";
      if (!tradeId) await sleep(250);
    }
    check(tradeId, "판매자에게 요청이 도착");
    await api("POST", `/v1/seller/trades/${tradeId}/accept`, sellerToken);
    const add = await waitCall("NaviHelper.addWaypoint", (c) => String(c.args.poiName).includes("픽업 · 카시트"), 15000);
    check(add.args.waypointIndex === "FIRST" && String(add.args.poiId).startsWith("jhgo:") && typeof add.args.latitude === "number", "NaviHelper.addWaypoint(RequestWaypointInfo: 좌표·FIRST·poiId) 호출");
    // 경로가 경유지를 지나게 다시 잡힌다(내비 역할)
    const pickup = { lat: add.args.latitude as number, lng: add.args.longitude as number };
    const here = (await page.evaluate(() => (window as unknown as { __mock: { st: { loc: { latitude: number; longitude: number } } } }).__mock.st.loc));
    route = router.route([{ lat: here.latitude, lng: here.longitude }, pickup, home])!;
    tv = 0;
    viaAlong = route.viaAlongM[0];
    await page.getByText("가는 중").waitFor({ timeout: 15000 });
    check(true, "getWaypointInfo로 경유지 반영 확인 → 거래 확정(가는 중)");
    await page.screenshot({ path: path.join(OUT, "bridge-03-on-the-way.png") });

    // 경유지 도착 → 정차 → 현장 확인
    const inspect = page.getByTestId("sheet-inspect");
    await inspect.waitFor({ timeout: 90000 }).catch(async (e) => {
      const dump = await page.evaluate(() => {
        const w = (window as unknown as { __jhgoCar: { controller: { state: Record<string, unknown> } } }).__jhgoCar;
        const st = w.controller.state as { trade: { status: string; pickupPoint: unknown } | null; screen: string; restricted: boolean; toasts: { text: string }[] };
        return { trade: st.trade && { status: st.trade.status, pickup: st.trade.pickupPoint }, screen: st.screen, restricted: st.restricted, toasts: st.toasts.map((t) => t.text) };
      });
      log("진단:", JSON.stringify(dump));
      const bt = await api<{ trades: { id: string; status: string; category: string; reason?: string; canceledBy?: string }[] }>("GET", "/v1/buyer/trades", buyerToken);
      log("구매자 거래:", JSON.stringify(bt.trades.map((t) => [t.category, t.status, t.canceledBy, t.reason])));
      const ev = await api<{ events: { type: string; title: string; at: number; data?: { trade?: { category?: string } } }[] }>("GET", "/v1/events", buyerToken);
      log("구매자 이벤트:", JSON.stringify(ev.events.slice(-10).map((x) => [x.type, x.data?.trade?.category, x.title])));
      const last = (await calls()).slice(-12).map((c) => c.method);
      log("마지막 호출:", last.join(", "));
      throw e;
    });
    check(true, "onWayPointArrived(지금 위치) + 정차 → 현장 확인 화면");
    await api("POST", `/v1/seller/trades/${tradeId}/handed`, sellerToken);
    await inspect.getByText("판매자가 건넸다고 표시했어요").waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, "bridge-04-inspect.png") });
    await inspect.getByRole("button", { name: "받았어요" }).click();
    await page.waitForTimeout(800);

    // 다시 출발 → 목적지 도착(onDestinationArrived) → 결과 카드
    await mock.set({ restricted: true });
    await mock.emit("restriction", true);
    paused = false;
    const result = page.getByTestId("sheet-result");
    await result.waitFor({ timeout: 120000 });
    const rt = await result.innerText();
    check(rt.includes("가는 길에 챙겼어요"), "목적지 도착 → 결과 카드");
    await page.screenshot({ path: path.join(OUT, "bridge-05-result.png") });

    const all = await calls();
    const routeIdx = all.map((c, i) => (c.method.startsWith("NaviHelper.requestRoute") ? i : -1)).filter((i) => i >= 0);
    check(routeIdx.every((i) => i >= failFrom && i < failTo), "목적지 설정 API(RouteInfo 미확인)는 경유지 실패 대체에서만 시도 — 정상 흐름은 쓰지 않음");
    const unknown = all.filter((c) => !c.method.includes("."));
    check(unknown.length === 0, "모든 호출이 '도메인.메서드' 이름");
    await page.getByRole("button", { name: /SDK 기록/ }).click();
    const drawer = await page.locator(".c-sdklog").innerText();
    check(drawer.includes("addWaypoint") && drawer.includes("requestTrip"), "SDK 기록 서랍에 실제 호출이 남음");
    await page.screenshot({ path: path.join(OUT, "bridge-06-sdklog.png") });
    const counts: Record<string, number> = {};
    for (const c of all) counts[c.method] = (counts[c.method] ?? 0) + 1;
    log("호출 횟수:", JSON.stringify(counts));
    log("브리지 계약 시험 통과");
    drive.stop = true;
    await loop;
  } finally {
    if (driving) driving.stop = true;
    await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
