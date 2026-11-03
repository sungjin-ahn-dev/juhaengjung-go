/**
 * 체험 페이지 자동 시연 점검 — 빌드한 jhgo-demo.html을 ?auto로 열어 7단계가 끝까지 저절로 가는지 본다.
 * 단계가 바뀔 때마다 tools/out/auto-<n>.png 를 찍는다. `npm run build -w apps/demo` 뒤에 `npm run e2e:auto`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Playwright는 전역(pre-installed)에서 가져온다 — 다른 도구와 같은 방식
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tools/out");
fs.mkdirSync(OUT, { recursive: true });
const html = path.join(ROOT, "apps/demo/dist/jhgo-demo.html");
if (!fs.existsSync(html)) throw new Error("apps/demo/dist/jhgo-demo.html 이 없어요. npm run build -w apps/demo 먼저");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("file://" + html + "?auto", { waitUntil: "load" });
let last = "";
let n = 0;
let ok = false;
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60000) {
  await page.waitForTimeout(400);
  const g = page.getByTestId("guide");
  if (!(await g.count())) continue;
  const txt = (await g.innerText()).replace(/\s+/g, " ");
  if (txt !== last) {
    last = txt;
    log(txt);
    await page.screenshot({ path: path.join(OUT, `auto-${String(++n).padStart(2, "0")}.png`) });
  }
  if (txt.includes("끝났어요")) {
    ok = true;
    break;
  }
  if (txt.includes("멈췄어요")) break;
}
// 끝난 뒤 구매자 폰: 거래 내역에 평점이 남았는지
if (ok) {
  await page.getByTestId("phone-buyer").click();
  await page.getByTestId("btab-trades").click();
  await page.waitForTimeout(600);
  const t = await page.locator('[data-testid="buyer-app"]').innerText();
  if (!/거래 완료|정산/.test(t)) {
    ok = false;
    log("구매자 폰 거래 내역에 거래 완료가 없어요");
  }
  await page.screenshot({ path: path.join(OUT, `auto-${String(++n).padStart(2, "0")}-buyer.png`) });
}
await browser.close();
if (errors.length) log("페이지 오류:", errors.join(" | "));
if (!ok) {
  log("자동 시연 실패");
  process.exit(1);
}
log(`자동 시연 통과 (${Math.round((Date.now() - t0) / 1000)}초)`);
