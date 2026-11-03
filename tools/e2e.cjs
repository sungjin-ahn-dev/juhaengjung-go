/**
 * 끝까지 흐름 E2E — 판매자 폰(같이 올리기 → 요청 수락 → 건넸어요 → 정산)과
 * 차량 화면(브리핑 → 주행 → 알림 대기 → 경합 → 요청 → 경유지 → 도착 → 현장 확인 → 결과 카드·판매자 평가)을 함께 돌린다.
 * 2부: 판매자가 안 나올 때(도착 → 다시 알리기 → 5분 뒤 끝내기). 3부: 구매자 폰(결제 수단·거래 내역).
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
    // 헤드리스 크롬은 알림 권한이 기본으로 막혀 있다 — 사람이 '허용'을 누른 상태로 시작
    await phoneCtx.grantPermissions(["notifications"], { origin: BASE });
    const phone = await phoneCtx.newPage();
    phone.on("pageerror", (e) => log("판매자 페이지 오류:", e.message));
    const snapP = async (name) => phone.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, "0")}-seller-${name}.png`) });
    await phone.goto(BASE + "/seller/", { waitUntil: "load" });
    await phone.getByTestId("login-박서연").click();
    await phone.getByTestId("compose").click();
    await phone.locator("#paste").fill("[판매] 회전형 카시트 (신생아~4세)\n35,000원\n아이가 커서 정리해요. 커버 세탁했어요.");
    // 붙여 넣으면 '채우기'를 누르지 않아도 바로 채운다
    await phone.waitForFunction(() => document.querySelector("#title")?.value?.includes("카시트"));
    check((await phone.locator("#title").inputValue()).includes("회전형 카시트"), "붙여 넣으면 바로 제목·가격·품목·크기가 채워짐");
    check((await phone.getByTestId("size-source").innerText()) === "품목 기본 크기", "크기는 품목 기본 크기로 채웠다고 표시(사진 AI가 아님)");
    check((await phone.getByTestId("place-open").innerText()).includes("판교 백현동"), "거래 장소는 판매자 기본 장소로 미리 채움");
    await phone.getByRole("button", { name: "샘플 사진" }).click();
    check((await phone.getByTestId("fill-size").innerText()) === "품목 기본 크기로 채우기", "샘플 그림·AI 없는 서버에서는 '품목 기본 크기로 채우기'");
    // AI 추정 크기(45×55×68)는 60cm 이상 → 실측 확인 전에는 올릴 수 없다
    check(await phone.getByTestId("submit").isDisabled(), "큰 물건은 실측 확인 전 '올리기' 비활성");
    await phone.getByTestId("measured").click();
    await snapP("compose");
    check((await phone.getByTestId("submit").innerText()).includes("35,000원에 올리기"), "확인할 것이 끝나면 '35,000원에 올리기'");
    await phone.getByTestId("submit").click();
    await phone.getByTestId("posted").getByText("올렸어요").waitFor();
    await snapP("posted");
    await phone.getByTestId("posted-done").click();
    check((await phone.getByTestId("listing-row").count()) === 1, "카시트가 내 물건에 올라감");
    check((await phone.getByTestId("status").innerText()).includes("지금 요청을 받고 있어요"), "판매자 홈: 지금 요청을 받고 있어요");
    // 잠깐 쉬기(T27) → 다시 받기
    await phone.getByTestId("pause-open").click();
    await phone.getByTestId("pause-1h").click();
    await phone.getByTestId("status").getByText("쉬는 중이에요").waitFor();
    check(true, "잠깐 쉬기 1시간 → '쉬는 중이에요'");
    await phone.getByTestId("pause-off").click();
    await phone.getByTestId("status").getByText("지금 요청을 받고 있어요").waitFor();
    check(true, "다시 받기 → '지금 요청을 받고 있어요'");
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
    // 노출 수(T29): 판매자 폰에 '지나간 차 1대에 보였어요'
    await phone.reload({ waitUntil: "load" });
    await phone.getByTestId("listing-stats").getByText(/지나간 차 1대에 보였어요/).waitFor({ timeout: 10000 });
    check(true, "판매자 물건 줄: 지나간 차 1대에 보였어요(누가 봤는지는 없음)");

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
    // 음성으로 고르기: 알림 뒤 듣는 시간에 가상 콘솔이 마이크 대신 "카시트"를 넣는다
    await car.getByTestId("voice-state").getByText("듣는 중").waitFor({ timeout: 10000 });
    check((await car.getByTestId("voice-line").innerText()).includes('"카시트" 또는 "유모차"'), '자막: 듣고 있어요. "카시트" 또는 "유모차"');
    await car.getByTestId("voice-say-카시트").click();
    await car.getByTestId("voice-heard").waitFor({ timeout: 5000 });
    check(true, '음성 대답 "카시트" → 알아들었어요(시뮬레이터 음성 포트)');
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
    const pushRow = await phone.getByTestId("push-row").innerText();
    check(pushRow.includes("알림 받기"), `판매자 거래 탭: 페이지를 닫아도 받는 알림 켜기(웹 푸시) — ${pushRow}`);
    await snapP("on-the-way");

    // 도착 3분 전 '나오세요'(만남 화면) → 지금 나가요 → 차 화면에 표시
    const handoff = phone.getByTestId("handoff");
    await handoff.getByText("곧 도착해요").waitFor({ timeout: 90000 });
    check(true, "판매자: 도착 3분 전 만남 화면 '곧 도착해요, 물건을 들고 나와 주세요'");
    await snapP("come-out");
    await handoff.getByTestId("coming").click();
    await car.getByTestId("trade-seller-coming").waitFor({ timeout: 10000 });
    check(true, "판매자 '지금 나가요' → 차 화면 거래 카드에 '판매자가 나오고 있어요'");
    const inspect = car.getByTestId("sheet-inspect");
    await inspect.waitFor({ timeout: 90000 });
    check(true, "경유지 도착(onWayPointArrived) → 정차 → 현장 확인 화면");
    await handoff.getByText("구매자가 도착했어요").waitFor({ timeout: 10000 });
    check((await handoff.getByTestId("handoff-left").innerText()).includes("안에 나가 주세요"), "만남 화면: 구매자가 거래를 끝낼 수 있게 되기까지 남은 시간");
    await inspect.getByTestId("seller-coming").waitFor({ timeout: 5000 });
    check(true, "현장 확인 기다림 패널에도 '판매자가 나오고 있어요'");
    await car.getByTestId("trunk-open").click();
    await car.waitForTimeout(400);
    await car.getByTestId("trunk-close").click();
    await inspect.getByText("실으셨나요?").waitFor({ timeout: 5000 });
    check(true, "트렁크 열림→닫힘 → '실으셨나요?'");
    await handoff.getByTestId("handed").click();
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
    await result.getByRole("button", { name: "4점" }).click();
    await result.getByText("4점을 남겼어요").waitFor({ timeout: 5000 });
    check(true, "결과 카드에서 판매자 평가(4점)");
    await phone.getByRole("button", { name: "내 물건", exact: true }).click();
    await phone.waitForFunction(() => document.querySelector(".s-trust")?.textContent?.includes("평점 4"), null, { timeout: 20000 });
    check(true, "판매자 폰 머리에 평점 4");
    await snapC("result");

    const sdk = await car.getByTestId("sdk-log").innerText();
    for (const api of ["requestTrip", "addWaypoint", "onWayPointArrived", "onTurnSignalStateUpdated", "requiresDistractionOptimization", "목적지 도착"]) check(sdk.includes(api), `SDK 로그에 ${api}`);

    // ── 2부: 판매자가 안 나올 때(T20) — 자동 수락인 캠핑의자로 ──
    const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
    await post("/v1/demo/reset", { includeCarSeat: true });
    await car.reload({ waitUntil: "load" });
    await car.getByTestId("car-screen").waitFor();
    await car.waitForTimeout(1500);
    await car.getByRole("button", { name: "목적지", exact: true }).click();
    await car.getByTestId("sheet-destination").getByRole("button", { name: /송파 집/ }).click();
    await car.getByTestId("go-list").getByText(/관심 매물 \d개를 찾았어요/).waitFor({ timeout: 15000 });
    await car.getByRole("button", { name: "지도", exact: true }).click();
    await car.getByTestId("rate-10").click();
    await car.getByTestId("gear-d").click();
    await alert.waitFor({ timeout: 40000 });
    check((await alert.innerText()).includes("캠핑의자"), "2부: 캠핑의자 알림");
    await alert.getByRole("button", { name: "들를게요" }).click();
    await car.getByText("가는 중").waitFor({ timeout: 15000 });
    await inspect.waitFor({ timeout: 90000 });
    const wait = car.getByTestId("seller-wait");
    await wait.waitFor({ timeout: 5000 });
    check(await car.getByTestId("seller-absent").isDisabled(), "도착 직후에는 '판매자가 안 나왔어요'를 누를 수 없음(5분 기다림)");
    await car.getByTestId("nudge").click();
    await car.waitForFunction(() => document.querySelector('[data-testid="nudge"]')?.textContent === "다시 알렸어요", null, { timeout: 5000 });
    check(true, "판매자에게 다시 알리기");
    await snapC("seller-wait");
    const clk = await fetch(BASE + "/v1/clock").then((r) => r.json());
    await post("/v1/demo/clock", { now: clk.now + 5 * 60_000 + 2000, rate: 1 });
    await car.waitForFunction(() => !document.querySelector('[data-testid="seller-absent"]')?.hasAttribute("disabled"), null, { timeout: 15000 });
    await car.getByTestId("seller-absent").click();
    await car.getByTestId("seller-absent-confirm").click();
    await inspect.waitFor({ state: "detached", timeout: 10000 });
    const users = await fetch(BASE + "/v1/demo/users").then((r) => r.json());
    const camp = users.users.find((u) => u.name === "이캠핑");
    const { token } = await post("/v1/session", { userId: camp.id });
    const st = await fetch(BASE + "/v1/seller/trades", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    check(st.trades[0]?.status === "seller_no_show" && st.trades[0]?.payment.status === "refunded", "5분 뒤 '판매자가 안 나왔어요' → 거래 끝, 전액 환불(판매자 미응대)");

    // ── 3부: 구매자 폰 — 결제 수단, 거래 내역 ──
    const bphone = await phoneCtx.newPage();
    bphone.on("pageerror", (e) => log("구매자 페이지 오류:", e.message));
    await bphone.goto(BASE + "/buyer/", { waitUntil: "load" });
    await bphone.getByTestId("blogin-김주행").click();
    await bphone.getByTestId("buyer-app").waitFor();
    check((await bphone.getByTestId("pay-method").innerText()).includes("테스트 결제 수단"), "구매자 폰 홈: 결제 수단(테스트) 등록됨");
    await bphone.getByText("판매자 못 만남, 환불").first().waitFor({ timeout: 10000 });
    check(true, "구매자 폰 최근 거래: 판매자 못 만남, 환불");
    await bphone.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, "0")}-buyer-home.png`) });
    await bphone.getByTestId("b-trade-camping_chair").first().click();
    const sheet = bphone.getByTestId("trade-sheet");
    check((await sheet.innerText()).includes("전액 환불됐어요"), "거래 상세: 대금 흐름(전액 환불)과 시간순 기록");
    await bphone.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, "0")}-buyer-trade.png`) });
    log("E2E 통과");
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
