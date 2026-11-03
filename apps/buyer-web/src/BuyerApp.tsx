/**
 * 구매자 폰 — 차 밖에서 하는 일(기획서 12장 '구매자 모바일 웹', T12·T21·T23):
 * 차에서 알림을 받을 준비(결제 수단·관심 물건·차종), 관심 물건과 돌아가도 되는 시간, 거래 내역·대금 흐름·평가·현장 사진.
 * 거래 진행(요청·경유지·현장 확인)은 차 화면에서 한다. 여기서는 보기만 한다.
 */
import { useCallback, useEffect, useState } from "react";
import { josa, kstClock, kstParts, type GoLevel, type GoSetting } from "@jhgo/core";
import type { ApiClient, AppClock, AppEvent } from "@jhgo/api";
import { DemoLogin, Icon, Mark, Sheet, Stars, useToast } from "../../seller-web/src/kit.tsx";
import "../../seller-web/src/styles.css";
import "./buyer.css";

interface Me {
  id: string;
  name: string;
  role: string;
  settings?: GoSetting;
  vehicle?: { model: string; seatRows?: number };
  paymentMethod?: { kind: string; label: string; addedAt: number };
}
interface BuyerTrade {
  id: string;
  title: string;
  category: string;
  price: number;
  status: string;
  createdAt: number;
  etaAt: number | null;
  acceptedAt?: number;
  arrivedAt?: number;
  handedAt?: number;
  receivedAt?: number;
  settleAt?: number;
  settledAt?: number;
  canceledAt?: number;
  sellerAbsentAt?: number;
  noShowAt?: number;
  declinedAt?: number;
  sellerComingAt?: number;
  autoConfirmed?: boolean;
  payment: { status: string; amount: number; heldAt?: number; capturedAt?: number; refundedAt?: number };
  photos: string[];
  ratings: { buyerToSeller?: number; sellerToBuyer?: number };
  mismatch?: { reason: string; photos?: string[]; at?: number };
  reason?: string;
  seller: { name: string; completed: number; rating: number | null } | null;
}
interface InterestView {
  id: string;
  type: "keyword" | "wish";
  keyword?: string;
  listingId?: string;
  title?: string;
  listingStatus?: string;
  goLevel: GoLevel;
}
interface Block {
  reason: "payment" | "limit";
  text: string;
}
interface Catalog {
  categories: { id: string; label: string }[];
  vehicles: { model: string; powertrain: string; seatRows: number }[];
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const GO: Record<GoLevel, { label: string; hint: string }> = {
  must: { label: "무조건 GO", hint: "꼭 사고 싶은 것" },
  likely: { label: "웬만하면 GO", hint: "조건이 맞으면" },
  near: { label: "가까우면 GO", hint: "가는 길 바로 옆이면" },
};
const LEVELS: GoLevel[] = ["must", "likely", "near"];
const STATUS: Record<string, { text: string; tone: "" | "go" | "reserved" | "red" }> = {
  requested: { text: "판매자 응답 기다림", tone: "reserved" },
  accepted: { text: "가는 중", tone: "reserved" },
  arrived: { text: "도착", tone: "reserved" },
  completed: { text: "받음, 정산 대기", tone: "go" },
  settled: { text: "거래 완료", tone: "go" },
  declined: { text: "판매자가 거절", tone: "" },
  expired: { text: "응답 없음", tone: "" },
  canceled: { text: "취소", tone: "" },
  declined_mismatch: { text: "현장 거절, 환불", tone: "red" },
  no_show: { text: "도착 못 함, 환불", tone: "red" },
  seller_no_show: { text: "판매자 못 만남, 환불", tone: "red" },
};
const ACTIVE = ["requested", "accepted", "arrived"];
const dateText = (ms: number) => {
  const p = kstParts(ms);
  return `${p.month}월 ${p.day}일 ${kstClock(ms)}`;
};

async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

export function BuyerApp({ client, clock, embedded = false, storageKey = "jhgo.buyer.token" }: { client: ApiClient; clock: AppClock; embedded?: boolean; storageKey?: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<"home" | "interests" | "trades">("home");
  const [trades, setTrades] = useState<BuyerTrade[]>([]);
  const [interests, setInterests] = useState<InterestView[]>([]);
  const [trust, setTrust] = useState<{ completed: number; noShow: number; canceled: number } | null>(null);
  const [block, setBlock] = useState<Block | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sheet, setSheet] = useState<null | "pay" | "car" | { trade: string } | { interest: string }>(null);
  const toast = useToast();
  const say = toast.show;

  // 세션이 끝나면(시연 초기화·다른 기기 로그인) 로그인 화면으로 돌아간다
  const signOut = useCallback(() => {
    client.setToken(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* 무시 */
    }
    setMe(null);
  }, [client, storageKey]);

  const refresh = useCallback(async () => {
    const [p, t] = await Promise.all([
      client.call<{ user: Me; interests: InterestView[]; trust: { completed: number; noShow: number; canceled: number }; block: Block | null }>("GET", "/v1/buyer/profile"),
      client.call<{ trades: BuyerTrade[] }>("GET", "/v1/buyer/trades"),
    ]);
    setMe(p.user);
    setInterests(p.interests);
    setTrust(p.trust);
    setBlock(p.block);
    setTrades(t.trades);
  }, [client]);
  const safeRefresh = useCallback(async () => {
    try {
      await refresh();
    } catch (e) {
      if ((e as { status?: number }).status === 401) signOut();
    }
  }, [refresh, signOut]);

  useEffect(() => {
    void (async () => {
      await clock.sync();
      let token = client.token();
      if (!token) {
        try {
          token = localStorage.getItem(storageKey);
        } catch {
          token = null;
        }
      }
      if (token) {
        client.setToken(token);
        try {
          const r = await client.call<{ user: Me }>("GET", "/v1/me");
          if (r.user.role === "buyer") setMe(r.user);
          else client.setToken(null);
        } catch {
          client.setToken(null);
        }
      }
      setCatalog(await client.call<Catalog>("GET", "/v1/catalog").catch(() => null));
      setChecked(true);
    })();
  }, [client, clock, storageKey]);

  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    void safeRefresh();
    const off = client.subscribe((e: AppEvent) => {
      void safeRefresh();
      if (["trade.accepted", "trade.declined", "trade.refunded", "trade.settled", "trade.canceled"].includes(e.type)) say(e.title);
    });
    const poll = setInterval(() => void safeRefresh(), 15000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [meId, client, safeRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (b: { userId?: string }) => {
    const r = await client.call<{ token: string; user: Me }>("POST", "/v1/session", { userId: b.userId });
    client.setToken(r.token);
    try {
      localStorage.setItem(storageKey, r.token);
    } catch {
      /* 저장 못 해도 계속 */
    }
    setMe(r.user);
  };

  const run: Run = async (fn, ok) => {
    try {
      await fn();
      await refresh();
      if (ok) say(ok);
      return true;
    } catch (e) {
      say({ text: (e as Error).message, tone: "warn" });
      return false;
    }
  };

  if (!checked) return <div className={`s-root b-root ${embedded ? "embedded" : ""}`} />;
  if (!me)
    return (
      <DemoLogin
        client={client}
        role="buyer"
        intro={
          <>
            가는 길에 있는 중고 물건,
            <br />
            차가 먼저 알려 드려요
          </>
        }
        sub="차에서 쓰는 계정의 폰 화면이에요. 결제 수단, 관심 물건, 거래 내역을 여기서 다뤄요."
        onLogin={login}
        embedded={embedded}
        testPrefix="blogin-"
      />
    );

  const hasActive = trades.some((t) => ACTIVE.includes(t.status));
  const openTrade = trades.find((t) => typeof sheet === "object" && sheet && "trade" in sheet && sheet.trade === t.id) ?? null;
  const openInterest = interests.find((i) => typeof sheet === "object" && sheet && "interest" in sheet && sheet.interest === i.id) ?? null;

  return (
    <div className={`s-root b-root ${embedded ? "embedded" : ""}`} data-testid="buyer-app">
      <div className="s-phone">
        <header className="s-appbar">
          <Mark role="구매자" />
          <span className="s-role">구매자</span>
        </header>
        <main className="s-main">
          {tab === "home" && <Home me={me} interests={interests} trades={trades} trust={trust} block={block} onPay={() => setSheet("pay")} onCar={() => setSheet("car")} onInterests={() => setTab("interests")} onTrades={() => setTab("trades")} onTrade={(id) => setSheet({ trade: id })} />}
          {tab === "interests" && <Interests interests={interests} settings={me.settings ?? null} catalog={catalog} client={client} run={run} onOpen={(id) => setSheet({ interest: id })} />}
          {tab === "trades" && <Trades trades={trades} onOpen={(id) => setSheet({ trade: id })} />}
        </main>
        <nav className="s-tabbar" aria-label="구매자 메뉴">
          <button className={tab === "home" ? "on" : ""} onClick={() => setTab("home")} aria-current={tab === "home" ? "page" : undefined} data-testid="btab-home">
            <Icon name="home" size={24} stroke={tab === "home" ? 2.1 : 1.8} />홈{!me.paymentMethod && <span className="s-tab-dot" aria-label="할 일 있음" />}
          </button>
          <button className={tab === "interests" ? "on" : ""} onClick={() => setTab("interests")} aria-current={tab === "interests" ? "page" : undefined} data-testid="btab-interests">
            <Icon name="heart" size={24} stroke={tab === "interests" ? 2.1 : 1.8} />
            관심 물건
          </button>
          <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")} aria-current={tab === "trades" ? "page" : undefined} data-testid="btab-trades">
            <Icon name="receipt" size={24} stroke={tab === "trades" ? 2.1 : 1.8} />
            거래 내역
            {hasActive && <span className="s-tab-dot" aria-label="진행 중" />}
          </button>
        </nav>
      </div>
      {sheet === "pay" && <PaySheet me={me} hasActive={hasActive} client={client} run={run} onClose={() => setSheet(null)} />}
      {sheet === "car" && <CarSheet me={me} catalog={catalog} client={client} run={run} onClose={() => setSheet(null)} />}
      {openTrade && <TradeSheet t={openTrade} client={client} run={run} onClose={() => setSheet(null)} />}
      {openInterest && <InterestSheet it={openInterest} client={client} run={run} onClose={() => setSheet(null)} />}
      {toast.view}
    </div>
  );
}

/* ─────────── 홈: 차에서 알림 받을 준비 ─────────── */

function Home({
  me,
  interests,
  trades,
  trust,
  block,
  onPay,
  onCar,
  onInterests,
  onTrades,
  onTrade,
}: {
  me: Me;
  interests: InterestView[];
  trades: BuyerTrade[];
  trust: { completed: number; noShow: number; canceled: number } | null;
  block: Block | null;
  onPay: () => void;
  onCar: () => void;
  onInterests: () => void;
  onTrades: () => void;
  onTrade: (id: string) => void;
}) {
  const todo = [!me.paymentMethod, interests.length === 0].filter(Boolean).length;
  const active = trades.filter((t) => ACTIVE.includes(t.status));
  const recent = trades.filter((t) => !ACTIVE.includes(t.status)).slice(0, 3);
  return (
    <>
      <section className="s-hero">
        <div className="s-hello">{me.name}님</div>
        <h1>{todo ? `차에서 알림을 받으려면 ${todo}가지만 하면 돼요` : "차에서 알림 받을 준비가 됐어요"}</h1>
        <p className="s-hero-sub">{todo ? "아래에서 바로 할 수 있어요" : "가는 길에 관심 물건이 있으면 차가 먼저 알려 드려요"}</p>
      </section>
      {block?.reason === "limit" && (
        <div className="s-notice warn" data-testid="buyer-block">
          <Icon name="alert" />
          <p>{block.text}</p>
        </div>
      )}
      <div className="b-car" data-testid="car-card">
        <svg className="b-car-route" viewBox="0 0 168 92" aria-hidden="true">
          <path d="M-4 70 C 40 70, 52 28, 96 30 S 150 52, 176 14" fill="none" stroke="#57d2e6" strokeOpacity=".34" strokeWidth="5" strokeLinecap="round" />
          <circle cx="96" cy="30" r="6.5" fill="#18202b" stroke="#d9b27c" strokeWidth="3" />
        </svg>
        <div className="b-car-head">
          <div>
            <span className="b-car-label">내 차</span>
            <b>{me.vehicle?.model ?? "차종을 골라 주세요"}</b>
          </div>
          <button className="b-car-btn" onClick={onCar} data-testid="vehicle-open">
            바꾸기
          </button>
        </div>
        <div className="b-checks">
          <button className={`b-check ${me.paymentMethod ? "ok" : "todo"}`} onClick={onPay} data-testid="pay-method">
            <span className="b-check-mark" aria-hidden="true">
              {me.paymentMethod ? <Icon name="check" size={15} stroke={3} /> : <Icon name="card" size={15} stroke={2.2} />}
            </span>
            <span className="b-check-main">
              결제 수단
              <small>{me.paymentMethod ? me.paymentMethod.label : "없으면 판매자에게 요청할 수 없어요"}</small>
            </span>
            <span className="b-check-act">{me.paymentMethod ? "보기" : "등록"}</span>
          </button>
          <button className={`b-check ${interests.length ? "ok" : "todo"}`} onClick={onInterests} data-testid="interest-check">
            <span className="b-check-mark" aria-hidden="true">
              {interests.length ? <Icon name="check" size={15} stroke={3} /> : <Icon name="heart" size={15} stroke={2.2} />}
            </span>
            <span className="b-check-main">
              관심 물건
              <small>{interests.length ? interests.map((i) => (i.type === "keyword" ? i.keyword : i.title)).slice(0, 3).join(", ") + (interests.length > 3 ? ` 외 ${interests.length - 3}개` : "") : "찾는 물건을 알려 주세요"}</small>
            </span>
            <span className="b-check-act">{interests.length ? `${interests.length}개` : "추가"}</span>
          </button>
          <div className="b-check ok static">
            <span className="b-check-mark" aria-hidden="true">
              <Icon name="check" size={15} stroke={3} />
            </span>
            <span className="b-check-main">
              실을 수 있는지
              <small>{me.vehicle ? `${me.vehicle.model} 트렁크 크기로 판단해요` : "차종을 고르면 판단해요"}</small>
            </span>
          </div>
        </div>
      </div>

      {active.map((t) => (
        <button className="b-active" key={t.id} onClick={() => onTrade(t.id)} data-testid="b-active">
          {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <span className="s-thumb" />}
          <span className="s-row-main">
            <small>{STATUS[t.status]?.text}</small>
            {t.title}
            <em>{t.status === "accepted" && t.etaAt ? `${kstClock(t.etaAt)} 도착 예정, 진행은 차 화면에서 해요` : "진행은 차 화면에서 해요"}</em>
          </span>
          <Icon name="chevron" />
        </button>
      ))}

      <div className="s-band" />
      <section className="s-section">
        <div className="s-section-head">
          <h2>최근 거래</h2>
          {trades.length > 3 && (
            <button className="s-link-btn" onClick={onTrades}>
              모두 보기
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="s-empty">
            <b>아직 거래가 없어요</b>
            차로 가는 길에 관심 물건이 있으면 차 화면에서 알려 드려요.
          </div>
        ) : (
          recent.map((t) => <TradeRow key={t.id} t={t} onOpen={() => onTrade(t.id)} />)
        )}
        {trust && (trust.completed > 0 || trust.canceled > 0 || trust.noShow > 0) && (
          <p className="b-trust s-num">
            거래 {trust.completed}회, 수락 뒤 취소 {trust.canceled}회, 노쇼 {trust.noShow}회. 판매자에게는 이 기록이 보여요.
          </p>
        )}
      </section>
    </>
  );
}

function TradeRow({ t, onOpen }: { t: BuyerTrade; onOpen: () => void }) {
  const st = STATUS[t.status] ?? { text: t.status, tone: "" as const };
  return (
    <button className="b-trade" onClick={onOpen} data-testid={`b-trade-${t.category}`}>
      {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <span className="s-thumb" />}
      <span className="s-row-main">
        <span className="b-trade-title">{t.title}</span>
        <span className="b-trade-meta">
          <span className={`s-badge ${st.tone}`}>{st.text}</span>
          <span>{dateText(t.createdAt)}</span>
        </span>
      </span>
      <span className="b-trade-price s-num">{won(t.price)}</span>
    </button>
  );
}

/* ─────────── 관심 물건 ─────────── */

function Interests({
  interests,
  settings,
  catalog,
  client,
  run,
  onOpen,
}: {
  interests: InterestView[];
  settings: GoSetting | null;
  catalog: Catalog | null;
  client: ApiClient;
  run: Run;
  onOpen: (id: string) => void;
}) {
  const [kw, setKw] = useState("");
  const have = new Set(interests.map((i) => i.keyword));
  const suggest = (catalog?.categories ?? []).map((c) => c.label).filter((l) => !have.has(l)).slice(0, 8);
  const add = (k: string) => void run(() => client.call("POST", "/v1/buyer/interests", { type: "keyword", keyword: k, goLevel: "likely" }), `${josa(k, "을/를")} 웬만하면 GO로 더했어요`);
  const step = (g: GoLevel) => (g === "near" ? 1 : 5);
  return (
    <>
      <section className="s-hero">
        <h1>관심 물건</h1>
        <p className="s-hero-sub">가는 길에 이 물건이 있으면 차에서 알려 드려요</p>
      </section>
      <section className="s-section" style={{ paddingTop: 0 }}>
        {interests.length === 0 && <div className="s-empty">아직 없어요. 아래에서 찾는 물건을 더해 보세요.</div>}
        {interests.map((it) => (
          <button className="b-interest" key={it.id} onClick={() => onOpen(it.id)} data-testid={`interest-${it.keyword ?? it.listingId}`}>
            <span className={`b-level ${it.goLevel}`} aria-hidden="true" />
            <span className="s-row-main">
              {it.type === "keyword" ? it.keyword : it.title ?? "찜한 매물"}
              <small>{it.type === "wish" ? (it.listingStatus && it.listingStatus !== "active" ? "찜, 지금은 판매 중이 아니에요" : "찜한 매물") : GO[it.goLevel].hint}</small>
            </span>
            <span className={`b-level-chip ${it.goLevel}`}>{GO[it.goLevel].label}</span>
            <Icon name="chevron" />
          </button>
        ))}
        <form
          className="s-inline-form"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const k = kw.trim();
            if (!k) return;
            setKw("");
            add(k);
          }}
        >
          <input className="s-input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="찾는 물건 (예: 캠핑 테이블)" aria-label="찾는 물건" data-testid="interest-input" />
          <button className="s-btn primary" disabled={!kw.trim()}>
            더하기
          </button>
        </form>
        {suggest.length > 0 && (
          <div className="s-chips" style={{ marginTop: 12 }}>
            {suggest.map((l) => (
              <button key={l} className="add" onClick={() => add(l)}>
                + {l}
              </button>
            ))}
          </div>
        )}
      </section>
      {settings && (
        <>
          <div className="s-band" style={{ marginTop: 14 }} />
          <section className="s-section">
            <div className="s-section-head">
              <h2>얼마나 돌아가도 될까요?</h2>
            </div>
            <p className="s-section-note">등급마다 이 시간보다 더 돌아가야 하면 알리지 않아요.</p>
            {LEVELS.map((g) => (
              <div className="b-setting" key={g}>
                <span className={`b-level ${g}`} aria-hidden="true" />
                <span className="s-row-main">
                  {GO[g].label}
                  <small>{GO[g].hint}</small>
                </span>
                <div className="b-mini-stepper" role="group" aria-label={`${GO[g].label} 최대 우회 시간`}>
                  <button onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { maxDetourMin: { ...settings.maxDetourMin, [g]: Math.max(1, settings.maxDetourMin[g] - step(g)) } }))} aria-label="줄이기">
                    <Icon name="minus" size={18} />
                  </button>
                  <b className="s-num">{settings.maxDetourMin[g]}분</b>
                  <button onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { maxDetourMin: { ...settings.maxDetourMin, [g]: settings.maxDetourMin[g] + step(g) } }))} aria-label="늘리기">
                    <Icon name="plus" size={18} />
                  </button>
                </div>
              </div>
            ))}
            <div className="b-setting">
              <span className="b-level battery" aria-hidden="true" />
              <span className="s-row-main">
                도착 배터리
                <small>들렀다 가도 이만큼은 남게</small>
              </span>
              <div className="b-mini-stepper" role="group" aria-label="도착 배터리 최소">
                <button onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { minArrivalSocPct: settings.minArrivalSocPct - 5 }))} aria-label="줄이기">
                  <Icon name="minus" size={18} />
                </button>
                <b className="s-num">{settings.minArrivalSocPct}%</b>
                <button onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { minArrivalSocPct: settings.minArrivalSocPct + 5 }))} aria-label="늘리기">
                  <Icon name="plus" size={18} />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function InterestSheet({ it, client, run, onClose }: { it: InterestView; client: ApiClient; run: Run; onClose: () => void }) {
  const name = it.type === "keyword" ? it.keyword! : it.title ?? "찜한 매물";
  const setLevel = (g: GoLevel) => void run(() => client.call("POST", "/v1/buyer/interests", it.type === "keyword" ? { type: "keyword", keyword: it.keyword, goLevel: g } : { type: "wish", listingId: it.listingId, goLevel: g }));
  return (
    <Sheet title={name} onClose={onClose} testid="interest-sheet">
      <p className="s-section-note">얼마나 사고 싶은지에 따라 돌아가도 되는 시간이 달라요.</p>
      <div className="s-rows">
        {LEVELS.map((g) => (
          <button key={g} className={`s-row-btn ${it.goLevel === g ? "on" : ""}`} onClick={() => setLevel(g)} role="radio" aria-checked={it.goLevel === g}>
            <span className={`b-level ${g}`} aria-hidden="true" />
            <span className="s-row-main">
              {GO[g].label}
              <small>{GO[g].hint}</small>
            </span>
            {it.goLevel === g ? <Icon name="check" stroke={2.4} /> : <span />}
          </button>
        ))}
      </div>
      <button
        className="s-btn danger lg block"
        style={{ marginTop: 18 }}
        onClick={async () => {
          if (await run(() => client.call("DELETE", `/v1/buyer/interests/${it.id}`), `${name} 알림을 껐어요`)) onClose();
        }}
      >
        <Icon name="trash" size={18} /> 관심 물건에서 빼기
      </button>
    </Sheet>
  );
}

/* ─────────── 거래 내역 ─────────── */

function Trades({ trades, onOpen }: { trades: BuyerTrade[]; onOpen: (id: string) => void }) {
  return (
    <>
      <section className="s-hero">
        <h1>거래 내역</h1>
        <p className="s-hero-sub">대금이 지금 어디 있는지, 거래마다 볼 수 있어요</p>
      </section>
      <section className="s-section" style={{ paddingTop: 0 }}>
        {trades.length === 0 && (
          <div className="s-empty">
            <b>아직 거래가 없어요</b>
            차에서 들를게요를 고르면 여기에 남아요.
          </div>
        )}
        {trades.map((t) => (
          <TradeRow key={t.id} t={t} onOpen={() => onOpen(t.id)} />
        ))}
      </section>
    </>
  );
}

function TradeSheet({ t, client, run, onClose }: { t: BuyerTrade; client: ApiClient; run: Run; onClose: () => void }) {
  const st = STATUS[t.status] ?? { text: t.status, tone: "" as const };
  const refunded = t.payment.status === "refunded";
  const steps: { label: string; at?: number; state: "done" | "now" | "todo" | "bad" }[] = [
    { label: "들를게요 요청", at: t.createdAt, state: "done" },
    { label: "판매자 수락, 대금 보관", at: t.acceptedAt, state: t.acceptedAt ? "done" : t.status === "requested" ? "now" : "todo" },
    { label: "도착", at: t.arrivedAt, state: t.arrivedAt ? "done" : t.status === "accepted" ? "now" : "todo" },
    { label: t.autoConfirmed ? "받았어요(자동 확인)" : "받았어요", at: t.receivedAt, state: t.receivedAt ? "done" : t.status === "arrived" ? "now" : "todo" },
    { label: "판매자에게 정산", at: t.settledAt, state: t.settledAt ? "done" : t.status === "completed" ? "now" : "todo" },
  ];
  const endAt = t.sellerAbsentAt ?? t.noShowAt ?? t.canceledAt ?? t.mismatch?.at ?? t.declinedAt;
  const ended = ["declined", "expired", "canceled", "declined_mismatch", "no_show", "seller_no_show"].includes(t.status);
  const shown = ended ? [...steps.filter((s) => s.state === "done"), { label: st.text, at: endAt ?? t.payment.refundedAt, state: "bad" as const }] : steps;
  const money = refunded
    ? `${won(t.price)}은 전액 환불됐어요`
    : t.payment.status === "held"
      ? `${won(t.price)}은 결제 대행사에 보관 중이에요${t.status === "completed" && t.settleAt ? `. ${kstClock(t.settleAt)}에 판매자에게 정산돼요` : ""}`
      : t.payment.status === "captured"
        ? `${won(t.price)}이 판매자에게 정산됐어요`
        : "아직 결제되지 않았어요. 판매자가 수락하면 보관돼요";
  const have = t.mismatch?.photos ?? [];
  return (
    <Sheet title={t.title} onClose={onClose} testid="trade-sheet">
      <div className="s-sheet-item">
        {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <span className="s-thumb" />}
        <span>
          <span className={`s-badge ${st.tone}`}>{st.text}</span>
          <br />
          판매자 {t.seller?.name ?? ""}
          {t.seller?.rating ? `, 평점 ${t.seller.rating}` : ""}
        </span>
      </div>
      <div className={`b-money ${refunded ? "refund" : ""}`}>
        <Icon name={refunded ? "banknote" : "shield"} size={20} />
        <p>{money}</p>
      </div>
      <ol className="b-timeline">
        {shown.map((s, i) => (
          <li key={i} className={s.state}>
            <i aria-hidden="true" />
            <span>{s.label}</span>
            <time className="s-num">{s.at ? kstClock(s.at) : ""}</time>
          </li>
        ))}
      </ol>
      {t.mismatch && <p className="s-help">현장 거절 사유: {t.mismatch.reason}</p>}
      {["completed", "settled"].includes(t.status) &&
        (t.ratings.buyerToSeller ? (
          <p className="s-help">판매자에게 {t.ratings.buyerToSeller}점을 남겼어요.</p>
        ) : (
          <div className="s-rate">
            <span>판매자 {t.seller?.name}님은 어땠나요?</span>
            <Stars label="판매자 평가" onRate={(n) => void run(() => client.call("POST", `/v1/buyer/trades/${t.id}/rate`, { stars: n }), "평가를 남겼어요")} />
          </div>
        ))}
      {t.status === "declined_mismatch" && (
        <div className="b-evidence">
          <div className="s-label">현장 사진</div>
          <p className="s-section-note">무엇이 달랐는지 사진으로 남기면 판매자 지난 거래에도 보여요. 3장까지.</p>
          <div className="s-photos" style={{ marginTop: 0 }}>
            {have.map((p, i) => (
              <div className="s-photo" key={i}>
                <img src={p} alt={`현장 사진 ${i + 1}`} />
              </div>
            ))}
            {have.length < 3 && (
              <label className="s-photo-add">
                <Icon name="camera" size={22} />
                <span className="s-num">사진 {have.length}/3</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  data-testid="evidence-input"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []).slice(0, 3 - have.length);
                    if (!files.length) return;
                    const photos = await Promise.all(files.map(shrinkImage));
                    await run(() => client.call("POST", `/v1/buyer/trades/${t.id}/evidence`, { photos }), "사진을 남겼어요. 판매자에게도 보여요");
                  }}
                />
              </label>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ─────────── 결제 수단·차종 ─────────── */

function PaySheet({ me, hasActive, client, run, onClose }: { me: Me; hasActive: boolean; client: ApiClient; run: Run; onClose: () => void }) {
  const pm = me.paymentMethod;
  return (
    <Sheet title="결제 수단" onClose={onClose} testid="pay-sheet">
      <div className={`b-paycard ${pm ? "on" : ""}`}>
        <Icon name="card" size={22} />
        <span className="s-row-main">
          {pm ? pm.label : "등록된 결제 수단이 없어요"}
          <small>{pm ? `${dateText(pm.addedAt)} 등록` : "없으면 차에서 판매자에게 요청할 수 없어요"}</small>
        </span>
      </div>
      <ol className="s-next">
        <li>
          <Icon name="shield" />
          <span>판매자가 수락하는 순간 대금이 결제 대행사(PG)에 보관돼요. 운전 중에 결제할 일은 없어요.</span>
        </li>
        <li>
          <Icon name="banknote" />
          <span>받았어요 뒤 이의 제기 기간이 지나면 판매자에게 정산돼요. 현장에서 다르거나 판매자를 못 만나면 전액 환불돼요.</span>
        </li>
        <li>
          <Icon name="info" />
          <span>실서비스는 결제 대행사 결제창에서 카드를 등록해요. 주행중GO!는 카드 번호를 받지 않아요. 이 시연에는 테스트 수단만 있어요.</span>
        </li>
      </ol>
      <div style={{ marginTop: 22 }}>
        {pm ? (
          <button className="s-btn lg block" disabled={hasActive} onClick={() => void run(() => client.call("DELETE", "/v1/buyer/payment-method"), "결제 수단을 지웠어요")}>
            {hasActive ? "진행 중인 거래가 끝나면 지울 수 있어요" : "결제 수단 지우기"}
          </button>
        ) : (
          <button className="s-btn primary lg block" onClick={() => void run(() => client.call("PUT", "/v1/buyer/payment-method", { kind: "test" }), "등록했어요. 이제 차에서 요청할 수 있어요")} data-testid="pay-register">
            테스트 결제 수단 등록
          </button>
        )}
      </div>
    </Sheet>
  );
}

function CarSheet({ me, catalog, client, run, onClose }: { me: Me; catalog: Catalog | null; client: ApiClient; run: Run; onClose: () => void }) {
  return (
    <Sheet title="어떤 차를 타세요?" onClose={onClose} testid="car-sheet">
      <p className="s-section-note">차가 모델명을 알려 주지 않아서 한 번만 골라 주세요. 트렁크 크기로 실을 수 있는지 판단해요.</p>
      <div className="s-rows">
        {(catalog?.vehicles ?? []).map((v) => (
          <button
            key={v.model}
            className={`s-row-btn ${me.vehicle?.model === v.model ? "on" : ""}`}
            onClick={async () => {
              if (await run(() => client.call("PUT", "/v1/buyer/vehicle", { model: v.model }), `${josa(v.model, "으로/로")} 바꿨어요`)) onClose();
            }}
          >
            <Icon name="car" />
            <span className="s-row-main">
              {v.model}
              <small>
                {v.powertrain === "ev" ? "전기차" : v.powertrain === "hybrid" ? "하이브리드" : "내연기관"}, {v.seatRows}열
              </small>
            </span>
            {me.vehicle?.model === v.model ? <Icon name="check" stroke={2.4} /> : <span />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
