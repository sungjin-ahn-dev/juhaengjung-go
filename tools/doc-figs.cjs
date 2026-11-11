/**
 * 접수 양식 별지·기획서·README에 넣는 그림을 만든다(docs/img/, 그림은 가로 2400px).
 *   node tools/doc-figs.cjs            # 먼저 npm run e2e 와 npm run e2e:split 로 tools/out/ 캡처를 새로 만든다
 * 그림 1 거래 한 번의 흐름(차 화면 × 판매자 폰) · 그림 2 여정 10단계와 차에서 읽는 신호
 * 그림 3 같은 거래를 폰으로 할 때와 차가 할 때 · 그림 4 사업성 근거(숫자는 기획서 19장 출처)
 * 그림 5 SDK/API 사용 계획 표(docs/API_MATRIX.md와 같이 고친다) · 그림 6 실제 화면(차 전체·분할 화면·폰)
 * README용 car.jpg(차 화면 둘) · split.jpg(분할 화면 둘) · phones.jpg(폰 셋)
 * 화면은 E2E가 찍은 실제 캡처를 그대로 쓴다(시뮬레이터 녹화). 숫자를 바꾸면 기획서 16·19장도 같이 고친다.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
// JHGO_FIG_OUT=<폴더>로 다른 곳에 만들어 미리 볼 수 있다
const OUT = process.env.JHGO_FIG_OUT ? path.resolve(process.env.JHGO_FIG_OUT) : path.join(ROOT, "docs/img");
fs.mkdirSync(OUT, { recursive: true });
const SHOT = path.join(ROOT, "tools/out");
const FONT = path.join(ROOT, "apps/seller-web/src/assets/AstaSans-subset.woff2");
const b64 = (f) => fs.readFileSync(f).toString("base64");
const png = (name) => `data:image/png;base64,${b64(path.join(SHOT, name))}`;

const CSS = `
@font-face{font-family:"Asta";src:url(data:font/woff2;base64,${b64(FONT)}) format("woff2");font-weight:300 800}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body{font-family:"Asta","Noto Sans CJK KR","Malgun Gothic",sans-serif;color:#18202b;word-break:keep-all;-webkit-font-smoothing:antialiased}
.fig{width:1200px;padding:28px 30px 26px;background:#fff}
.fig h2{font-size:25px;font-weight:800;letter-spacing:-.03em;line-height:1.25}
.fig .sub{font-size:15px;color:#5b6778;margin-top:5px;line-height:1.5}
.src{font-size:11.5px;color:#7b8798;margin-top:14px;line-height:1.5}
.num{flex:none;width:26px;height:26px;border-radius:50%;background:#d8ae74;color:#2a1c0c;font-weight:800;font-size:14px;display:grid;place-items:center;font-variant-numeric:tabular-nums}
/* 그림 1 */
.cols{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:18px}
.col .head{display:flex;gap:9px;align-items:center;font-size:16.5px;font-weight:750;letter-spacing:-.02em;min-height:44px;line-height:1.25}
.col .car{display:block;width:100%;border-radius:10px;margin-top:8px;box-shadow:0 1px 0 rgba(0,0,0,.06)}
.col .ph{display:block;height:300px;margin:12px auto 0;border-radius:16px;border:5px solid #11161d}
.col p{font-size:13.5px;line-height:1.55;color:#3a4656;margin-top:11px}
.rowtag{font-size:12px;font-weight:700;color:#7b8798;letter-spacing:0;margin-top:14px}
/* 그림 2 — 여정을 길 한 줄로: 앱의 지도 말씨(어두운 지도, 청록 경로, 크라프트 번호 핀)를 그대로 쓴다 */
.trip{position:relative;margin-top:18px;height:372px;border-radius:18px;background:#18202b;overflow:hidden}
.trip svg{position:absolute;inset:0;width:100%;height:100%}
.flagp{position:absolute;width:182px;padding-left:11px;border-left:1.5px solid rgba(238,242,246,.3)}
.flagp.up{padding-bottom:13px}
.flagp.down{padding-top:13px}
.flagp .t{font-size:16px;font-weight:800;letter-spacing:-.02em;color:#eef2f6;line-height:1.3}
.flagp .sig{margin-top:4px;font-size:12.5px;line-height:1.45;color:#57d2e6;font-weight:600;letter-spacing:-.01em}
.flagp .do{margin-top:5px;font-size:13px;line-height:1.5;color:#c3ccd8}
.tripkey{display:flex;gap:22px;margin-top:11px;font-size:12.5px;color:#5b6778;align-items:center;line-height:1.5}
.tripkey i{display:inline-block;width:18px;height:4px;border-radius:2px;margin-right:7px;vertical-align:3px}
/* 그림 3 */
.vs{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
.side{border-radius:16px;padding:18px 20px 16px}
.side.phone{background:#f2f4f7}
.side.car{background:#141a23;color:#eef2f6}
.side h3{font-size:18px;font-weight:800;letter-spacing:-.02em}
.side .who{font-size:12.5px;margin-top:3px;color:#7b8798}
.side.car .who{color:#9fb0c3}
.side ol{list-style:none;margin-top:12px;display:grid;gap:8px}
.side li{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;line-height:1.5}
.side li b{flex:none;width:36px;font-weight:800}
.side li>span:last-child{flex:1 1 auto;min-width:0}
.side li .n{flex:none;width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:800;display:grid;place-items:center;margin-top:1px;background:#d0d6de;color:#3a4656}
.side.car li .n{background:#d8ae74;color:#2a1c0c}
.side li small{display:block;font-size:12px;color:#7b8798;margin-top:1px}
.side.car li small{color:#57d2e6}
.bottom{margin-top:14px;font-size:14.5px;line-height:1.55;padding:11px 14px;border-left:4px solid #d8ae74;background:#faf6ef;color:#2a1c0c;font-weight:600}
/* 그림 4 — 주인공은 막대 하나(나눔으로 나가는 큰 물건). 시장 숫자는 근거 줄로, MAU는 식 한 줄로, 공급 계획은 세 지점으로 */
.biz{display:grid;grid-template-columns:1.18fr 1fr;gap:26px;margin-top:18px;align-items:stretch}
.give{display:flex;flex-direction:column;border-radius:18px;background:#18202b;color:#eef2f6;padding:20px 22px 16px}
.give h3{font-size:16.5px;font-weight:800;letter-spacing:-.02em}
.give .bars{margin-top:18px;display:grid;gap:13px}
.give .bar{display:grid;grid-template-columns:104px 1fr;gap:12px;align-items:center;font-size:13.5px;color:#aab6c5}
.give .bar.hi{color:#eef2f6;font-weight:750}
.give .bar .line{display:flex;align-items:center;gap:9px}
.give .bar .track{flex:none;height:12px;border-radius:0 4px 4px 0;background:#5f6c7e}
.give .bar.hi .track{background:#d8ae74}
.give .bar .val{font-variant-numeric:tabular-nums;font-weight:750;color:#c3ccd8}
.give .bar.hi .val{color:#eef2f6}
.give .call{display:flex;gap:14px;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}
.give .call b{flex:none;font-size:34px;font-weight:800;letter-spacing:-.04em;color:#d8ae74;font-variant-numeric:tabular-nums;line-height:1}
.give .call span{font-size:13.5px;line-height:1.5;color:#c3ccd8}
.give .src{color:#7f8c9e;margin-top:auto;padding-top:14px}
.facts{display:grid;align-content:space-between}
.facts>div{display:grid;grid-template-columns:128px 1fr;gap:14px;align-items:baseline;padding:11px 0;border-top:1px solid #dfe4eb}
.facts>div:first-child{border-top:2px solid #18202b}
.facts dt{font-size:27px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1.1;white-space:nowrap}
.facts dt small{font-size:14.5px;font-weight:750;letter-spacing:-.02em;margin-left:2px}
.facts dd{font-size:13.5px;line-height:1.5;color:#3a4656}
.facts cite{display:block;font-style:normal;font-size:11.5px;color:#7b8798;margin-top:2px}
.mau{margin-top:20px;padding:14px 22px 15px;border-radius:14px;background:#faf6ef}
.mau h3{font-size:13.5px;font-weight:800;letter-spacing:-.01em;color:#5d4a2b}
.mau .eq{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-top:9px}
.mau .term:first-child{max-width:270px}
.mau .term b{display:block;font-size:24px;font-weight:800;letter-spacing:-.035em;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap}
.mau .term span{display:block;font-size:12.5px;line-height:1.45;color:#3a4656;margin-top:4px}
.mau .term small{display:block;font-size:11.5px;color:#7b8798}
.mau .term em{font-style:normal;font-size:11px;font-weight:750;color:#8a5a14;background:#f0dcb9;border-radius:5px;padding:1px 6px;margin-left:5px;vertical-align:1px}
.mau .term.out b{color:#8a5a14}
.mau .eq>i{font-style:normal;font-size:22px;font-weight:300;color:#b39563;line-height:1.3}
.supply{margin-top:20px}
.supply h3{font-size:15.5px;font-weight:800;letter-spacing:-.02em}
.supply .steps{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:12px}
.supply .steps::before{content:"";position:absolute;left:13px;right:calc((100% - 52px) / 3 - 13px);top:12px;height:2px;background:#d8ae74}
.supply .st{position:relative}
.supply .st .num{position:relative;z-index:1;box-shadow:0 0 0 5px #fff}
.supply .st p{font-size:13.5px;line-height:1.55;color:#3a4656;margin-top:9px}
.supply .st p b{color:#18202b;font-weight:800}
/* 그림 5 */
table.sdk{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;line-height:1.5}
table.sdk th{background:#141a23;color:#eef2f6;font-weight:750;text-align:left;padding:8px 11px;font-size:12.5px}
table.sdk th:first-child{border-radius:10px 0 0 0}
table.sdk th:last-child{border-radius:0 10px 0 0}
table.sdk td{padding:7px 11px;border-bottom:1px solid #e1e6ed;vertical-align:top}
table.sdk td:first-child{font-weight:800;white-space:nowrap}
table.sdk td:first-child .num{display:inline-grid;width:22px;height:22px;font-size:12px;margin-right:7px;vertical-align:-5px}
table.sdk td.api{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#0b6f82;font-weight:600;letter-spacing:-.01em}
table.sdk td.api span{font-family:"Asta","Noto Sans CJK KR",sans-serif;color:#5b6778;font-weight:600;font-size:12.5px}
table.sdk td.perm{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#5b6778;white-space:nowrap}
.checks{display:grid;grid-template-columns:repeat(4,1fr);margin-top:18px;border-top:2px solid #18202b}
.checkc{padding:11px 16px 4px 0;margin-right:16px;border-right:1px solid #dfe4eb}
.checkc:last-child{border-right:0;margin-right:0}
.checkc .k{font-size:12px;font-weight:700;color:#7b8798}
.checkc .v{font-size:15px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
.checkc .d{font-size:12px;line-height:1.5;color:#3a4656;margin-top:4px}
.checkc.todo .v{color:#8a5a14}
.checkc.todo .v::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#d8ae74;margin-left:7px;vertical-align:2px}
/* 그림 6 */
.shots{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.shot img{display:block;width:100%;border-radius:10px}
.shot .cap,.cap{font-size:13px;line-height:1.5;color:#3a4656;margin-top:7px}
.shot .cap b,.cap b{display:block;font-weight:800;color:#18202b}
.row2{display:grid;grid-template-columns:auto 1fr;gap:26px;margin-top:20px;align-items:start}
.splits{display:flex;gap:12px}
.splits img{display:block;height:330px;border-radius:10px}
.phones{display:flex;gap:14px;justify-content:flex-end}
.phones img{display:block;height:330px;border-radius:14px;border:5px solid #11161d}
/* README용 */
.strip{display:flex;gap:12px;padding:0;background:#e9edf2}
.strip.pad{padding:22px 24px;gap:22px;justify-content:center}
.strip img{display:block}
`;

const page = (body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;

// ── 그림 1: 거래 한 번의 흐름 ──
const flow = [
  { head: "올리고, 출발 전에 본다", car: "04-car-briefing.png", ph: "02-seller-posted.png", text: "판매자는 다른 앱에 쓴 글을 붙여 넣어 올린다. 구매자가 차에서 목적지를 정하면, 이번 길 위의 관심 물건이 추천순으로 보인다." },
  { head: "가는 길에 묻고, 수락한다", car: "06-car-alert-camp.png", ph: "09-seller-takeover.png", text: "주행 중에는 한 번에 하나만 음성으로 묻는다. “응” 하면 판매자 폰에 요청이 뜨고, 수락하는 순간 대금이 보관된다." },
  { head: "들르는 동안 서로 안다", car: "10-car-on-the-way.png", ph: "12-seller-come-out.png", text: "내비에 경유지가 들어간다. 도착 3분 전 판매자에게 “나와 주세요”가 가고, 채팅·전화 없이 만난다." },
  { head: "건네받고 끝낸다", car: "13-car-inspect.png", ph: "14-seller-settled.png", text: "정차하면 현장 확인 화면이 열린다. 같으면 “받았어요”로 정산, 다르면 “안 살게요”로 전액 환불." },
];
const crop = async (browser, file) => {
  // E2E 차 화면 캡처(1720×860, 오른쪽에 가상 콘솔)에서 차 화면만 잘라 낸다
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0"><img src="${png(file)}" style="position:absolute;left:-32px;top:-16px"></body>`);
  const buf = await p.screenshot({ type: "png" });
  await p.close();
  return `data:image/png;base64,${buf.toString("base64")}`;
};

async function main() {
  const browser = await chromium.launch();
  const cars = {};
  for (const f of flow) cars[f.car] = await crop(browser, f.car);

  const fig1 = `<div class="fig" id="fig"><h2>거래 한 번이 지나가는 길</h2><div class="sub">위는 구매자의 차 화면, 아래는 판매자의 폰. 같은 순간을 세로로 맞췄다(시뮬레이터에서 찍은 실제 화면).</div>
  <div class="cols">${flow
    .map(
      (f, i) => `<div class="col"><div class="head"><span class="num">${i + 1}</span>${f.head}</div>
      <div class="rowtag">구매자의 차</div><img class="car" src="${cars[f.car]}">
      <div class="rowtag">판매자의 폰</div><img class="ph" src="${png(f.ph)}">
      <p>${f.text}</p></div>`,
    )
    .join("")}</div></div>`;

  const stops = [
    ["모드", "내비 상태 onNavigationStatus", "경로 안내 중이면 경로 매칭, 아니면 지역 매칭"],
    ["후보", "목적지·현재 위치", "이번 길 가까이의 관심 물건만 고른다"],
    ["우회", "requestTrip의 거리·도착 예정", "“7분 더”를 계산한다(건네받는 시간 포함)"],
    ["에너지", "도착 배터리 예측, EvBattery", "들렀다 가도 15% 이상 남을 때만 알린다"],
    ["적재", "Seat 2열·3열 착석 + 차종(한 번 선택)", "트렁크에 실리는 것만. 사람이 앉은 열은 접지 않는다"],
    ["말할 때", "TBT·방향지시등·조향각·브레이크", "회전·차선 변경·제동 중에는 말을 미룬다"],
    ["약속", "addWaypoint → getWaypointInfo", "경유지가 들어간 것을 확인한 뒤 판매자에게 확정"],
    ["만남", "경유지 남은 시간, onWayPointArrived", "3분 전 “나와 주세요”, 도착 알림"],
    ["건네기", "CarUxRestrictions(정차), Door 트렁크", "차가 멈춘 뒤에만 현장 확인. 트렁크를 닫으면 “실으셨나요?”"],
    ["마무리", "onDestinationArrived, Odometer", "따로 다녀왔다면 걸렸을 시간과 실제 늘어난 시간"],
  ];
  // 길 한 줄 위에 열 지점. 홀수 지점은 길 위쪽, 짝수 지점은 아래쪽에 깃발처럼 세운다(서로 겹치지 않게)
  const TW = 1140;
  const TH = 372;
  const MID = 186;
  const sx = (i) => 74 + i * 96;
  const bend = [0, -7, 5, -6, 7, -4, 6, -7, 5, 0];
  const sy = (i) => MID + bend[i];
  const smooth = (P) => {
    let d = `M${P[0][0]} ${P[0][1]}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)];
      const p1 = P[i];
      const p2 = P[i + 1];
      const p3 = P[Math.min(P.length - 1, i + 2)];
      d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  };
  const END = [1094, MID - 2];
  const road = smooth([[36, MID + 3], ...stops.map((_, i) => [sx(i), sy(i)]), [1012, MID - 5], END]);
  // 배경의 다른 길(앱 지도의 회색 도로처럼 흐리게)
  const lanes = [
    "M-10 30 C200 44 380 18 560 30 S900 46 1160 26",
    "M-10 350 C180 338 400 360 600 348 S940 336 1160 352",
    `M122 ${MID + 2} C128 240 108 300 120 350`,
    `M1052 ${MID - 4} C1046 130 1066 80 1056 30`,
  ];
  const fig2 = `<div class="fig" id="fig"><h2>여정 10단계마다 차에서 읽는 신호가 하나씩 있다</h2><div class="sub">차를 움직이지 않고 읽기만 한다. 길 위의 번호가 여정의 순서다. 청록 글자는 Pleos SDK(NaviHelper·Vehicle)와 AAOS에서 읽는 신호, 그 아래는 그 신호로 앱이 대신 내리는 판단.</div>
  <div class="trip"><svg viewBox="0 0 ${TW} ${TH}" aria-hidden="true">
    ${lanes.map((d) => `<path d="${d}" fill="none" stroke="#111820" stroke-width="7" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#2b3646" stroke-width="3.5" stroke-linecap="round"/>`).join("")}
    <path d="${road}" fill="none" stroke="#57d2e6" stroke-opacity=".09" stroke-width="30" stroke-linecap="round"/>
    <path d="${road}" fill="none" stroke="#57d2e6" stroke-opacity=".16" stroke-width="19" stroke-linecap="round"/>
    <path d="${road}" fill="none" stroke="#0b3640" stroke-width="13" stroke-linecap="round"/>
    <path d="${road}" fill="none" stroke="#57d2e6" stroke-width="8" stroke-linecap="round"/>
    <g transform="translate(36 ${MID + 3}) rotate(90)"><circle r="24" fill="rgba(87,210,230,.14)"/><circle r="16" fill="rgba(87,210,230,.2)"/><path d="M0 -15 L10.5 11.5 L0 6 L-10.5 11.5 Z" fill="#fff" stroke="#0b3640" stroke-width="2.2" stroke-linejoin="round"/></g>
    <g><path d="M${END[0]} ${END[1]} v-36" stroke="#e8edf3" stroke-width="3"/><path d="M${END[0]} ${END[1] - 36} h21 l-6 7.5 l6 7.5 h-21 z" fill="#e8edf3"/><circle cx="${END[0]}" cy="${END[1]}" r="5.5" fill="#e8edf3"/></g>
    ${stops.map((_, i) => `<circle cx="${sx(i)}" cy="${sy(i)}" r="13.5" fill="#d8ae74" stroke="#1d1a16" stroke-width="2.5"/><text x="${sx(i)}" y="${sy(i) + 4.8}" text-anchor="middle" font-size="${i === 9 ? 12.5 : 14}" font-weight="800" fill="#1d1a16" font-family="Asta">${i + 1}</text>`).join("")}
  </svg>
  ${stops
    .map((st, i) => {
      const up = i % 2 === 0;
      const pos = up ? `left:${sx(i) - 0.75}px;bottom:${TH - (sy(i) - 13.5)}px` : `left:${sx(i) - 0.75}px;top:${sy(i) + 13.5}px`;
      return `<div class="flagp ${up ? "up" : "down"}" style="${pos}"><div class="t">${st[0]}</div><div class="sig">${st[1]}</div><div class="do">${st[2]}</div></div>`;
    })
    .join("")}
  </div>
  <div class="tripkey"><span><i style="background:#57d2e6"></i>차에서 읽는 신호</span><span><i style="background:#aab6c5"></i>그 신호로 앱이 내리는 판단</span><span>음성은 Pleos TextToSpeech·SpeechToText(ON_DEVICE)와 Gleo AI 음성 비서 기능 3개로 묻고 듣는다</span></div></div>`;

  const fig3 = `<div class="fig" id="fig"><h2>같은 카시트 하나를, 폰으로 살 때와 차가 도울 때</h2><div class="sub">폰으로도 할 수는 있다. 차는 묻지 않아도 아는 신호로 판단·조율·실행을 대신한다.</div>
  <div class="vs">
    <div class="side phone"><h3>폰 중고 앱 + 내비</h3><div class="who">사람이 찾고, 묻고, 약속하고, 입력한다</div><ol>
      <li><span class="n">1</span><b>찾기</b><span>동네 기반 앱은 동네 밖 직거래 매물을 보여 주지 않고, 전국 앱은 내 경로를 모른다</span></li>
      <li><span class="n">2</span><b>묻기</b><span>채팅으로 “차 있으세요? 트렁크에 들어가요?”</span></li>
      <li><span class="n">3</span><b>약속</b><span>채팅으로 시간과 주소를 정한다. 안 올 수도, 와서 깎을 수도 있다</span></li>
      <li><span class="n">4</span><b>이동</b><span>내비에 주소를 직접 넣는다(운전 중에는 못 한다)</span></li>
      <li><span class="n">5</span><b>만남</b><span>도착해서 “도착했어요” 연락, 기다림</span></li>
      <li><span class="n">6</span><b>확인</b><span>사진과 다르면 그 자리에서 실랑이</span></li></ol></div>
    <div class="side car"><h3>주행중GO!</h3><div class="who">차가 고르고, 한 번 묻고, 넣고, 알린다</div><ol>
      <li><span class="n">1</span><b>찾기</b><span>이번 길 위에서 들를 만하고 실리는 물건만 골라 둔다<small>내비 경로 · 좌석 착석 · 도착 배터리 · 차종(한 번 선택)</small></span></li>
      <li><span class="n">2</span><b>묻기</b><span>“카시트, 7분 더, 트렁크에 쏙. 들를까요?” “응”<small>회전·방향지시등·제동 중이 아닐 때만</small></span></li>
      <li><span class="n">3</span><b>약속</b><span>판매자가 수락하는 순간 대금 보관. 흥정 없음</span></li>
      <li><span class="n">4</span><b>이동</b><span>내비 경유지가 자동으로 들어가고, 들어갔는지 다시 확인<small>addWaypoint → getWaypointInfo</small></span></li>
      <li><span class="n">5</span><b>만남</b><span>도착 3분 전 판매자에게 “나와 주세요”<small>경유지 남은 시간 · onWayPointArrived</small></span></li>
      <li><span class="n">6</span><b>확인</b><span>정차하면 현장 확인. 같으면 정산, 다르면 전액 환불</span></li></ol></div>
  </div>
  <div class="bottom">차 안에서 하지 않기로 한 것: 둘러보기·채팅·흥정. 주행 중에는 카드 하나, 사실 둘, 버튼 둘, 정해진 말(“응/아니”, 품목 이름)만.</div></div>`;

  const give = [
    ["가구·인테리어", 26.6, true],
    ["육아·유아용품", 17.9, true],
    ["의류·패션", 11.7, false],
    ["반려동물용품", 9.5, false],
    ["가전제품", 7.0, false],
  ];
  const fig4 = `<div class="fig" id="fig"><h2>시장은 이미 크고, 큰 물건은 팔리지 못하고 ‘나눔’으로 나간다</h2><div class="sub">공개된 숫자만 썼다. 설치율·활성률은 가정이고 설문과 출시 뒤 실데이터로 바꾼다.</div>
  <div class="biz">
    <div class="give"><h3>아파트 단지 ‘나눔’ 글의 품목 비중</h3>
      <div class="bars">${give.map(([l, v, hi]) => `<div class="bar ${hi ? "hi" : ""}"><span class="lab">${l}</span><span class="line"><span class="track" style="width:${((v / 26.6) * 78).toFixed(1)}%"></span><span class="val">${v.toFixed(1)}%</span></span></div>`).join("")}</div>
      <div class="call"><b>${(give[0][1] + give[1][1]).toFixed(1)}%</b><span>위 두 품목을 더한 값. 1위는 처치가 어려운 큰 가구, 2위는 쓰는 기간이 짧은 육아용품이다. 주행중GO!가 먼저 겨냥하는 두 품목.</span></div>
      <div class="src">중고거래 플랫폼의 아파트 단지 나눔 게시글 분석(2026-02-04~04-09), 헤럴드경제 2026-04-10</div></div>
    <dl class="facts">
      <div><dt>43<small>조 원</small></dt><dd>2025년 국내 중고거래 시장. 2008년 4조 원대, 2021년 24조 원에서 커졌다<cite>한국인터넷진흥원 집계 인용(한국경제 2026-03-14)</cite></dd></div>
      <div><dt>58<small>%</small></dt><dd>중고거래 플랫폼을 써 본 사람. 이용자의 52%는 주 1회 이상 쓴다<cite>컨슈머인사이트 2025 상반기, 14세 이상 3,109명</cite></dd></div>
      <div><dt>2만~3만<small>건</small></dt><dd>10만 원 미만 중고거래 분쟁만 한 해에. 약속과 물건 상태를 미리 묶어 둘 이유<cite>KISA 분쟁조정지원팀장 인터뷰(머니투데이 2026-06-28)</cite></dd></div>
      <div><dt>2,000<small>만 대</small></dt><dd>2030년까지 Pleos Connect 적용 목표. 2026년 5월 그랜저부터<cite>현대차그룹 보도자료 2026-04-30</cite></dd></div>
    </dl>
  </div>
  <div class="mau"><h3>출시 첫 12개월에 닿는 구매자 어림</h3><div class="eq">
    <div class="term"><b>약 20만 대</b><span>출시 12개월 국내 탑재<small>그랜저·아반떼 2026년 9월 판매 약 1만 6천 대 기준</small></span></div><i>×</i>
    <div class="term"><b>5~10%</b><span>설치율<em>가정</em></span></div><i>×</i>
    <div class="term"><b>30~50%</b><span>월 활성률<em>가정</em></span></div><i>=</i>
    <div class="term out"><b>약 3천~1만 명</b><span>구매자 월 활성 사용자(MAU)</span></div>
  </div></div>
  <div class="supply"><h3>공급부터 만든다</h3><div class="steps">
    <div class="st"><span class="num">1</span><p><b>판매점 몇 곳 + 한 구간</b>(수도권 남부 출퇴근축). 영업시간에 바로 응대하고 재고가 여럿이라 요청률·성사율을 먼저 잰다</p></div>
    <div class="st"><span class="num">2</span><p><b>개인 판매자 ‘같이 올리기’</b>. 다른 앱에 쓴 글을 붙여 넣으면 끝. 기존 앱을 그만둘 필요가 없다</p></div>
    <div class="st"><span class="num">3</span><p><b>구간 확대</b>. 출퇴근 경로는 매일 반복돼 앱을 열지 않아도 알림이 생긴다</p></div>
  </div></div></div>`;

  // ── 그림 5: SDK/API 사용 계획(시그니처는 docs/API_MATRIX.md의 바이너리 확인 결과와 같다) ──
  const sdk = [
    ["모드", "NaviHelper onNavigationStatus", "경로 안내 중이면 경로 매칭, 아니면 지역 매칭", "리스너"],
    ["후보", "getDestinationInfo · getCurrentLocationInfo", "목적지·남은 시간·현재 위치로 이번 길 위의 관심 물건을 고른다", "NAVI_ROUTE"],
    ["우회·에너지", "requestTrip → onTripInfo(distance, eta, estimatedSocAtDest) · EvBattery getEvBatteryStateOfCharge", "물건까지 시간, 들렀다 가도 도착 배터리 15% 이상일 때만 알린다", "NAVI_ROUTE · CAR_ENERGY"],
    ["적재", "Seat registerSeatOccupancy(ROW_2_*, ROW_3_*) <span>+ 차종은 처음 한 번 선택(CarInfo에 모델명 없음)</span>", "차종별 트렁크 치수표와 물건 실측을 비교. 사람이 앉은 열은 접지 않는다", "CAR_SEATS"],
    ["말할 때", "getTBTInfo/onTBTInfo · TurnSignal · SteeringWheel · Brake · <span>AAOS</span> CarUxRestrictionsManager", "회전 300m 전·방향지시등·조향·제동 중에는 알림을 미룬다. 주행 중 화면 제한", "NAVI_ROUTE · CAR_LIGHTS · CAR_DRIVE"],
    ["약속", "addWaypoint → onWaypointChanged · getWaypointInfo <span>재조회</span> · removeWaypoint", "수락 뒤 경유지 추가, 들어간 것을 확인한 뒤 판매자에게 확정. 거래 뒤 해제", "NAVI_ROUTE_SEARCH"],
    ["만남", "getWaypointInfo(remainTime) · onWayPointArrived", "도착 3분 전 “나와 주세요”, 도착 알림", "NAVI_ROUTE"],
    ["건네기", "<span>AAOS</span> CarUxRestrictions<span>(정차)</span> · Door registerDoorPosition(REAR)", "정차 뒤에만 현장 확인 화면. 트렁크 열림→닫힘이면 “실으셨나요?”", "—"],
    ["마무리", "onDestinationArrived · Odometer getCurrentDistanceDriven", "결과 카드: 따로 다녀왔다면 걸렸을 시간, 실제로 늘어난 시간·거리", "리스너"],
    ["음성", "TextToSpeech speak · SpeechToText request <span>(둘 다 ON_DEVICE, ko-KR)</span>", "알림 말하기, “응/아니”·품목 이름 듣기, 말로 묻고 고르기", "TTS_SERVICE · STT_SERVICE"],
    ["음성 비서", "<span>Gleo AI App Schema</span> actionCalls <span>3개 + Intent</span> · APP_ACTION_RESPONSE", "“유모차 관심 추가해 줘”, “들를게”, “카시트 흠집 있어?”", "스키마 검토"],
    ["오류", "onError(NaviErrorCode) · VehicleListener onFailed", "경유지 실패면 요청을 취소하고 구매자 신뢰도에는 넣지 않는다", "리스너"],
  ];
  const fig5 = `<div class="fig" id="fig"><h2>SDK/API 사용 계획: 차를 움직이지 않고 읽는다</h2><div class="sub">신청 없이 쓸 수 있는 NaviHelper·Vehicle 조회 기능으로 핵심을 만들었다. 시그니처·퍼미션은 실제 SDK 바이너리에서 확인한 것만 쓴다.</div>
  <table class="sdk"><thead><tr><th>단계</th><th>Pleos SDK / API</th><th>앱이 하는 일</th><th>퍼미션</th></tr></thead><tbody>
  ${sdk.map((r, i) => `<tr><td><span class="num">${i + 1}</span>${r[0]}</td><td class="api">${r[1]}</td><td>${r[2]}</td><td class="perm">${r[3]}</td></tr>`).join("")}
  </tbody></table>
  <div class="checks">
    <div class="checkc"><div class="k">시그니처</div><div class="v">바이너리에서 확인</div><div class="d">Vehicle 2.3.2 · NaviHelper 3.0.5 · TextToSpeech 3.3.1 · SpeechToText 3.3.1. 문서와 달랐던 곳은 Vehicle 리스너의 onFailed 하나</div></div>
    <div class="checkc"><div class="k">빌드</div><div class="v">릴리스 APK 성공</div><div class="d">실제 Pleos SDK로 pleosRelease를 빌드했다(저장소 apk/ 폴더)</div></div>
    <div class="checkc"><div class="k">시험</div><div class="v">끝까지 자동 시험 통과</div><div class="d">단위·API 테스트, 시뮬레이터 끝까지 시험(전체·분할 화면), SDK 브리지 계약 시험</div></div>
    <div class="checkc todo"><div class="k">에뮬레이터·실차 동작</div><div class="v">미실행</div><div class="d">2차 PT 전에 확인 항목 10개를 돌린다(addWaypoint 임의 좌표, 도착 콜백 시점, 주행 제한 변화, 트렁크 값, 주행거리 단위, 음성)</div></div>
  </div>
  <div class="src">쓰지 않는 것: 차량 제어(Door 잠금·조명), VehiclePropertyIds 직접 접근. SDK에 없는 경로 선과 “들르면 몇 분 더”는 서버 길찾기로 계산한다(시연: 수원~송파 도로망, 서비스: 외부 길찾기 API).</div></div>`;

  // ── 그림 6: 실제 화면 ──
  // 분할 화면 E2E 캡처(3440×1720, 두 배 해상도)에서 차 화면(8:9 창)만 잘라 낸다
  const cropSplit = async (file) => {
    const p = await browser.newPage({ viewport: { width: 622, height: 700 }, deviceScaleFactor: 2 });
    await p.setContent(`<body style="margin:0;background:#0b0f15"><img src="${png(file)}" style="position:absolute;left:-361px;top:-15px;width:1720px"></body>`);
    const buf = await p.screenshot({ type: "png" });
    await p.close();
    return `data:image/png;base64,${buf.toString("base64")}`;
  };
  const hasSplit = fs.existsSync(path.join(SHOT, "split-01-car-briefing.png"));
  const sp = hasSplit ? { brief: await cropSplit("split-01-car-briefing.png"), alert: await cropSplit("split-03-car-alert-camp.png") } : null;
  const fig6 = `<div class="fig" id="fig"><h2>실제로 동작하는 화면</h2><div class="sub">모두 시뮬레이터에서 찍은 실제 화면이다(목업이 아니다). 같은 흐름을 시연 영상과 브라우저 체험 페이지에서 볼 수 있다.</div>
  <div class="shots">
    <div class="shot"><img src="${cars["04-car-briefing.png"]}"><div class="cap"><b>출발 전 브리핑(정차)</b>목적지를 정하면 이번 길 위의 관심 물건을 지도 번호 핀과 추천순 목록으로 보여 준다. 고르면 판매자 글 요약을 읽어 준다.</div></div>
    <div class="shot"><img src="${cars["06-car-alert-camp.png"]}"><div class="cap"><b>주행 중 알림</b>한 번에 하나, 물건 이름·우회 시간·사실 둘·버튼 둘. 대답은 “응/아니” 한 마디.</div></div>
  </div>
  <div class="row2">
    ${sp ? `<div><div class="splits"><img src="${sp.brief}"><img src="${sp.alert}"></div><div class="cap" style="max-width:600px"><b>분할 화면(1:1)</b>다른 앱과 화면을 나눠 쓸 때는 지도가 위, 목록·알림 카드가 아래로 다시 배치된다.</div></div>` : "<div></div>"}
    <div><div class="phones"><img src="${png("03-seller-listings.png")}"><img src="${png("09-seller-takeover.png")}"><img src="${png("17-buyer-home.png")}"></div><div class="cap" style="text-align:right"><b>폰(설치 없는 웹)</b>판매자 홈, 요청 전체 화면(도착 예정·차종·적재 판단), 구매자 홈.</div></div>
  </div></div>`;

  const figs = { "fig1-flow.png": fig1, "fig2-signals.png": fig2, "fig3-phone-vs-car.png": fig3, "fig4-business.png": fig4, "fig5-sdk.png": fig5, "fig6-screens.png": fig6 };
  for (const [name, html] of Object.entries(figs)) {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    await p.setContent(page(html), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    await p.locator("#fig").screenshot({ path: path.join(OUT, name) });
    await p.close();
    console.log(name, Math.round(fs.statSync(path.join(OUT, name)).size / 1024), "KB");
  }

  // ── README용 그림(JPEG): 차 화면 둘, 분할 화면 둘, 폰 셋 ──
  const strips = {
    "car.jpg": [1600, `<div class="strip" id="fig" style="width:1600px;gap:8px;background:#0b0f15"><img src="${cars["04-car-briefing.png"]}" style="width:796px"><img src="${cars["06-car-alert-camp.png"]}" style="width:796px"></div>`],
    "phones.jpg": [1266, `<div class="strip pad" id="fig" style="width:1266px"><img src="${png("03-seller-listings.png")}" style="width:390px"><img src="${png("09-seller-takeover.png")}" style="width:390px"><img src="${png("17-buyer-home.png")}" style="width:390px"></div>`],
  };
  if (sp) strips["split.jpg"] = [1266, `<div class="strip pad" id="fig" style="width:1266px;background:#0b0f15"><img src="${sp.brief}" style="width:560px;border-radius:14px"><img src="${sp.alert}" style="width:560px;border-radius:14px"></div>`];
  for (const [name, [w, html]] of Object.entries(strips)) {
    const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await p.setContent(page(html), { waitUntil: "load" });
    await p.waitForTimeout(100);
    await p.locator("#fig").screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 86 });
    await p.close();
    console.log(name, Math.round(fs.statSync(path.join(OUT, name)).size / 1024), "KB");
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
