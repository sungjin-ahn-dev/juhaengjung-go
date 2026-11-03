/**
 * 끝까지 흐름 E2E — 판매자 폰(같이 올리기 → 요청 수락 → 건넸어요 → 정산)과
 * 차량 화면(브리핑 → 주행 → 알림 대기 → 경합 → 요청 → 경유지 → 도착 → 현장 확인 → 결과 카드)을 함께 돌린다.
 *   node tools/e2e.cjs            # 서버를 띄우고 실행, 스크린샷은 tools/out/
 */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools/out");
const PORT = 8790;
const BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function check(cond, msg) {
  if (!cond) throw new Error("확인 실패: " + msg);
  log("✓", msg);
}

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + "/v1/health");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("서버가 뜨지 않았어요");
}

(async () => {
  const db = path.join(OUT, "e2e.sqlite");
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
  let browser;
  let shot = 0;
  try {
    await waitHealth();
    await fetch(BASE + "/v1/demo/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ includeCarSeat: false }) });
    browser = await chromium.launch();

    // ── 판매자 폰 ──
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const phone = await phoneCtx.newPage();
    phone.on("pageerror", (e) => log("판매자 페이지 오류:", e.message));
    const snapP = async (name) => phone.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, "0")}-seller-${name}.png`) });
    await phone.goto(BASE + "/seller/", { waitUntil: "load" });
    await phone.getByTestId("login-박서연").click();
    await phone.getByTestId("compose").click();
    await phone.locator("#paste").fill("[판매] 회전형 카시트 (신생아~4세)\n35,000원\n아이가 커서 정리해요. 커버 세탁했어요.");
    await phone.getByTestId("fill").click();
    await phone.waitForFunction(() => document.querySelector("#title")?.value?.includes("카시트"));
    check((await phone.locator("#title").inputValue()).includes("회전형 카시트"), "붙여넣기로 제목이 채워짐");
    await phone.getByRole("button", { name: "샘플 사진" }).click();
    // AI 추정 크기(45×55×68)는 60cm 이상 → 실측 확인 전에는 올릴 수 없다
    check(await phone.getByTestId("submit").isDisabled(), "큰 물건은 실측 확인 전 '올리기' 비활성");
    await phone.getByTestId("measured").check();
    await snapP("compose");
    await phone.getByTestId("submit").click();
    await phone.getByText("올렸어요").waitFor();
    check((await phone.getByTestId("listing-row").count()) === 1, "카시트가 내 물건에 올라감");
    await snapP("listings");

    // ── 차량 화면 ──
    const carCtx = await browser.newContext({ viewport: { width: 1720, height: 860 } });
    const car = await carCtx.newPage();
    car.on("pageerror", (e) => log("차량 페이지 오류:", e.message));
    const snapC = async (name) => car.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, "0")}-car-${name}.png`) });
    await car.goto(BASE + "/car/", { waitUntil: "load" });
    await car.getByTestId("car-screen").waitFor();
    await car.waitForTimeout(1200);
    await car.getByTestId("row2").check();
    await car.getByRole("button", { name: "목적지", exact: true }).click();
    await car.getByTestId("sheet-destination").getByRole("button", { name: /송파 집/ }).click();
    // 출발 전 브리핑 = 지도 번호 핀 + 오른쪽 추천순 목록(사진·판매자 설명·우회·거리)
    const brief = car.getByTestId("go-list");
    await brief.getByText("관심 매물 4개를 찾았어요").waitFor({ timeout: 15000 });
    await car.waitForTimeout(800);
    const briefText = await brief.innerText();
    check(briefText.includes("2열에 사람이 있어 2열을 접을 수 없어요"), "브리핑: 2열 착석이라 아기 침대 제외(Seat)");
    check(briefText.includes("회전형 카시트") && briefText.includes("아이가 커서 정리해요"), "브리핑: 방금 올린 카시트가 사진·판매자 설명과 함께 목록에");
    const rows = await brief.locator(".c-item:not(.out) .c-rank").allInnerTexts();
    check(rows.join(",") === "1,2,3", "알릴 수 있는 매물 3개가 추천순 번호 1·2·3");
    check(/km 앞/.test(briefText) && /\+\d+분/.test(briefText), "목록에 경로상 거리와 우회 시간");
    await car.getByTestId("pin-카시트").click();
    check(await car.locator('[data-testid="go-row-카시트"].on').count() === 1, "지도 핀을 누르면 목록의 같은 매물이 표시됨");
    await snapC("briefing");
    await car.getByRole("button", { name: "지도", exact: true }).click();

    // 출발 — 방향지시등을 켠 동안에는 알림을 미룬다(T8). 첫 알림 구간은 10배속으로 여유 있게
    await car.getByTestId("rate-10").click();
    await car.getByTestId("signal-right").click();
    await car.getByTestId("gear-d").click();
    await car.getByText(/알림 대기: .*방향지시등/).waitFor({ timeout: 15000 });
    check(!(await car.getByTestId("alert").isVisible()), "방향지시등이 켜진 동안 알림 대기");
    await snapC("hold");
    const alert = car.getByTestId("alert");
    await alert.waitFor({ timeout: 30000 });
    check((await alert.innerText()).includes("캠핑의자"), "영통 캠핑의자 알림(우회·적재·기준가·도착 배터리)");
    await snapC("alert-camp");
    await alert.getByRole("button", { name: "아니요" }).click();
    await car.getByTestId("rate-30").click();

    // 분당: 카시트와 유모차 경합 → 카시트
    const cont = car.getByTestId("contention");
    await cont.waitFor({ timeout: 90000 });
    const ct = await cont.innerText();
    check(ct.includes("카시트") && ct.includes("유모차"), "경합 질문: 카시트? 유모차?");
    await snapC("contention");
    await cont.getByRole("button", { name: /카시트/ }).click();
    await alert.waitFor({ timeout: 10000 });
    check((await alert.innerText()).includes("카시트"), "고른 카시트 상세 알림");
    await alert.getByRole("button", { name: "들를게요" }).click();
    await car.getByTestId("trade").waitFor();
    await snapC("requested");

    // 판매자: 차가 오고 있다 → 수락
    const take = phone.getByTestId("takeover");
    await take.waitFor({ timeout: 15000 });
    const tt = await take.innerText();
    check(tt.includes("사러 오는 차가 있어요") && tt.includes("트렁크에 쏙"), "판매자 화면: 도착 예정·차종·적재 판단");
    check(!/위도|경도|lat|lng/.test(tt), "판매자 화면에 구매자 위치 없음");
    await snapP("takeover");
    await take.getByTestId("accept").click();
    await phone.getByText("수락했어요").waitFor();

    // 차: 경유지 추가 → 다시 조회해 확인 → 확정
    await car.getByText("가는 중").waitFor({ timeout: 15000 });
    await car.waitForFunction(() => document.querySelector('[data-testid="sdk-log"]')?.textContent?.includes("addWaypoint(주행중GO! 픽업"), null, { timeout: 15000 });
    check(true, "NaviHelper.addWaypoint(주행중GO! 픽업 · 카시트) 호출");
    await snapC("on-the-way");
    await phone.getByTestId("tab-trades").click();
    await phone.getByTestId("active-trade").waitFor();
    await snapP("on-the-way");

    // 도착 3분 전 '나오세요' → 도착 → 정차 → 현장 확인
    await phone.getByText("곧 도착해요. 물건을 들고 나와 주세요").waitFor({ timeout: 90000 });
    check(true, "판매자: 도착 3분 전 '나오세요'");
    await snapP("come-out");
    const inspect = car.getByTestId("sheet-inspect");
    await inspect.waitFor({ timeout: 90000 });
    check(true, "경유지 도착(onWayPointArrived) → 정차 → 현장 확인 화면");
    await phone.getByText("구매자가 도착했어요").waitFor({ timeout: 10000 });
    await car.getByTestId("trunk-open").click();
    await car.waitForTimeout(400);
    await car.getByTestId("trunk-close").click();
    await inspect.getByText("실으셨나요?").waitFor({ timeout: 5000 });
    check(true, "트렁크 열림→닫힘 → '실으셨나요?'");
    await phone.getByTestId("handed").click();
    await inspect.getByText("판매자가 건넸다고 표시했어요").waitFor({ timeout: 10000 });
    await snapC("inspect");
    await inspect.getByRole("button", { name: "받았어요" }).click();
    await phone.getByText(/구매자가 받았어요/).first().waitFor({ timeout: 10000 });
    check(true, "받았어요 → 판매자에게 알림, 정산 예정");

    // 정산 (시연 10분 = 30배속 약 20초)
    await phone.getByRole("button", { name: "정산", exact: true }).click();
    await phone.waitForFunction(() => document.querySelector('[data-testid="money"]')?.textContent?.includes("정산 완료35,000원"), null, { timeout: 60000 });
    check(true, "이의 제기 기간 뒤 35,000원 정산");
    await snapP("settled");

    // 다시 출발 → 목적지 → 결과 카드
    await car.getByTestId("gear-d").click();
    const result = car.getByTestId("sheet-result");
    await result.waitFor({ timeout: 120000 });
    const rt = await result.innerText();
    check(rt.includes("가는 길에 챙겼어요") && rt.includes("따로 다녀왔다면"), "목적지 도착 → 결과 카드(Odometer 거리 포함)");
    await snapC("result");

    const sdk = await car.getByTestId("sdk-log").innerText();
    for (const api of ["requestTrip", "addWaypoint", "onWayPointArrived", "onTurnSignalStateUpdated", "requiresDistractionOptimization", "목적지 도착"]) check(sdk.includes(api), `SDK 로그에 ${api}`);
    log("E2E 통과");
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
