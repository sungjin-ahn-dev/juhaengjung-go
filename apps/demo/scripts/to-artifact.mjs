// dist/index.html(한 파일 빌드)을 공유 페이지(Artifact) 형식으로 바꾼다:
// <!doctype>·<html>·<head>·<body> 없이 title·글꼴 링크·style·#root·script만 남긴다(게시할 때 바깥 틀이 붙는다).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");

const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const title = (html.match(/<title>[\s\S]*?<\/title>/) ?? ["<title>주행중GO! 체험</title>"])[0];
const links = pick(/<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g);
const styles = pick(/<style\b[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script\b[^>]*>[\s\S]*?<\/script>/g).map((s) => s.replace(/\s+crossorigin(="[^"]*")?/, ""));
if (!styles.length || !scripts.length) throw new Error("dist/index.html에서 style·script를 찾지 못했어요");

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...links,
  ...styles,
  '<div id="root"></div>',
  ...scripts,
].join("\n");
fs.writeFileSync(path.join(dist, "jhgo-demo.html"), out + "\n");
console.log(`jhgo-demo.html ${(out.length / 1024).toFixed(0)} KB (style ${styles.length}, script ${scripts.length})`);
