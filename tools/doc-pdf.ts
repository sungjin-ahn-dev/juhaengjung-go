/**
 * 문서(Markdown) → PDF. 기획서를 메일에 붙이거나 팀에 돌릴 때.
 *   node node_modules/tsx/dist/cli.mjs tools/doc-pdf.ts docs/01_기획서.md <출력.pdf> [JHGO_FONTS=<@fontsource 폴더>]
 * marked로 HTML을 만들고 Playwright(Chromium)로 A4 인쇄. 본문 글꼴은 앱과 같은 JHGO Sans, 제목 표식은 도현(있을 때).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const { marked } = require("marked") as typeof import("marked");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] ?? path.join(ROOT, "docs/01_기획서.md"));
const OUT = path.resolve(process.argv[3] ?? SRC.replace(/\.md$/, ".pdf"));
const md = fs.readFileSync(SRC, "utf8");
const title = (md.match(/^# (.+)$/m)?.[1] ?? path.basename(SRC, ".md")).trim();
// CommonMark는 "**주행중GO!**는"처럼 닫는 **가 문장부호 뒤·글자 앞에 오면 굵게로 안 본다(한국어 조사). 먼저 바꿔 둔다
const strong = md.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
const body = marked.parse(strong, { gfm: true, breaks: false }) as string;

const fontsDir = process.env.JHGO_FONTS;
const doHyeon = fontsDir && fs.existsSync(path.join(fontsDir, "do-hyeon/400.css")) ? `<link rel="stylesheet" href="file://${path.join(fontsDir, "do-hyeon/400.css")}">` : "";
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>${doHyeon}<style>
@font-face{font-family:"JHGO Sans";src:url("file://${path.join(ROOT, "apps/seller-web/src/assets/JHGOSans.woff2")}") format("woff2");font-weight:100 900}
@page{size:A4;margin:18mm 16mm 20mm}
html{font-size:10.6pt}
body{font-family:"JHGO Sans","Apple SD Gothic Neo","Malgun Gothic","Noto Sans CJK KR",sans-serif;color:#18202b;line-height:1.62;margin:0;word-break:keep-all;overflow-wrap:anywhere}
h1{font-size:26pt;letter-spacing:-.03em;line-height:1.15;margin:0 0 6pt}
h1 + blockquote{margin-top:4pt}
h2{font-size:15.5pt;letter-spacing:-.02em;margin:22pt 0 8pt;padding-top:8pt;border-top:2px solid #18202b;break-after:avoid}
h3{font-size:12pt;margin:14pt 0 6pt;break-after:avoid}
p{margin:0 0 7pt}
blockquote{margin:0 0 10pt;padding:6pt 10pt;border-left:3px solid #d8ae74;background:#faf6ef;color:#4a4036;font-size:9.4pt}
blockquote p{margin:0 0 3pt}
table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:8.9pt;break-inside:auto}
th,td{border:1px solid #c4ccd8;padding:4pt 6pt;vertical-align:top;text-align:left}
th{background:#eef1f5;font-weight:700}
tr{break-inside:avoid}
code{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:#eef1f5;padding:0 3pt;border-radius:3pt}
pre{background:#eef1f5;padding:8pt 10pt;border-radius:6pt;font-size:8.6pt;line-height:1.5;overflow:hidden;white-space:pre-wrap}
pre code{background:none;padding:0}
ul,ol{margin:0 0 8pt;padding-left:18pt}
li{margin:0 0 2pt}
hr{border:0;border-top:1px solid #c4ccd8;margin:14pt 0}
a{color:#0a7d91;text-decoration:none}
strong{font-weight:750}
.mark{position:fixed;top:-12mm;right:0;font-family:"Do Hyeon","JHGO Sans",sans-serif;color:#d8ae74;font-size:11pt}
</style></head><body>${body}</body></html>`;
const tmp = path.join(path.dirname(OUT), `.${path.basename(OUT)}.html`);
fs.writeFileSync(tmp, html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + tmp, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(200);
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;font-size:7.5pt;color:#8e9bad;padding:0 16mm;font-family:sans-serif;display:flex;justify-content:space-between"><span>${title}</span><span>주행중GO!</span></div>`,
  footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#8e9bad;padding:0 16mm;font-family:sans-serif;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
});
await browser.close();
fs.rmSync(tmp, { force: true });
console.log(`PDF: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
