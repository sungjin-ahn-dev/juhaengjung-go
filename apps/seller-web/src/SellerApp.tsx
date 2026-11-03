/**
 * 판매자 앱 — 설치 없이 쓰는 모바일 웹.
 * 평소에는 조용하다: 지금 요청을 받는지 한 줄, 내 물건, 같이 올리기.
 * 차가 들르겠다고 할 때(요청)와 차가 거의 왔을 때(만남)만 화면 전체로 알린다.
 */
import { useCallback, useEffect, useState } from "react";
import type { Listing } from "@jhgo/core";
import type { ApiClient, AppClock, AppEvent } from "@jhgo/api";
import { currentPush, disablePush, enablePush, type PushState } from "./push.ts";
import { Compose, Posted } from "./Compose.tsx";
import { Hero, ListingRow, ListingSheet, LiveLine, PauseSheet, PushCard, receivingOf, untilText } from "./Home.tsx";
import { DemoLogin, Icon, Mark, beep, buzz, useNow, useToast } from "./kit.tsx";
import { Handoff, Takeover, handoffStage } from "./Moments.tsx";
import { LiveTrade, Money, PastTrades } from "./Trades.tsx";
import { errText, type Catalog, type Me, type SellerListing, type SellerTrade, type Summary } from "./types.ts";
import "./styles.css";

type View = { kind: "main" } | { kind: "compose" } | { kind: "posted"; listing: Listing };

export function SellerApp({ client, clock, embedded = false, storageKey = "jhgo.seller.token" }: { client: ApiClient; clock: AppClock; embedded?: boolean; storageKey?: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<"items" | "trades" | "money">("items");
  const [view, setView] = useState<View>({ kind: "main" });
  const [listings, setListings] = useState<SellerListing[]>([]);
  const [trades, setTrades] = useState<SellerTrade[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [push, setPush] = useState<PushState>({ kind: "off" });
  const [pauseOpen, setPauseOpen] = useState(false);
  const [openListing, setOpenListing] = useState<string | null>(null);
  const [minimized, setMinimized] = useState<Set<string>>(() => new Set());
  const now = useNow(clock);
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
    try {
      const [m, l, t, s] = await Promise.all([
        client.call<{ user: Me }>("GET", "/v1/me"),
        client.call<{ listings: SellerListing[] }>("GET", "/v1/seller/listings"),
        client.call<{ trades: SellerTrade[] }>("GET", "/v1/seller/trades"),
        client.call<Summary>("GET", "/v1/seller/summary"),
      ]);
      setMe(m.user);
      setListings(l.listings);
      setTrades(t.trades);
      setSummary(s);
    } catch (e) {
      if ((e as { status?: number }).status === 401) signOut();
    }
  }, [client, signOut]);

  // 로그인 확인
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
          if (r.user.role === "seller") setMe(r.user);
          else client.setToken(null);
        } catch {
          client.setToken(null);
        }
      }
      setCatalog(await client.call<Catalog>("GET", "/v1/catalog"));
      setChecked(true);
    })();
  }, [client, clock, storageKey]);

  useEffect(() => {
    const sync = setInterval(() => void clock.sync(), 5000);
    return () => clearInterval(sync);
  }, [clock]);

  // 실시간 알림 — 차가 가까워지면 만남 화면을 다시 연다
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    void refresh();
    const reopen = (id?: string) =>
      id &&
      setMinimized((m) => {
        const n = new Set(m);
        n.delete(id);
        return n;
      });
    const off = client.subscribe((e: AppEvent) => {
      void refresh();
      if (e.type === "request.new") {
        beep();
        buzz([300, 120, 300, 120, 300]);
      } else if (e.type === "trade.come_out" || e.type === "trade.waiting") {
        beep();
        buzz([500, 150, 500]);
        reopen(e.tradeId);
      } else if (e.type === "trade.arrived") {
        buzz([200, 100, 200]);
        reopen(e.tradeId);
      } else if (["trade.received", "trade.settled", "trade.mismatch", "trade.canceled", "trade.no_show", "trade.seller_no_show", "trade.evidence", "trade.expired"].includes(e.type)) {
        say(e.title);
      }
    });
    const poll = setInterval(() => void refresh(), 15000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [meId, client, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // 웹 푸시: 권한이 이미 있으면 로그인한 계정으로 다시 등록해 둔다(시연 체험 페이지 안에서는 쓰지 않음)
  useEffect(() => {
    if (!meId || embedded || !catalog) return;
    void currentPush(client, !!catalog.push).then(setPush).catch(() => setPush({ kind: "off" }));
  }, [meId, embedded, catalog, client]);
  const togglePush = async () => {
    const was = push;
    setPush({ kind: "busy" });
    try {
      const next = was.kind === "on" ? await disablePush(client) : await enablePush(client);
      setPush(next);
      if (next.kind === "on") say("알림을 켰어요. 페이지를 닫아도 차가 오면 알려 드려요");
    } catch (e) {
      setPush(was);
      say({ text: errText(e), tone: "warn" });
    }
  };

  const login = async (body: { userId?: string; role?: string; name?: string }) => {
    const r = await client.call<{ token: string; user: Me }>("POST", "/v1/session", body);
    client.setToken(r.token);
    try {
      localStorage.setItem(storageKey, r.token);
    } catch {
      /* 저장 못 해도 계속 */
    }
    setMe(r.user);
  };

  const DONE: Record<string, string> = {
    accept: "수락했어요. 대금이 보관됐어요",
    decline: "이번엔 거절했어요",
    cancel: "거래를 취소했어요",
    rate: "평가를 남겼어요",
  };
  const act = async (tradeId: string, action: string, body?: unknown): Promise<boolean> => {
    try {
      await client.call("POST", `/v1/seller/trades/${tradeId}/${action}`, body ?? {});
      await refresh();
      if (DONE[action]) say(DONE[action]);
      return true;
    } catch (e) {
      say({ text: errText(e), tone: "warn" });
      await refresh();
      return false;
    }
  };

  const setPause = async (f: "1h" | "today" | "manual" | "off", quiet = false) => {
    try {
      const r = await client.call<{ pause: { until: number | null } | null }>("PUT", "/v1/seller/pause", { for: f });
      setPauseOpen(false);
      await refresh();
      if (quiet) return;
      if (!r.pause) say("다시 요청을 받아요");
      else say({ text: r.pause.until ? `쉬어요. ${untilText(r.pause.until, clock.now())} 지나가는 차에 보이지 않아요` : "쉬어요. 다시 받기를 누르면 돌아와요", action: { label: "되돌리기", run: () => void setPause("off", true) } });
    } catch (e) {
      say({ text: errText(e), tone: "warn" });
    }
  };

  const patchListing = async (id: string, body: Record<string, unknown>, undo?: Record<string, unknown>, done?: string) => {
    try {
      await client.call("PATCH", `/v1/seller/listings/${id}`, body);
      await refresh();
      if (body.status && body.status !== "active") setOpenListing(null);
      if (done)
        say({
          text: done,
          action: undo
            ? {
                label: "되돌리기",
                run: () =>
                  void client
                    .call("PATCH", `/v1/seller/listings/${id}`, undo)
                    .then(refresh)
                    .catch((e) => say({ text: errText(e), tone: "warn" })),
              }
            : undefined,
        });
    } catch (e) {
      say({ text: errText(e), tone: "warn" });
    }
  };

  if (!checked) return <div className={`s-root ${embedded ? "embedded" : ""}`} />;
  if (!me)
    return (
      <DemoLogin
        client={client}
        role="seller"
        intro={
          <>
            큰 물건, "차 있으세요?"부터
            <br />
            묻지 않아도 돼요
          </>
        }
        sub="이 물건이 실리는 차만, 집 앞까지 와요."
        onLogin={login}
        allowNew
        embedded={embedded}
        testPrefix="login-"
      />
    );

  const pending = trades.find((t) => t.status === "requested" && t.expiresAt > now);
  const active = trades.filter((t) => ["accepted", "arrived", "completed"].includes(t.status));
  const live = active.filter((t) => ["accepted", "arrived"].includes(t.status));
  const past = trades.filter((t) => !active.includes(t) && t.status !== "requested");
  const handoff = live.find((t) => handoffStage(t) && !minimized.has(t.id));
  const receiving = receivingOf(me, listings, now);
  const listingOpen = listings.find((l) => l.id === openListing) ?? null;
  const pushCard = !embedded && <PushCard state={push} onToggle={() => void togglePush()} />;
  const minimize = (id: string) => setMinimized((m) => new Set(m).add(id));
  const openHandoff = (id: string) =>
    setMinimized((m) => {
      const n = new Set(m);
      n.delete(id);
      return n;
    });

  return (
    <div className={`s-root ${embedded ? "embedded" : ""}`} data-testid="seller-app">
      <div className="s-phone">
        {view.kind === "compose" ? (
          <Compose
            client={client}
            catalog={catalog}
            me={me}
            onClose={() => setView({ kind: "main" })}
            onPosted={(l) => {
              void refresh();
              setView({ kind: "posted", listing: l });
            }}
          />
        ) : view.kind === "posted" ? (
          <Posted
            listing={view.listing}
            pushOn={push.kind === "on"}
            canPush={!embedded && !!catalog?.push && push.kind === "off"}
            onPush={() => void togglePush()}
            onDone={() => {
              setTab("items");
              setView({ kind: "main" });
            }}
          />
        ) : (
          <>
            <header className="s-appbar">
              <Mark role="판매자" />
              <span className="s-role">판매자</span>
            </header>
            <main className="s-main">
              {tab === "items" && (
                <>
                  <Hero me={me} r={receiving} summary={summary} onPause={() => setPauseOpen(true)} onResume={() => void setPause("off")} />
                  {active.map((x) => (
                    <LiveLine
                      key={x.id}
                      t={x}
                      now={now}
                      onOpen={() => {
                        if (handoffStage(x)) openHandoff(x.id);
                        else setTab("trades");
                      }}
                    />
                  ))}
                  {pushCard}
                  <div className="s-band" />
                  <section className="s-section">
                    <div className="s-section-head">
                      <h2>
                        내 물건<span>{listings.length}</span>
                      </h2>
                    </div>
                    {listings.length === 0 ? (
                      <div className="s-empty">
                        <b>아직 올린 물건이 없어요</b>
                        다른 앱에 올린 글이 있다면 그대로 붙여 넣으면 돼요.
                      </div>
                    ) : (
                      <div className="s-list">
                        {listings.map((l) => (
                          <ListingRow key={l.id} l={l} onOpen={() => setOpenListing(l.id)} />
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
              {tab === "trades" && (
                <>
                  <section className="s-hero">
                    <h1>거래</h1>
                    <p className="s-hero-sub">{live.length ? "지금 오고 있는 차가 있어요" : "진행 중인 거래가 없어요. 차가 들르겠다고 하면 화면 전체로 알려 드려요."}</p>
                  </section>
                  {pushCard}
                  {active.map((x) => (
                    <LiveTrade key={x.id} t={x} now={now} act={act} cfg={catalog?.tradeConfig} onOpenHandoff={() => openHandoff(x.id)} />
                  ))}
                  <div className="s-band" />
                  <PastTrades trades={past} act={act} />
                </>
              )}
              {tab === "money" && (
                <>
                  <section className="s-hero" style={{ paddingBottom: 8 }}>
                    <h1>정산</h1>
                  </section>
                  <Money summary={summary} />
                </>
              )}
            </main>
            {tab === "items" && (
              <div className="s-fab-wrap">
                <button className="s-fab" onClick={() => setView({ kind: "compose" })} data-testid="compose">
                  <Icon name="plus" size={20} stroke={2.6} />
                  같이 올리기
                </button>
              </div>
            )}
            <nav className="s-tabbar" aria-label="판매자 메뉴">
              <button className={tab === "items" ? "on" : ""} onClick={() => (setTab("items"), void refresh())} aria-current={tab === "items" ? "page" : undefined} data-testid="tab-items">
                <Icon name="package" size={24} stroke={tab === "items" ? 2.1 : 1.8} />
                내 물건
              </button>
              <button className={tab === "trades" ? "on" : ""} onClick={() => (setTab("trades"), void refresh())} aria-current={tab === "trades" ? "page" : undefined} data-testid="tab-trades">
                <Icon name="handshake" size={24} stroke={tab === "trades" ? 2.1 : 1.8} />
                거래
                {live.length > 0 && <span className="s-tab-dot" aria-label="진행 중" />}
              </button>
              <button className={tab === "money" ? "on" : ""} onClick={() => (setTab("money"), void refresh())} aria-current={tab === "money" ? "page" : undefined} data-testid="tab-money">
                <Icon name="wallet" size={24} stroke={tab === "money" ? 2.1 : 1.8} />
                정산
              </button>
            </nav>
          </>
        )}
      </div>
      {pending && <Takeover t={pending} now={now} act={act} onPauseToday={() => setPause("today", true).then(() => say("오늘은 그만 받아요. 내일 다시 보여요"))} />}
      {!pending && handoff && <Handoff t={handoff} now={now} act={act} cfg={catalog?.tradeConfig} onMinimize={() => minimize(handoff.id)} />}
      {pauseOpen && <PauseSheet now={now} onClose={() => setPauseOpen(false)} onPick={(f) => void setPause(f)} />}
      {listingOpen && <ListingSheet l={listingOpen} onClose={() => setOpenListing(null)} patch={patchListing} />}
      {toast.view}
    </div>
  );
}
