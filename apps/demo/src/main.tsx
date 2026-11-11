/**
 * 주행중GO! 체험 페이지 — 판매자 폰과 구매자 차량 화면을 한 페이지에 띄운다.
 * 서버 코드(services/api)를 페이지 안에서 메모리 저장소로 돌리고, 두 앱이 같은 서버에 붙는다.
 * 차량 쪽은 브라우저 시뮬레이터 + 가상 콘솔(실제 차에서는 Android 셸의 Pleos SDK 브리지).
 */
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEMO_PLACES } from "@jhgo/core";
import { createDirectClock, createLocalBackend, type ApiClient, type AppClock } from "@jhgo/api/browser";
import { CarApp, bootCar, type CarBoot } from "../../car-web/src/CarApp.tsx";
import { SellerApp } from "../../seller-web/src/SellerApp.tsx";
import { BuyerApp } from "../../buyer-web/src/BuyerApp.tsx";
import "./demo.css";

// ── 자동 시연: 버튼 하나로 7단계가 저절로 진행된다(클릭 없이 보기). 차·판매자 폰·서버는 손으로 할 때와 같은 길을 지난다 ──
const GUIDE_STEPS = [
  "목적지를 송파 집으로 정해요. 길 위의 관심 매물이 번호 핀과 목록으로 보이고, 고르면 읽어 줘요. 조수에게 \"카시트 흠집 있어?\"라고 물어봐요",
  "2열에 아이가 타고(아기 침대 제외), 10배속으로 출발해요",
  "영통 캠핑의자 알림. 말로 \"아니\"라고 답해요",
  "분당: 카시트? 유모차? 말로 \"카시트\", 이어서 \"응\"",
  "판매자 폰에 요청이 떠요. 판매자가 수락하면 대금을 보관하고 경유지를 넣어요",
  "가는 중. 판매자가 '지금 나가요'를 누르고, 차가 경유지에 도착하면 현장 확인 화면",
  "판매자 '건넸어요', 차 '받았어요'. 다시 출발해 목적지에 도착하면 결과 카드에서 판매자 평가",
];

interface GuideState {
  step: number;
  note: string;
  error: string | null;
  done: boolean;
}

async function runGuide(boot: CarBoot, seller: ApiClient, clock: AppClock, set: (g: Partial<GuideState>) => void, stopped: () => boolean) {
  const c = boot.controller;
  const sim = boot.sim!;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (pred: () => boolean, ms: number, what: string) => {
    const t0 = Date.now();
    while (!pred()) {
      if (stopped()) throw new Error("stopped");
      if (Date.now() - t0 > ms) throw new Error(`${what}이(가) 시간 안에 오지 않았어요`);
      await sleep(150);
    }
  };
  const pause = async (ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (stopped()) throw new Error("stopped");
      await sleep(100);
    }
  };
  const hear = (w: string) => boot.platform.voice.hear?.(w);
  const sellerDo = (id: string, what: string) => seller.call("POST", `/v1/seller/trades/${id}/${what}`);

  set({ step: 1, note: "" });
  await c.setDestination(DEMO_PLACES.home);
  await until(() => c.state.mode === "route" && c.state.candidates.length > 0, 20000, "브리핑");
  await pause(2500);
  // 목록 1위를 고르면 읽어 주고(T33), 조수에게 묻는다(T34)
  const top = [...c.state.candidates].filter((x) => x.exclusions.length === 0).sort((x, y) => y.score - x.score)[0];
  if (top) {
    c.setFocus(top.listingId);
    c.speakBrief(top.listingId);
    await pause(3000);
    await c.ask(`${top.categoryLabel} 흠집 있어?`);
    await pause(3500);
  }

  set({ step: 2 });
  sim.setRow2Occupied(true);
  await clock.setRate?.(10);
  await pause(1200);
  sim.setGear("D");
  await until(() => c.state.alert?.kind === "single", 90000, "캠핑의자 알림");

  set({ step: 3 });
  await until(() => !!c.state.alert?.listening || !c.state.alert, 12000, "듣는 시간");
  if (c.state.alert?.listening) hear("아니");
  else if (c.state.alert) await c.answer(false);
  await pause(1500);
  await clock.setRate?.(30);
  await until(() => c.state.alert?.kind === "contention", 150000, "경합 질문");

  set({ step: 4 });
  await until(() => !!c.state.alert?.listening || c.state.alert?.kind !== "contention", 12000, "듣는 시간");
  if (c.state.alert?.kind === "contention") {
    if (c.state.alert.listening) hear("카시트");
    else c.choose(c.state.alert.pair.find((x) => x.categoryLabel === "카시트")!.listingId);
  }
  await until(() => c.state.alert?.kind === "single", 12000, "카시트 알림");
  await until(() => !!c.state.alert?.listening || !c.state.alert, 12000, "듣는 시간");
  if (c.state.alert?.listening) hear("응");
  else if (c.state.alert) await c.answer(true);
  await until(() => !!c.state.trade, 15000, "요청");

  set({ step: 5 });
  await pause(3000);
  const tradeId = c.state.trade!.id;
  await sellerDo(tradeId, "accept");
  await until(() => c.state.trade?.status === "accepted" && !!c.state.trade.waypointConfirmedAt, 20000, "경유지 확정");
  await pause(2500);

  set({ step: 6 });
  await sellerDo(tradeId, "coming");
  await until(() => c.state.screen === "inspect", 300000, "경유지 도착");
  await pause(3500);

  set({ step: 7 });
  await sellerDo(tradeId, "handed");
  await until(() => !!c.state.trade?.handedAt, 15000, "건넸어요");
  await pause(2500);
  await c.received();
  await pause(3000);
  sim.setGear("D");
  await until(() => c.state.screen === "result", 300000, "목적지 도착");
  await pause(2500);
  const r = c.state.result;
  if (r?.items[0]) await c.rate(r.items[0].tradeId, 4);
  await clock.setRate?.(1);
  set({ done: true, note: "끝났어요. 구매자 폰에서 거래 내역과 평가를 볼 수 있어요" });
}

function GuideBar({ g, onStop }: { g: GuideState; onStop: () => void }) {
  return (
    <div className={`guide ${g.error ? "err" : g.done ? "done" : ""}`} role="status" aria-live="polite" data-testid="guide">
      <span className="guide-step">{g.done ? "✓" : g.step}</span>
      <span className="guide-text">{g.error ? `멈췄어요: ${g.error}` : g.done ? g.note : GUIDE_STEPS[g.step - 1]}</span>
      {!g.done && !g.error && (
        <button onClick={onStop} data-testid="guide-stop">
          멈추기
        </button>
      )}
    </div>
  );
}

const AUTO_FLAG = "jhgo.demo.auto";
/** 새로 고친 뒤 자동 시연을 이어 가기 위한 표시 — 아티팩트 iframe처럼 주소를 못 바꾸는 곳에서도 되게 sessionStorage를 먼저 쓴다 */
function readAutoFlag(): boolean {
  try {
    if (sessionStorage.getItem(AUTO_FLAG)) {
      sessionStorage.removeItem(AUTO_FLAG);
      return true;
    }
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return false;
}

/**
 * 무대 배치(?stage): 차량 앱 시작 화면의 '자동 시연 보기'가 여는 모습. 안내 글·순서 목록·가상 콘솔을 접고
 * 차 화면과 폰을 창 크기에 맞춰 한 화면에 넣는다(스크롤 없음). 가로로 넓으면 나란히, 좁거나 세로면(분할 창) 위아래로.
 */
const PHONE_W = 390;
const PHONE_H = 844;
function fitStage(bench: HTMLElement, head: HTMLElement) {
  const pad = 12;
  const gap = 14;
  const tabs = 46; // 폰 고르기 버튼 줄
  const availW = window.innerWidth - pad * 2;
  const availH = window.innerHeight - pad * 2 - head.offsetHeight - 10;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let zoom = clamp((availH - tabs) / PHONE_H, 0.42, 1);
  let carW = Math.min(availW - gap - PHONE_W * zoom, (availH * 16) / 9);
  let stack = availW / availH < 1.45 || carW < 520;
  if (stack) {
    carW = Math.min(availW, (availH * 0.58 * 16) / 9);
    const carH = (carW * 9) / 16;
    zoom = clamp((availH - carH - gap - tabs) / PHONE_H, 0.3, 1);
    // 폰이 너무 작아지면(낮고 좁은 창) 차 화면만 크게
    if (zoom < 0.36) {
      stack = false;
      zoom = 0;
      carW = Math.min(availW, (availH * 16) / 9);
    }
  }
  bench.style.setProperty("--car-w", `${Math.floor(carW)}px`);
  bench.style.setProperty("--phone-zoom", String(Math.round(zoom * 1000) / 1000));
  bench.classList.toggle("stack", stack);
  bench.classList.toggle("no-phone", zoom === 0);
}

function Bench({ boot, seller, buyer, clock, auto, stage }: { boot: CarBoot; seller: ApiClient; buyer: ApiClient; clock: AppClock; auto: boolean; stage: boolean }) {
  const reset = () => location.reload();
  const benchRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!stage || !benchRef.current || !headRef.current) return;
    const bench = benchRef.current;
    const head = headRef.current;
    document.documentElement.classList.add("stage-root");
    const fit = () => fitStage(bench, head);
    fit();
    window.addEventListener("resize", fit);
    // 진행 줄 글이 두 줄이 되면 머리 높이가 바뀐다
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(head);
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
      document.documentElement.classList.remove("stage-root");
    };
  }, [stage]);
  const [phone, setPhone] = useState<"seller" | "buyer">("seller");
  const [guide, setGuide] = useState<GuideState | null>(null);
  const stopFlag = useRef(false);
  const begin = () => {
    stopFlag.current = false;
    const g: GuideState = { step: 1, note: "", error: null, done: false };
    setGuide({ ...g });
    const set = (p: Partial<GuideState>) => {
      Object.assign(g, p);
      setGuide({ ...g });
    };
    runGuide(boot, seller, clock, set, () => stopFlag.current).catch((e: unknown) => {
      const m = e instanceof Error ? e.message : String(e);
      set({ error: m === "stopped" ? "'처음부터 다시'를 누르면 새로 시작해요" : m });
    });
  };
  useEffect(() => {
    if (!auto || !boot.sim) return;
    const t = setTimeout(begin, 1500);
    return () => clearTimeout(t);
  }, [auto, boot]);
  const startGuide = () => {
    const st = boot.controller.state;
    // 아직 아무것도 안 했으면 그 자리에서, 손댄 뒤라면 새로 고쳐(페이지 안 서버 초기화) 처음부터
    if (st.mode === "idle" && !st.trade && !st.result && st.screen === "map") {
      begin();
      return;
    }
    try {
      sessionStorage.setItem(AUTO_FLAG, "1");
      location.reload();
    } catch {
      const u = new URL(location.href);
      u.searchParams.set("auto", "");
      location.href = u.toString();
    }
  };
  // 판매자에게 차가 오면(요청·곧 도착·도착·기다림) 판매자 폰으로 돌려 놓는다
  useEffect(
    () =>
      seller.subscribe((e) => {
        if (["request.new", "trade.come_out", "trade.arrived", "trade.waiting"].includes(e.type)) setPhone("seller");
      }),
    [seller],
  );
  return (
    <div className={`bench ${stage ? "stage" : ""}`} ref={benchRef}>
      <header className="bench-head" ref={headRef}>
        <h1>{stage ? "주행중GO! 자동 시연" : "주행중GO! 체험"}</h1>
        {!stage && (
          <p>
            왼쪽은 구매자 차의 내비 화면과 가상 콘솔, 오른쪽은 카시트를 올린 판매자의 폰이에요. 폰 위 버튼으로 구매자의 폰(결제 수단·거래 내역·평가)으로 바꿔 볼 수 있어요. 모두 이 페이지 안에서 도는 같은 서버에 붙어 있어요. 아래 순서대로 직접 눌러 보거나, <b>자동 시연</b>을 누르면 2분 동안 저절로 진행돼요.
          </p>
        )}
        {stage && guide && (
          <GuideBar
            g={guide}
            onStop={() => {
              stopFlag.current = true;
            }}
          />
        )}
        <div className="bench-actions">
          {!guide && (
            <button className="bench-auto" onClick={startGuide} data-testid="guide-start">
              자동 시연
            </button>
          )}
          <button className="bench-reset" onClick={reset}>
            처음부터 다시
          </button>
        </div>
      </header>
      {!stage && guide && (
        <GuideBar
          g={guide}
          onStop={() => {
            stopFlag.current = true;
          }}
        />
      )}
      <ol className="bench-steps" aria-label="시연 순서" hidden={stage}>
        <li>
          <span>차 화면 왼쪽 <b>목적지</b>에서 송파 집</span>
        </li>
        <li>
          <span>가상 콘솔에서 <b>2열 착석</b>을 켜고 <b>10×</b>, <b>D 주행</b></span>
        </li>
        <li>
          <span>영통 캠핑의자 알림에 답하기(버튼 또는 콘솔 <b>음성 대답</b>)</span>
        </li>
        <li>
          <span>분당에서 <b>카시트</b>를 고르고 들를게요</span>
        </li>
        <li>
          <span>판매자 폰에서 <b>수락</b></span>
        </li>
        <li>
          <span>도착하면 폰 <b>건넸어요</b>, 차 <b>받았어요</b>, 다시 <b>D 주행</b></span>
        </li>
        <li>
          <span>결과 카드에서 <b>판매자 평가</b>, 구매자 폰에서 거래 내역 보기</span>
        </li>
      </ol>
      <main className="bench-main">
        <section className="demo-car" aria-label="구매자 차량 화면">
          <CarApp boot={boot} onReset={reset} />
        </section>
        <aside className="phone-wrap" aria-label={phone === "seller" ? "판매자 폰" : "구매자 폰"}>
          <div className="phone-switch" role="tablist" aria-label="폰 고르기">
            <button role="tab" aria-selected={phone === "seller"} className={phone === "seller" ? "on" : ""} onClick={() => setPhone("seller")} data-testid="phone-seller">
              판매자 폰
            </button>
            <button role="tab" aria-selected={phone === "buyer"} className={phone === "buyer" ? "on" : ""} onClick={() => setPhone("buyer")} data-testid="phone-buyer">
              구매자 폰
            </button>
          </div>
          <div className="phone">
            {/* 둘 다 띄워 두고 보이는 것만 바꾼다 — 판매자 폰은 가려져 있어도 실시간 알림을 받는다 */}
            <div className="phone-screen" hidden={phone !== "seller"}>
              <SellerApp client={seller} clock={clock} embedded storageKey="jhgo.demo.seller" />
            </div>
            <div className="phone-screen" hidden={phone !== "buyer"}>
              <BuyerApp client={buyer} clock={clock} embedded storageKey="jhgo.demo.buyer" />
            </div>
          </div>
          <p className="phone-note">{phone === "seller" ? "판매자 박서연(판교 백현동)의 폰" : "구매자 김주행의 폰 — 차와 같은 계정"}</p>
        </aside>
      </main>
    </div>
  );
}

async function start() {
  // ?compose: 카시트가 아직 안 올라간 상태로 시작(판매자 폰에서 같이 올리기부터)
  const params = new URLSearchParams(location.search);
  const compose = params.has("compose");
  // ?auto(또는 '자동 시연'을 눌러 새로 고친 뒤): 열리자마자 자동 시연(7단계)을 돌린다
  const auto = params.has("auto") || readAutoFlag();
  // ?stage: 차량 앱 안에서 여는 무대 배치(창에 맞춰 한 화면, 안내 글·콘솔 접음)
  const stage = params.has("stage");
  const b = createLocalBackend({ includeCarSeat: !compose });
  const clock = createDirectClock(b.clock as never);
  // 판매자 폰은 카시트를 올려 둔 박서연으로 미리 들어가 있게 한다(로그인 화면에서 다른 판매자로 바꿀 수 있다)
  const seller = b.client();
  const { users } = await seller.call<{ users: { id: string; role: string; name: string }[] }>("GET", "/v1/demo/users");
  const park = users.find((u) => u.role === "seller" && u.name === "박서연");
  if (park) {
    const s = await seller.call<{ token: string }>("POST", "/v1/session", { userId: park.id });
    seller.setToken(s.token);
  }
  // 구매자 폰은 차와 같은 구매자(김주행) 계정으로
  const buyer = b.client();
  const kim = users.find((u) => u.role === "buyer" && u.name === "김주행");
  if (kim) {
    const s = await buyer.call<{ token: string }>("POST", "/v1/session", { userId: kim.id });
    buyer.setToken(s.token);
  }
  const boot = bootCar(b.client(), clock, { storageKey: "jhgo.demo.car" });
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Bench boot={boot} seller={seller} buyer={buyer} clock={clock} auto={auto} stage={stage} />
    </StrictMode>,
  );
}

void start();
