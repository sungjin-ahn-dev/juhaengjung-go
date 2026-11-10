/**
 * 제출용 시연 영상 한 편 만들기 — 장면 클립(01~10 MP4) 사이에 제목 카드를 넣어 1280×720 한 파일로 잇는다.
 *   node node_modules/tsx/dist/cli.mjs tools/video-stitch.ts <클립 폴더> <출력 mp4> [JHGO_FONTS=<@fontsource 폴더>]
 * 카드는 Playwright로 앱 글꼴(JHGO Sans, 도현)을 써서 그리고, ffmpeg가 클립을 같은 크기로 맞춰 잇는다(ffmpeg 필요).
 * 영상에는 소리가 없다(녹화가 무음). 유튜브 호환을 위해 무음 오디오 트랙을 넣는다.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIPS = path.resolve(process.argv[2] ?? path.join(ROOT, "tools/out/video"));
const OUT = path.resolve(process.argv[3] ?? path.join(CLIPS, "jhgo-demo-3min.mp4"));
const WORK = path.join(path.dirname(OUT), "stitch");
fs.mkdirSync(WORK, { recursive: true });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

interface Scene {
  file: string;
  n: number;
  title: string;
  sub: string;
  sdk?: boolean;
}
const SCENES: Scene[] = [
  { file: "01-compose.mp4", n: 1, title: "물건 올리기", sub: "판매자 폰 — 다른 앱에 쓴 글을 붙여 넣으면 제목·가격·품목·크기가 채워져요" },
  { file: "02-briefing.mp4", n: 2, title: "출발 전 브리핑", sub: "정차 중 — 내비 목적지를 읽어 길 위의 관심 매물을 번호 핀과 추천 목록으로. 2열 착석이면 접어야 실리는 물건은 빼요" },
  { file: "03-alert-timing.mp4", n: 3, title: "주행 중 알림", sub: "방향지시등·조향·제동 중에는 기다렸다가, 갈림길 전에 한 번에 하나만 묻고 말해요" },
  { file: "04-contention.mp4", n: 4, title: "둘 중 하나", sub: "비슷한 매물 두 개가 가까우면 \"카시트? 유모차?\" — 말로 답해요" },
  { file: "05-accept-waypoint.mp4", n: 5, title: "수락과 경유지", sub: "판매자 폰 전체에 요청. 수락하면 대금을 보관하고 내비에 경유지를 넣어요(addWaypoint → getWaypointInfo로 확인)" },
  { file: "06-meet-inspect.mp4", n: 6, title: "만남과 현장 확인", sub: "도착 3분 전 판매자에게 '나와 주세요', 경유지 도착(onWayPointArrived) → 정차하면 현장 확인" },
  { file: "07-settle-result.mp4", n: 7, title: "정산·결과·평가", sub: "받았어요 → 정산. 목적지 도착 결과 카드: 따로 다녀왔다면 걸렸을 시간과 실제로 늘어난 시간, 판매자 평가" },
  { file: "08-seller-absent.mp4", n: 8, title: "판매자가 안 나올 때", sub: "다시 알리기, 도착 5분 뒤 끝내기 → 전액 환불·경유지 해제. 구매자 폰의 거래 내역" },
  { file: "09-sdk-briefing-alert.mp4", n: 9, title: "SDK 모드: 브리핑과 알림", sub: "같은 차 화면을 Android 셸과 같은 브리지 프로토콜로 — NaviHelper·Vehicle·TextToSpeech 호출 기록이 오른쪽에", sdk: true },
  { file: "10-sdk-waypoint-arrive.mp4", n: 10, title: "SDK 모드: 경유지와 도착", sub: "requestTrip → addWaypoint → getWaypointInfo → onWayPointArrived → 현장 확인", sdk: true },
];

// ── 카드 그리기 ──
const fontCss = `@font-face{font-family:"JHGO Sans";src:url("file://${path.join(ROOT, "apps/seller-web/src/assets/AstaSans-subset.woff2")}") format("woff2");font-weight:300 800}`;
const fontsDir = process.env.JHGO_FONTS;
const doHyeon = fontsDir && fs.existsSync(path.join(fontsDir, "do-hyeon/400.css")) ? `<link rel="stylesheet" href="file://${path.join(fontsDir, "do-hyeon/400.css")}">` : "";
const base = `<!doctype html><html><head><meta charset="utf-8">${doHyeon}<style>
${fontCss}
html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#141a23;color:#eef2f6;font-family:"JHGO Sans","Apple SD Gothic Neo","Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}
.route{position:absolute;left:-40px;right:-40px;top:596px;height:7px;background:#57d2e6;opacity:.6;transform:rotate(-3.5deg);border-radius:99px;box-shadow:0 0 0 10px rgba(87,210,230,.07)}
.mark{position:absolute;left:72px;top:56px;font-family:"Do Hyeon","JHGO Sans",sans-serif;font-size:30px;color:#d8ae74;letter-spacing:-.01em}
.mark b{color:#eef2f6;font-weight:400}
.foot{position:absolute;left:72px;bottom:44px;font-size:19px;color:#8e9bad}
.n{position:absolute;left:72px;top:196px;width:72px;height:72px;border-radius:50%;background:#d8ae74;color:#2a1c0c;display:grid;place-items:center;font-weight:800;font-size:34px;font-variant-numeric:tabular-nums}
.n.sdk{background:transparent;border:6px dashed #d8ae74;color:#d8ae74;font-size:30px}
.t{position:absolute;left:72px;top:290px;font-size:62px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.s{position:absolute;left:72px;top:390px;max-width:900px;font-size:25px;line-height:1.5;color:#c8d0da}
.big{position:absolute;left:72px;top:230px;font-family:"Do Hyeon","JHGO Sans",sans-serif;font-size:124px;line-height:1;color:#eef2f6}
.big em{font-style:normal;color:#d8ae74}
.tag{position:absolute;left:76px;top:372px;max-width:1120px;font-size:31px;line-height:1.35;font-weight:700;letter-spacing:-.02em;color:#eef2f6}
.meta{position:absolute;left:76px;top:478px;font-size:21px;color:#8e9bad;line-height:1.6}
.cols{position:absolute;left:72px;top:300px;display:grid;grid-template-columns:1fr 1fr;gap:18px 48px;width:1100px;font-size:24px;line-height:1.4}
.cols b{display:block;color:#d8ae74;font-size:18px;font-weight:700;margin-bottom:4px;letter-spacing:.02em}
.cols span{color:#c8d0da}
</style></head><body>`;
const opening = `${base}
<div class="route"></div>
<div class="mark">주행중<b>GO!</b></div>
<div class="big">주행중<em>GO!</em></div>
<div class="tag">가는 길에, 한 번에 하나씩. 경로 가까이 올라온 중고 물건을 차가 골라 묻고,<br>판매자가 수락하면 경유지로 넣어 들렀다 가요.</div>
<div class="meta">현대차·기아 차량용 앱 개발 공모전 — 모빌리티 &amp; 라이프 편의 · 시연 영상 약 3분<br>1~8 브라우저 시뮬레이터 녹화 · 9~10 실제 SDK 모드(가짜 브리지) 녹화 · Pleos 에뮬레이터·실차는 미실행</div>
<div class="foot">Pleos SDK: NaviHelper · Vehicle(Seat, TurnSignal, SteeringWheel, Brake, Energy) · TextToSpeech · AAOS CarUxRestrictions</div>
</body></html>`;
const closing = `${base}
<div class="route"></div>
<div class="mark">주행중<b>GO!</b></div>
<div class="t" style="top:170px">검증한 것과 남은 것</div>
<div class="cols">
  <div><b>통과</b><span>핵심 로직·서버 테스트 102개, 타입 검사, 시뮬레이터 E2E 3부, 브리지 계약 시험, 체험 페이지 자동 시연</span></div>
  <div><b>확인</b><span>차 화면 1280×720·1920×720, 폰 390×844 장면 캡처. Kotlin 셸은 레퍼런스 시그니처 스텁으로 컴파일</span></div>
  <div><b>미실행</b><span>Pleos Connect 에뮬레이터·실차, 폰 웹 푸시(HTTPS), 사진 크기 추정 실제 API, 실제 결제</span></div>
  <div><b>원칙</b><span>공식 레퍼런스에서 확인한 SDK만 쓰고, 미확인은 확인된 API로 대체하거나 거절</span></div>
</div>
<div class="foot">주행중GO! — 차를 움직이기보다 차를 읽는다</div>
</body></html>`;
const sceneCard = (s: Scene) => `${base}
<div class="route"></div>
<div class="mark">주행중<b>GO!</b></div>
<div class="n ${s.sdk ? "sdk" : ""}">${s.n}</div>
<div class="t">${s.title}</div>
<div class="s">${s.sub}</div>
<div class="foot">${s.sdk ? "브리지 계약 시험 녹화 — 실제 SDK 모드(가짜 브리지), 오른쪽은 SDK 호출 기록" : "체험 페이지 녹화 — 브라우저 시뮬레이터, 왼쪽 차 화면·오른쪽 판매자 폰"}</div>
</body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const card = async (name: string, html: string) => {
  const f = path.join(WORK, `${name}.html`);
  fs.writeFileSync(f, html);
  await page.goto("file://" + f, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const png = path.join(WORK, `${name}.png`);
  await page.screenshot({ path: png });
  return png;
};
const parts: { kind: "card" | "clip"; file: string; dur?: number }[] = [];
parts.push({ kind: "card", file: await card("00-open", opening), dur: 4 });
for (const s of SCENES) {
  const clip = path.join(CLIPS, s.file);
  if (!fs.existsSync(clip)) {
    log("없음:", s.file);
    continue;
  }
  parts.push({ kind: "card", file: await card(`card-${s.n}`, sceneCard(s)), dur: 2.4 });
  parts.push({ kind: "clip", file: clip });
}
parts.push({ kind: "card", file: await card("99-close", closing), dur: 5 });
await browser.close();

// ── ffmpeg: 모두 1280×720 30fps로 맞춰 잇기 + 무음 오디오 ──
const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
for (const p of parts) {
  if (p.kind === "card") args.push("-loop", "1", "-framerate", "30", "-t", String(p.dur), "-i", p.file);
  else args.push("-i", p.file);
}
args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
const vf = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#141a23,setsar=1,fps=30,format=yuv420p";
let fc = "";
parts.forEach((_, i) => (fc += `[${i}:v]${vf}[v${i}];`));
fc += parts.map((_, i) => `[v${i}]`).join("") + `concat=n=${parts.length}:v=1:a=0[v]`;
args.push("-filter_complex", fc, "-map", "[v]", "-map", `${parts.length}:a`, "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "64k", OUT);
log("ffmpeg …", parts.length, "조각");
execFileSync("ffmpeg", args, { stdio: "inherit" });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
log(`완성: ${OUT} (${Math.round(Number(dur))}초, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
