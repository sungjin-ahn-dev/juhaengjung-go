/**
 * Node 서버: API + SSE + 웹 앱 정적 파일(/seller/, /buyer/, /car/).
 *   npm start                 # 시연 모드(가상 시계, 시연 데이터), 포트 8787
 *   JHGO_DEMO=0 npm start     # 실제 시계
 *   PORT=9000 JHGO_DB=./data/x.sqlite npm start
 *   JHGO_TLS_CERT=cert.pem JHGO_TLS_KEY=key.pem npm start   # HTTPS(폰 웹 푸시는 HTTPS 주소에서만 된다)
 *   ANTHROPIC_API_KEY=... npm start                         # 판매자 사진으로 크기 추정(없으면 품목 대표 크기)
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackend } from "./backend.ts";
import { createWebPushSender } from "./push-node.ts";
import { createClaudeSizeEstimator } from "./size-ai-claude.ts";
import { createClaudeBriefEngine } from "./brief-ai.ts";
import { createClaudeAssistEngine } from "./assist-ai.ts";
import { SqliteStore } from "./store-sqlite.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const port = Number(process.env.PORT ?? 8787);
const demo = process.env.JHGO_DEMO !== "0";
const dbPath = process.env.JHGO_DB ?? resolve(root, "data/jhgo.sqlite");

const tlsCert = process.env.JHGO_TLS_CERT;
const tlsKey = process.env.JHGO_TLS_KEY;
const apiKey = process.env.ANTHROPIC_API_KEY;

const backend = createBackend({
  demo,
  store: new SqliteStore(dbPath),
  seed: true,
  rate: Number(process.env.JHGO_RATE ?? 1),
  push: process.env.JHGO_PUSH === "0" ? undefined : (store) => createWebPushSender(store, { subject: process.env.JHGO_VAPID_SUBJECT }),
  sizeAI: apiKey ? createClaudeSizeEstimator({ apiKey, model: process.env.JHGO_AI_MODEL }) : undefined,
  briefAI: apiKey ? createClaudeBriefEngine({ apiKey, model: process.env.JHGO_AI_MODEL }) : undefined,
  assistAI: apiKey ? createClaudeAssistEngine({ apiKey, model: process.env.JHGO_AI_MODEL }) : undefined,
});
const { app, svc } = backend;

const sellerDist = resolve(root, "apps/seller-web/dist");
const buyerDist = resolve(root, "apps/buyer-web/dist");
const carDist = resolve(root, "apps/car-web/dist");
// serveStatic의 root는 현재 작업 폴더 기준 상대 경로
const rel = (p: string) => relative(process.cwd(), p) || ".";
if (existsSync(sellerDist)) {
  app.use("/seller/*", serveStatic({ root: rel(sellerDist), rewriteRequestPath: (p) => p.replace(/^\/seller/, "") }));
  app.get("/seller", (c) => c.redirect("/seller/"));
}
if (existsSync(buyerDist)) {
  app.use("/buyer/*", serveStatic({ root: rel(buyerDist), rewriteRequestPath: (p) => p.replace(/^\/buyer/, "") }));
  app.get("/buyer", (c) => c.redirect("/buyer/"));
}
if (existsSync(carDist)) {
  app.use("/car/*", serveStatic({ root: rel(carDist), rewriteRequestPath: (p) => p.replace(/^\/car/, "") }));
  app.get("/car", (c) => c.redirect("/car/"));
}
app.get("/", (c) =>
  c.html(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>주행중GO!</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1b1f24}a{display:block;padding:14px 16px;margin:10px 0;border:1px solid #d8dde3;border-radius:12px;text-decoration:none;color:inherit}small{color:#5b6570}</style></head>
<body><h1>주행중GO!</h1><a href="/car/"><b>차량 앱</b><br><small>내비 화면 · 가상 콘솔로 주행 시뮬레이션</small></a><a href="/seller/"><b>판매자 앱</b><br><small>휴대폰으로 열기 · 같이 올리기, 요청 수락, 알림 받기</small></a><a href="/buyer/"><b>구매자 폰</b><br><small>결제 수단, 거래 내역·평가, 현장 사진, 관심사</small></a>
<p><small>시연 모드: ${demo ? "켜짐(가상 시계)" : "꺼짐"}</small></p></body></html>`),
);

// 만료·노쇼·자동 확인·정산
setInterval(() => {
  try {
    svc.tick();
  } catch (e) {
    console.error("tick", e);
  }
}, 1000);

const tls = tlsCert && tlsKey ? { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } : null;
const scheme = tls ? "https" : "http";
serve({ fetch: app.fetch, port, hostname: "0.0.0.0", ...(tls ? { createServer: createHttpsServer, serverOptions: tls } : {}) }, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
  console.log(`주행중GO! 서버 ${scheme}://localhost:${port}  (시연 모드: ${demo ? "켜짐" : "꺼짐"}, DB: ${dbPath})`);
  for (const ip of lan) console.log(`  같은 와이파이의 휴대폰에서: ${scheme}://${ip}:${port}/seller/ (구매자: /buyer/)`);
  console.log(`  에뮬레이터에서: ${scheme}://10.0.2.2:${port}/car/`);
  console.log(`  판매자 웹 푸시: ${svc.pushKey() ? (tls ? "켜짐" : "켜짐 — 폰에서는 HTTPS 주소에서만 받아요(README '웹 푸시')") : "꺼짐"}, 사진 크기 추정: ${apiKey ? "Claude" : "꺼짐(품목 대표 크기)"}`);
});
