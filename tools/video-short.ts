/**
 * 숏폼(세로 1080×1920, 약 60초) — 체험 페이지 녹화 클립에서 차 화면과 판매자 폰을 잘라 위아래로 쌓고, 장면마다 한 줄 설명을 얹는다.
 *   node node_modules/tsx/dist/cli.mjs tools/video-short.ts <클립 폴더> <출력 mp4> [JHGO_FONTS=…]
 * 공모전 '숏폼 챌린지 어워드'(본상과 별개)용. 무음. ffmpeg 필요.
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
const OUT = path.resolve(process.argv[3] ?? path.join(CLIPS, "jhgo-short-60s.mp4"));
const WORK = path.join(path.dirname(OUT), "short");
fs.mkdirSync(WORK, { recursive: true });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 녹화 프레임(1280×720) 안의 차 화면·폰 자리
const CAR = { x: 16, y: 14, w: 910, h: 524 };
const PHONE = { x: 964, y: 61, w: 294, h: 658 };
const W = 1080;
const H = 1920;
const CAR_Y = 268;
const CAR_H = Math.round((CAR.h * W) / CAR.w); // 637
const PHONE_SCALE = 1.5;
const PHONE_W = Math.round(PHONE.w * PHONE_SCALE);
const PHONE_H = Math.round(PHONE.h * PHONE_SCALE);
const PHONE_X = Math.round((W - PHONE_W) / 2);
const PHONE_Y = CAR_Y + CAR_H + 26;

interface Seg {
  file: string;
  start: number;
  dur: number;
  title: string;
  sub: string;
}
const SEGS: Seg[] = [
  { file: "02-briefing.mp4", start: 2, dur: 8, title: "목적지를 정하면", sub: "가는 길 위의 관심 매물이 번호 핀과 목록으로" },
  { file: "03-alert-timing.mp4", start: 7, dur: 8, title: "갈림길 전에 한 번만 물어요", sub: "방향지시등·조향·제동 중엔 기다렸다가" },
  { file: "04-contention.mp4", start: 3, dur: 8, title: "\"카시트? 유모차?\"", sub: "말로 답하면 돼요" },
  { file: "05-accept-waypoint.mp4", start: 1, dur: 8, title: "판매자가 수락하면", sub: "대금을 보관하고 내비에 경유지를 넣어요" },
  { file: "06-meet-inspect.mp4", start: 2, dur: 8, title: "도착하면 현장 확인", sub: "받았어요 또는 안 살게요(전액 환불)" },
  { file: "07-settle-result.mp4", start: 8, dur: 8, title: "목적지에 도착", sub: "따로 다녀왔다면 40분, 실제로 늘어난 시간 7분" },
];

const fontCss = `@font-face{font-family:"JHGO Sans";src:url("file://${path.join(ROOT, "apps/seller-web/src/assets/JHGOSans.woff2")}") format("woff2");font-weight:100 900}`;
const fontsDir = process.env.JHGO_FONTS;
const doHyeon = fontsDir && fs.existsSync(path.join(fontsDir, "do-hyeon/400.css")) ? `<link rel="stylesheet" href="file://${path.join(fontsDir, "do-hyeon/400.css")}">` : "";
const base = `<!doctype html><html><head><meta charset="utf-8">${doHyeon}<style>
${fontCss}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#141a23;color:#eef2f6;font-family:"JHGO Sans","Apple SD Gothic Neo","Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}
.mark{position:absolute;left:56px;top:54px;font-family:"Do Hyeon","JHGO Sans",sans-serif;font-size:40px;color:#d8ae74}
.mark b{color:#eef2f6;font-weight:400}
.t{position:absolute;left:56px;top:122px;width:968px;font-size:58px;font-weight:800;letter-spacing:-.03em;line-height:1.15}
.s{position:absolute;left:56px;top:${CAR_Y - 56}px;width:968px;font-size:28px;color:#c8d0da;line-height:1.3}
.car{position:absolute;left:0;top:${CAR_Y}px;width:${W}px;height:${CAR_H}px;background:#0b0f15;border-radius:0}
.phone{position:absolute;left:${PHONE_X - 10}px;top:${PHONE_Y - 10}px;width:${PHONE_W + 20}px;height:${PHONE_H + 20}px;background:#111;border-radius:34px}
.big{position:absolute;left:56px;top:560px;font-family:"Do Hyeon","JHGO Sans",sans-serif;font-size:150px;line-height:1;color:#eef2f6}
.big em{font-style:normal;color:#d8ae74}
.tag{position:absolute;left:58px;top:760px;width:960px;font-size:46px;font-weight:700;letter-spacing:-.02em;line-height:1.3}
.meta{position:absolute;left:58px;top:1000px;width:960px;font-size:28px;color:#8e9bad;line-height:1.6}
.route{position:absolute;left:-60px;right:-60px;top:1330px;height:10px;background:#57d2e6;opacity:.6;transform:rotate(-6deg);border-radius:99px;box-shadow:0 0 0 14px rgba(87,210,230,.07)}
.foot{position:absolute;left:56px;bottom:72px;font-size:26px;color:#8e9bad;line-height:1.5}
</style></head><body>`;
const opening = `${base}<div class="mark">주행중<b>GO!</b></div><div class="big">주행중<em>GO!</em></div><div class="tag">가는 길에, 한 번에 하나씩.<br>경로 가까이 올라온 중고 물건을 차가 골라 묻고, 판매자가 수락하면 경유지로 들렀다 가요.</div><div class="meta">현대차·기아 차량용 앱 개발 공모전<br>브라우저 시뮬레이터 녹화 · 왼쪽 차 화면, 오른쪽 판매자 폰</div><div class="route"></div><div class="foot">Pleos SDK: NaviHelper · Vehicle · TextToSpeech · Gleo AI</div></body></html>`;
const closing = `${base}<div class="mark">주행중<b>GO!</b></div><div class="big" style="top:520px;font-size:120px">차를 움직이기보다<br><em>차를 읽는다</em></div><div class="meta" style="top:900px">내비 상태 · 목적지 · 경유지 · 도착 배터리 · 차종 · 좌석 · 방향지시등 · 조향 · 제동 · 도착 이벤트 · 주행거리</div><div class="route"></div><div class="foot">Pleos 에뮬레이터·실차는 아직 돌려 보지 않았어요</div></body></html>`;
const segCard = (s: Seg) => `${base}<div class="mark">주행중<b>GO!</b></div><div class="t">${s.title}</div><div class="s">${s.sub}</div><div class="car"></div><div class="phone"></div></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const card = async (name: string, html: string) => {
  const f = path.join(WORK, `${name}.html`);
  fs.writeFileSync(f, html);
  await page.goto("file://" + f, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
  const png = path.join(WORK, `${name}.png`);
  await page.screenshot({ path: png });
  return png;
};
const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30"];
const parts: string[] = [];
const still = (png: string, dur: number, out: string) => {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", String(dur), "-i", png, "-vf", "format=yuv420p", ...enc, out], { stdio: "inherit" });
  parts.push(out);
};
still(await card("00-open", opening), 3, path.join(WORK, "p00.mp4"));
let i = 0;
for (const s of SEGS) {
  const clip = path.join(CLIPS, s.file);
  if (!fs.existsSync(clip)) {
    log("없음:", s.file);
    continue;
  }
  i++;
  const bg = await card(`seg-${i}`, segCard(s));
  const out = path.join(WORK, `p${String(i).padStart(2, "0")}.mp4`);
  const fc =
    `[1:v]trim=start=${s.start}:duration=${s.dur},setpts=PTS-STARTPTS,crop=${CAR.w}:${CAR.h}:${CAR.x}:${CAR.y},scale=${W}:${CAR_H}[car];` +
    `[1:v]trim=start=${s.start}:duration=${s.dur},setpts=PTS-STARTPTS,crop=${PHONE.w}:${PHONE.h}:${PHONE.x}:${PHONE.y},scale=${PHONE_W}:${PHONE_H}[ph];` +
    `[0:v][car]overlay=0:${CAR_Y}[a];[a][ph]overlay=${PHONE_X}:${PHONE_Y},format=yuv420p[v]`;
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", String(s.dur), "-i", bg, "-i", clip, "-filter_complex", fc, "-map", "[v]", "-t", String(s.dur), ...enc, out], { stdio: "inherit" });
  parts.push(out);
}
still(await card("99-close", closing), 4, path.join(WORK, "p99.mp4"));
await browser.close();
const list = path.join(WORK, "list.txt");
fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", OUT], { stdio: "inherit" });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
log(`완성: ${OUT} (${Math.round(Number(dur))}초, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
