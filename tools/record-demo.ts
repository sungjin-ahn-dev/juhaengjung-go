/**
 * 기능별 시연 영상 녹화 — 체험 페이지(판매자 폰 + 차량 화면, 페이지 안 서버)를 한 번 끝까지 돌리며 녹화하고
 * 기능마다 잘라 MP4로 만든다. 차량 쪽은 브라우저 시뮬레이터(가상 콘솔 대신 시뮬레이터 함수를 직접 부른다).
 *   npm run build -w apps/demo
 *   JHGO_FONTS=<@fontsource 폴더> node node_modules/tsx/dist/cli.mjs tools/record-demo.ts [출력 폴더]
 * 글꼴 폴더(@fontsource/do-hyeon, @fontsource/ibm-plex-sans-kr가 든 node_modules/@fontsource)를 주면 앱 글꼴로 녹화한다.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cutClips, findMarks, PALETTE, recordOverlay, SYNC_H } from "./video-cut.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "tools/out/video"));
const SITE = path.join(OUT, "site");
const RAW = path.join(OUT, "raw");
const PORT = 8799;
const W = 1600;
const H = 900;
fs.mkdirSync(SITE, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 녹화용 페이지: 공유 페이지 조각 + 글꼴 ──
const fragment = fs.readFileSync(path.join(ROOT, "apps/demo/dist/jhgo-demo.html"), "utf8");
let fontLinks = "";
const fontsDir = process.env.JHGO_FONTS;
if (fontsDir && fs.existsSync(fontsDir)) {
  for (const pkg of ["do-hyeon", "ibm-plex-sans-kr"]) {
    fs.cpSync(path.join(fontsDir, pkg), path.join(SITE, "fonts", pkg), { recursive: true });
  }
  fontLinks = ['<link rel="stylesheet" href="fonts/do-hyeon/400.css">', ...[400, 600, 700].map((w) => `<link rel="stylesheet" href="fonts/ibm-plex-sans-kr/${w}.css">`)].join("\n");
}
fs.writeFileSync(
  path.join(SITE, "index.html"),
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${fontLinks}</head><body>\n${fragment}\n</body></html>\n`,
);

/** 녹화 화면: 머리말·시연 순서·가상 콘솔을 숨기고 차량 화면 + 판매자 폰만. 아래에 장면 설명, 누른 곳에 표시, 맨 아래 색 띠 */
const overlay = recordOverlay(SYNC_H + 26);
const LAYOUT_CSS = `
.bench-head, .bench-steps, .demo-car .vc { display: none !important; }
.bench { padding-block: 18px 0 !important; max-width: none !important; }
.bench-main { grid-template-columns: minmax(0, 1fr) 390px !important; }
.phone-note { display: none !important; }
.demo-car .c-caption { font-size: 15px; margin-top: 10px; }
${overlay.css}`;
const RECORD_INIT = `${overlay.init}
document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(LAYOUT_CSS)}; document.head.appendChild(st); });
`;

interface Mark {
  name: string;
  at: number;
}

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: SITE, stdio: "ignore" });
  await sleep(800);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H + SYNC_H }, colorScheme: "dark", recordVideo: { dir: RAW, size: { width: W, height: H + SYNC_H } } });
  await ctx.addInitScript(RECORD_INIT);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks: Mark[] = [];
  const mark = async (name: string) => {
    const color = PALETTE[marks.length % PALETTE.length];
    await page.evaluate((rgb) => (window as unknown as { __sync: (c: number[]) => void }).__sync(rgb), color);
    marks.push({ name, at: (Date.now() - t0) / 1000 });
    log("mark", name);
    // 색이 몇 프레임은 남게(바로 다음 표시와 겹치지 않게)
    await page.waitForTimeout(160);
  };
  const cap = (t: string, s: string) => page.evaluate(([a, b]) => (window as unknown as { __cap: (a: string, b: string) => void }).__cap(a, b), [t, s] as const);
  const car = <T>(fn: string, ...args: unknown[]) =>
    page.evaluate(
      ([f, a]) => {
        const w = (window as unknown as { __jhgoCar: { sim: Record<string, (...x: unknown[]) => unknown>; clock: { setRate?: (r: number) => unknown } } }).__jhgoCar;
        if (f === "rate") return w.clock.setRate?.(a[0] as number) as T;
        return w.sim[f](...(a as unknown[])) as T;
      },
      [fn, args] as const,
    );
  page.on("pageerror", (e) => log("페이지 오류:", e.message));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?compose`, { waitUntil: "load" });
    await page.getByTestId("car-screen").waitFor();
    await page.getByTestId("seller-app").waitFor();
    await page.waitForTimeout(1500);

    // ① 같이 올리기 → 판매자 홈(받는 중·잠깐 쉬기)
    const phone = page.locator(".phone");
    await mark("compose");
    await cap("판매자 폰", "다른 앱에 쓴 글을 붙여 넣으면 제목·가격·품목·크기가 바로 채워져요");
    await page.waitForTimeout(1200);
    await phone.getByTestId("compose").click();
    await page.waitForTimeout(600);
    await page.locator("#paste").click();
    await page.locator("#paste").pressSequentially("[판매] 회전형 카시트 (신생아~4세)\n35,000원\n아이가 커서 정리해요. 커버 세탁했어요.", { delay: 22 });
    await phone.getByTestId("size-source").waitFor();
    await page.waitForTimeout(1400);
    await phone.getByRole("button", { name: "샘플 사진" }).click();
    await cap("판매자 폰", "크기는 품목 기본 크기로 먼저 채우고, 60cm가 넘으면 줄자로 확인해야 올라가요. 장소·시간은 지난번 그대로");
    await page.locator("#title").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1600);
    await phone.getByTestId("measured").scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await phone.getByTestId("measured").click();
    await page.waitForTimeout(900);
    await phone.getByTestId("submit").click();
    await phone.getByTestId("posted").waitFor();
    await page.waitForTimeout(2200);
    await phone.getByTestId("posted-done").click();
    await cap("판매자 폰", "지금 요청을 받는지 한 줄로 보여요. 못 나갈 때는 '잠깐 쉬기'로 지나가는 차에서 내려요");
    await page.waitForTimeout(1600);
    await phone.getByTestId("pause-open").click();
    await page.waitForTimeout(1300);
    await phone.getByTestId("pause-1h").click();
    await page.waitForTimeout(2000);
    await phone.getByTestId("pause-off").click();
    await page.waitForTimeout(1600);
    await mark("compose-end");

    // ② 출발 전 브리핑 + 추천 목록
    await mark("brief");
    await cap("차 화면", "목적지를 정하면 길 위의 관심 매물을 지도 번호와 추천순 목록으로 보여 줘요");
    await car("setRow2Occupied", true);
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "목적지", exact: true }).click();
    await page.waitForTimeout(900);
    await page.getByTestId("sheet-destination").getByRole("button", { name: /송파 집/ }).click();
    await page.getByTestId("go-list").getByText("찾았어요").waitFor();
    await page.waitForTimeout(2600);
    await cap("차 화면", "사진·판매자 설명·우회 시간·경로상 거리·실을 수 있는지를 한 줄에. 핀이나 줄을 누르면 판매자 글 요약과 사진에서 본 상태를 읽어 줘요");
    await page.getByTestId("pin-유모차").click();
    await page.waitForTimeout(2600);
    await page.getByTestId("pin-카시트").click();
    await page.waitForTimeout(2600);
    await cap("차 화면", "말로 물어볼 수도 있어요 — \"카시트 흠집 있어?\" 조수는 지금 목록의 사실로만 답해요(AI 키가 없으면 규칙으로)");
    await page.evaluate(() => (window as any).__jhgoCar.controller.ask("카시트 흠집 있어?"));
    await page.waitForTimeout(3800);
    await page.evaluate(() => (window as any).__jhgoCar.controller.ask("카시트랑 유모차 중에 뭐가 더 싸?"));
    await page.waitForTimeout(3600);
    await cap("차 화면", "2열에 사람이 앉아 있어서, 2열을 접어야 실리는 아기 침대는 이유와 함께 빠져요");
    await page.getByTestId("go-row-아기 침대").scrollIntoViewIfNeeded();
    await page.getByTestId("go-row-아기 침대").click();
    await page.waitForTimeout(2600);
    await phone.getByTestId("tab-items").click();
    await phone.getByTestId("listing-stats").getByText(/지나간 차 1대/).waitFor({ timeout: 10000 });
    await cap("판매자 폰", "판매자 폰에는 지나간 차 몇 대에 보였는지만 남아요. 누가 봤는지는 남기지 않아요");
    await page.waitForTimeout(2600);
    await mark("brief-end");

    // ③ 주행 중: 목록이 줄고, 말할 때를 고른다
    await mark("drive");
    await cap("주행 중", "출발하면 목록은 큰 글씨 3줄로 줄고, 방향지시등을 켠 동안엔 알림을 미뤄요");
    await page.getByRole("button", { name: "지도", exact: true }).click();
    await car("rate", 10);
    await car("pulseTurnSignal", "RIGHT");
    await car("setGear", "D");
    await page.getByText(/알림 대기: .*방향지시등/).waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500);
    const alert = page.getByTestId("alert");
    await alert.waitFor({ timeout: 40000 });
    await cap("주행 중", "갈림길이 가까워지면 한 번에 하나만 묻고 음성으로도 말해요. 화면엔 우회 시간·실리는지·이유 하나만");
    await page.waitForTimeout(3800);
    await alert.getByRole("button", { name: "아니요" }).click();
    await page.waitForTimeout(1200);
    await mark("drive-end");

    // ④ 경합 질문
    await car("rate", 30);
    const cont = page.getByTestId("contention");
    await cont.waitFor({ timeout: 90000 });
    await mark("contention");
    await cap("주행 중", "비슷한 매물 두 개가 가까우면 '카시트? 유모차?' 하나만 고르게 해요. 말로 답해도 돼요");
    // 녹화 페이지에서는 가상 콘솔이 화면 밖이라 DOM으로 누른다(마이크 대신 말을 넣는 시뮬레이터 버튼)
    await page.waitForFunction(() => document.querySelector('[data-testid="voice-state"]')?.textContent?.includes("듣는 중"), null, { timeout: 10000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => (document.querySelector('[data-testid="voice-say-카시트"]') as HTMLButtonElement).click());
    await page.waitForTimeout(1500);
    await alert.waitFor({ timeout: 10000 });
    await page.waitForTimeout(2200);
    await alert.getByRole("button", { name: "들를게요" }).click();
    await page.waitForTimeout(800);
    await mark("contention-end");

    // ⑤ 판매자 수락 → 경유지
    const take = page.getByTestId("takeover");
    await take.waitFor({ timeout: 15000 });
    await mark("accept");
    await cap("판매자 폰", "차가 오면 폰 전체에 도착 예정·차종·실을 수 있는지가 떠요. 구매자 위치는 보이지 않아요");
    await page.waitForTimeout(3200);
    await take.getByTestId("accept").click();
    await cap("차 화면", "수락하면 내비에 경유지를 넣고(addWaypoint), 다시 조회해 들어간 걸 확인한 뒤 확정해요");
    await page.getByTestId("trade").getByText("가는 중").waitFor({ timeout: 15000 });
    await page.waitForTimeout(1800);
    await phone.getByTestId("tab-trades").click();
    await page.waitForTimeout(2200);
    await mark("accept-end");

    // ⑥ 만남과 현장 확인
    const handoff = phone.getByTestId("handoff");
    await handoff.getByText("곧 도착해요").waitFor({ timeout: 90000 });
    await mark("meet");
    await cap("판매자 폰", "도착 3분 전에 만남 화면이 떠요. '지금 나가요'를 누르면 구매자 차에 보여요");
    await page.waitForTimeout(2200);
    await handoff.getByTestId("coming").click();
    // 차가 이미 도착해 현장 확인이 열렸으면 기다림 패널 쪽에 뜬다
    await page.locator('[data-testid="trade-seller-coming"], [data-testid="seller-coming"]').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1800);
    const inspect = page.getByTestId("sheet-inspect");
    await inspect.waitFor({ timeout: 90000 });
    await cap("차 화면", "정차하면 현장 확인 화면이 열려요. 판매자가 나오는 중인지 보이고, 폰에는 남은 시간이 떠요");
    await page.waitForTimeout(2600);
    await handoff.getByTestId("handed").click();
    await inspect.getByText("판매자가 건넸다고 표시했어요").waitFor({ timeout: 10000 });
    await page.waitForTimeout(1800);
    await inspect.getByRole("button", { name: "받았어요" }).click();
    await page.waitForTimeout(2200);
    await mark("meet-end");

    // ⑦ 정산과 결과 카드
    await car("rate", 60);
    await page.locator(".phone").getByRole("button", { name: "정산", exact: true }).click();
    await mark("settle");
    await cap("판매자 폰", "받았어요 뒤 이의 제기 기간이 지나면 판매자에게 정산돼요(시연 원장)");
    await page.waitForFunction(() => document.querySelector('[data-testid="money"]')?.textContent?.includes("정산 완료35,000원"), null, { timeout: 60000 });
    await page.waitForTimeout(2200);
    await mark("settle-end");
    await car("setGear", "D");
    const result = page.getByTestId("sheet-result");
    await result.waitFor({ timeout: 120000 });
    await mark("result");
    await cap("차 화면", "목적지에 도착하면 늘어난 시간·거리를 보여 주고, 판매자를 평가해요");
    await page.waitForTimeout(3200);
    await result.getByRole("button", { name: "4점" }).click();
    await page.waitForTimeout(2400);
    await mark("result-end");

    // ⑧ 판매자가 안 나올 때 + 구매자 폰 — 새로 시작(자동 수락인 캠핑의자로)
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
    await page.getByTestId("car-screen").waitFor();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "목적지", exact: true }).click();
    await page.getByTestId("sheet-destination").getByRole("button", { name: /송파 집/ }).click();
    await page.getByTestId("go-list").getByText("찾았어요").waitFor();
    await page.getByRole("button", { name: "지도", exact: true }).click();
    await car("rate", 10);
    await car("setGear", "D");
    const alert2 = page.getByTestId("alert");
    await alert2.waitFor({ timeout: 40000 });
    await mark("absent");
    await cap("판매자가 안 나올 때", "자동 수락 매물이라 들를게요를 누르면 바로 경유지가 들어가요");
    await page.waitForTimeout(1600);
    await alert2.getByRole("button", { name: "들를게요" }).click();
    await page.waitForTimeout(1800);
    await mark("absent-a-end");
    const inspect2 = page.getByTestId("sheet-inspect");
    await inspect2.waitFor({ timeout: 90000 });
    await mark("absent-b");
    await cap("판매자가 안 나올 때", "다시 알려도 안 나오면 도착 5분 뒤에 거래를 끝낼 수 있어요. 전액 환불, 판매자 신뢰도에 반영");
    await page.waitForTimeout(1500);
    await page.getByTestId("nudge").click();
    await page.waitForTimeout(1200);
    await car("rate", 60);
    await page.waitForFunction(() => !document.querySelector('[data-testid="seller-absent"]')?.hasAttribute("disabled"), null, { timeout: 30000 });
    await car("rate", 1);
    await page.waitForTimeout(900);
    await page.getByTestId("seller-absent").click();
    await page.waitForTimeout(1600);
    await page.getByTestId("seller-absent-confirm").click();
    await page.waitForTimeout(1800);
    await page.getByTestId("phone-buyer").click();
    await cap("구매자 폰", "차에서 알림 받을 준비(결제 수단·관심 물건·차종)와 거래마다 대금이 어디 있는지를 폰에서 봐요");
    await page.waitForTimeout(2600);
    await phone.getByTestId("b-trade-camping_chair").first().click();
    await page.waitForTimeout(3000);
    await mark("absent-end");
  } finally {
    const v = page.video();
    await ctx.close();
    await browser.close();
    server.kill();
    const raw = v ? await v.path() : null;
    fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify({ raw, marks }, null, 2));
    log("raw video:", raw);
  }

  // ── 영상 안 시점 찾기 → 자르기 ──
  const raw = JSON.parse(fs.readFileSync(path.join(OUT, "marks.json"), "utf8")).raw as string;
  const at = findMarks(raw, W, H, marks.map((m) => m.name));
  log("영상 시점:", JSON.stringify(Object.fromEntries([...at].map(([k, v]) => [k, Number(v.toFixed(2))]))));
  cutClips(
    raw,
    W,
    H,
    at,
    OUT,
    [
      { id: "01-compose", segs: [["compose", "compose-end"]] },
      { id: "02-briefing", segs: [["brief", "brief-end"]] },
      { id: "03-alert-timing", segs: [["drive", "drive-end"]] },
      { id: "04-contention", segs: [["contention", "contention-end"]] },
      { id: "05-accept-waypoint", segs: [["accept", "accept-end"]] },
      { id: "06-meet-inspect", segs: [["meet", "meet-end"]] },
      {
        id: "07-settle-result",
        segs: [
          ["settle", "settle-end"],
          ["result", "result-end"],
        ],
      },
      {
        id: "08-seller-absent",
        segs: [
          ["absent", "absent-a-end"],
          ["absent-b", "absent-end", -0.4],
        ],
      },
    ],
    log,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
