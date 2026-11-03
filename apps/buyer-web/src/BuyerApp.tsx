/**
 * 구매자 폰 — 차 밖에서 하는 일: 결제 수단, 거래 내역·판매자 평가, 현장 사진, 관심사(T21·T23·T12, 기획서 12장 '구매자 모바일 웹').
 * 거래 진행(요청·경유지·현장 확인)은 차 화면에서 한다. 여기서는 보기만 한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { kstClock, kstParts, type GoLevel, type GoSetting } from "@jhgo/core";
import type { ApiClient, AppClock, AppEvent } from "@jhgo/api";
import "../../seller-web/src/styles.css";
import "./buyer.css";

interface Me {
  id: string;
  name: string;
  role: string;
  settings?: GoSetting;
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
  photos: string[];
  ratings: { buyerToSeller?: number; sellerToBuyer?: number };
  mismatch?: { reason: string; photos?: string[] };
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

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const GO_KO: Record<GoLevel, string> = { must: "무조건 GO", likely: "웬만하면 GO", near: "가까우면 GO" };
const STATUS_KO: Record<string, string> = {
  requested: "판매자 응답 대기",
  accepted: "오는 중",
  arrived: "도착",
  completed: "받음 · 정산 대기",
  settled: "거래 완료",
  declined: "판매자가 거절",
  expired: "응답 시간 지남",
  canceled: "취소",
  declined_mismatch: "현장에서 거절 · 환불",
  no_show: "도착하지 못함 · 환불",
  seller_no_show: "판매자를 만나지 못함 · 환불",
};
const ACTIVE = ["requested", "accepted", "arrived"];
const dayText = (ms: number) => {
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

export function BuyerApp({ client, clock, embedded = false, storageKey = "jhgo.buyer.token" }: { client: ApiClient; clock: AppClock; embedded?: boolean; storageKey?: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<"trades" | "interests" | "pay">("trades");
  const [trades, setTrades] = useState<BuyerTrade[]>([]);
  const [interests, setInterests] = useState<InterestView[]>([]);
  const [trust, setTrust] = useState<{ completed: number; noShow: number; canceled: number } | null>(null);
  const [block, setBlock] = useState<Block | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((t: string) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

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
      setChecked(true);
    })();
  }, [client, clock, storageKey]);

  useEffect(() => {
    if (!me) return;
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
  }, [me?.id, client, safeRefresh, say]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (userId: string) => {
    const r = await client.call<{ token: string; user: Me }>("POST", "/v1/session", { userId });
    client.setToken(r.token);
    try {
      localStorage.setItem(storageKey, r.token);
    } catch {
      /* 저장 못 해도 계속 */
    }
    setMe(r.user);
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await refresh();
      if (ok) say(ok);
    } catch (e) {
      say((e as Error).message);
    }
  };

  if (!checked) return <div className={`s-root ${embedded ? "embedded" : ""}`} />;
  if (!me) return <Login client={client} onLogin={login} embedded={embedded} />;

  return (
    <div className={`s-root b-root ${embedded ? "embedded" : ""}`} data-testid="buyer-app">
      <div className="s-phone">
        <header className="s-top">
          <div>
            <div className="s-brand">주행중GO! 구매자</div>
            <h1>{me.name}님</h1>
          </div>
          <div className="s-trust">
            {trust ? (
              <>
                거래 {trust.completed}회
                <br />
                취소 {trust.canceled}회, 노쇼 {trust.noShow}회
              </>
            ) : null}
          </div>
        </header>
        <main className="s-main">
          {block && (
            <div className="s-warn" data-testid="buyer-block">
              {block.text}
            </div>
          )}
          {tab === "trades" ? (
            <Trades trades={trades} client={client} run={run} />
          ) : tab === "interests" ? (
            <Interests interests={interests} settings={me.settings ?? null} client={client} run={run} />
          ) : (
            <Pay me={me} client={client} run={run} hasActive={trades.some((t) => ACTIVE.includes(t.status))} />
          )}
        </main>
        <nav className="s-tabs" aria-label="구매자 메뉴">
          <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")} data-testid="btab-trades">
            거래
          </button>
          <button className={tab === "interests" ? "on" : ""} onClick={() => setTab("interests")} data-testid="btab-interests">
            관심사
          </button>
          <button className={tab === "pay" ? "on" : ""} onClick={() => setTab("pay")} data-testid="btab-pay">
            결제
            {!me.paymentMethod && <span className="s-dot" />}
          </button>
        </nav>
      </div>
      {toast && (
        <div className="s-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({ client, onLogin, embedded }: { client: ApiClient; onLogin: (id: string) => Promise<void>; embedded: boolean }) {
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  useEffect(() => {
    client
      .call<{ users: { id: string; name: string; role: string }[] }>("GET", "/v1/demo/users")
      .then((r) => setUsers(r.users.filter((u) => u.role === "buyer")))
      .catch(() => setUsers([]));
  }, [client]);
  return (
    <div className={`s-root ${embedded ? "embedded" : ""}`}>
      <div className="s-phone s-login">
        <h1>주행중GO!</h1>
        <p>차에서 쓰는 구매자 계정의 폰 화면이에요. 결제 수단, 거래 내역과 평가, 현장 사진을 여기서 다뤄요.</p>
        <div className="s-h2">시연용 구매자로 시작</div>
        <div className="s-list">
          {users.map((u) => (
            <div className="s-item" key={u.id} style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
              <div className="s-item-title">{u.name}</div>
              <button className="s-btn primary small" onClick={() => void onLogin(u.id)} data-testid={`blogin-${u.name}`}>
                이 계정으로
              </button>
            </div>
          ))}
          {users.length === 0 && <div className="s-empty">시연 계정을 불러오지 못했어요</div>}
        </div>
      </div>
    </div>
  );
}

function Trades({ trades, client, run }: { trades: BuyerTrade[]; client: ApiClient; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const active = trades.filter((t) => ACTIVE.includes(t.status));
  const past = trades.filter((t) => !ACTIVE.includes(t.status));
  return (
    <>
      {active.map((t) => (
        <div className="s-trade live" key={t.id} data-testid="b-active">
          <div className="s-trade-head">
            <div className="s-trade-title">{t.title}</div>
            <span className="s-chip reserved">{STATUS_KO[t.status]}</span>
          </div>
          <p className="s-help" style={{ margin: "6px 0 0" }}>
            진행은 차 화면에서 해요. {t.etaAt && t.status === "accepted" ? `${kstClock(t.etaAt)} 도착 예정` : ""}
          </p>
        </div>
      ))}
      <div className="s-h2">지난 거래</div>
      <div className="s-list">
        {past.length === 0 && <div className="s-empty">아직 없어요. 차로 가는 길에 관심 매물이 있으면 차 화면에서 알려 드려요.</div>}
        {past.map((t) => (
          <div className="s-item" key={t.id} style={{ gridTemplateColumns: "64px 1fr" }} data-testid={`b-trade-${t.category}`}>
            {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <div className="s-thumb" />}
            <div>
              <div className="s-item-title">{t.title}</div>
              <div className="s-item-meta">
                {STATUS_KO[t.status] ?? t.status}, {won(t.price)}
                <br />
                {dayText(t.createdAt)}
                {t.seller ? `, 판매자 ${t.seller.name}` : ""}
                {t.mismatch ? ` — ${t.mismatch.reason}` : ""}
              </div>
              {["completed", "settled"].includes(t.status) &&
                (t.ratings.buyerToSeller ? (
                  <div className="s-item-meta">판매자 평가 {t.ratings.buyerToSeller}점</div>
                ) : (
                  <div className="s-stars" aria-label="판매자 평가">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => void run(() => client.call("POST", `/v1/buyer/trades/${t.id}/rate`, { stars: n }), "평가를 남겼어요")} aria-label={`${n}점`}>
                        ★
                      </button>
                    ))}
                  </div>
                ))}
              {t.status === "declined_mismatch" && <Evidence t={t} client={client} run={run} />}
              {t.status === "seller_no_show" && <div className="s-item-meta">판매자를 만나지 못해 대금은 전액 환불됐어요.</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** 현장 거절 뒤 사진 남기기 — 판매자 지난 거래에 보인다 */
function Evidence({ t, client, run }: { t: BuyerTrade; client: ApiClient; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const have = t.mismatch?.photos ?? [];
  return (
    <div className="b-evidence">
      {have.length > 0 && (
        <div className="s-evidence" aria-label="남긴 사진">
          {have.map((p, i) => (
            <img key={i} src={p} alt={`현장 사진 ${i + 1}`} />
          ))}
        </div>
      )}
      {have.length < 3 && (
        <label className="s-btn small" style={{ fontWeight: 400, marginTop: 6 }}>
          현장 사진 남기기 ({have.length}/3)
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
  );
}

function Interests({
  interests,
  settings,
  client,
  run,
}: {
  interests: InterestView[];
  settings: GoSetting | null;
  client: ApiClient;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const [kw, setKw] = useState("");
  const [lvl, setLvl] = useState<GoLevel>("likely");
  const setLevel = (it: InterestView, g: GoLevel) =>
    run(() => client.call("POST", "/v1/buyer/interests", it.type === "keyword" ? { type: "keyword", keyword: it.keyword, goLevel: g } : { type: "wish", listingId: it.listingId, goLevel: g }));
  return (
    <>
      <p className="s-help">차 화면의 관심사와 같아요. 가는 길에 이 물건이 있으면 알려 드려요.</p>
      <div className="s-list">
        {interests.length === 0 && <div className="s-empty">아직 없어요. 키워드를 더해 보세요.</div>}
        {interests.map((it) => (
          <div className="s-item" key={it.id} style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <div className="s-item-title">{it.type === "keyword" ? it.keyword : it.title ?? "찜한 매물"}</div>
              <div className="s-item-meta">{it.type === "keyword" ? "키워드" : it.listingStatus && it.listingStatus !== "active" ? "찜, 지금은 판매 중이 아니에요" : "찜"}</div>
              <div className="s-seg" style={{ marginTop: 8 }} role="radiogroup" aria-label="GO 등급">
                {(["must", "likely", "near"] as GoLevel[]).map((g) => (
                  <button key={g} className={it.goLevel === g ? "on" : ""} role="radio" aria-checked={it.goLevel === g} onClick={() => void setLevel(it, g)}>
                    {GO_KO[g]}
                  </button>
                ))}
              </div>
              <div className="s-item-actions">
                <button className="s-btn small" onClick={() => void run(() => client.call("DELETE", `/v1/buyer/interests/${it.id}`))}>
                  지우기
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="s-field">
        <label htmlFor="bkw">키워드 더하기</label>
        <div className="s-row">
          <input id="bkw" className="s-input" style={{ flex: 1 }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="예: 캠핑 테이블" />
          <button
            className="s-btn primary"
            disabled={!kw.trim()}
            onClick={() => {
              const k = kw.trim();
              setKw("");
              void run(() => client.call("POST", "/v1/buyer/interests", { type: "keyword", keyword: k, goLevel: lvl }), "더했어요");
            }}
          >
            더하기
          </button>
        </div>
        <div className="s-seg" style={{ marginTop: 8 }}>
          {(["must", "likely", "near"] as GoLevel[]).map((g) => (
            <button key={g} className={lvl === g ? "on" : ""} onClick={() => setLvl(g)}>
              {GO_KO[g]}
            </button>
          ))}
        </div>
      </div>
      {settings && (
        <div className="s-field">
          <span className="s-label">등급별 최대 우회 시간</span>
          {(["must", "likely", "near"] as GoLevel[]).map((g) => (
            <div className="s-row b-setting" key={g}>
              <span>{GO_KO[g]}</span>
              <button className="s-btn small" onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { maxDetourMin: { ...settings.maxDetourMin, [g]: Math.max(1, settings.maxDetourMin[g] - (g === "near" ? 1 : 5)) } }))}>
                줄이기
              </button>
              <b>{settings.maxDetourMin[g]}분</b>
              <button className="s-btn small" onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { maxDetourMin: { ...settings.maxDetourMin, [g]: settings.maxDetourMin[g] + (g === "near" ? 1 : 5) } }))}>
                늘리기
              </button>
            </div>
          ))}
          <div className="s-row b-setting">
            <span>도착 배터리 최소</span>
            <button className="s-btn small" onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { minArrivalSocPct: settings.minArrivalSocPct - 5 }))}>
              줄이기
            </button>
            <b>{settings.minArrivalSocPct}%</b>
            <button className="s-btn small" onClick={() => void run(() => client.call("PUT", "/v1/buyer/settings", { minArrivalSocPct: settings.minArrivalSocPct + 5 }))}>
              늘리기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Pay({ me, client, run, hasActive }: { me: Me; client: ApiClient; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; hasActive: boolean }) {
  const pm = me.paymentMethod;
  return (
    <>
      <div className="s-h2">결제 수단</div>
      <div className="s-list">
        <div className="s-item" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }} data-testid="pay-method">
          <div>
            <div className="s-item-title">{pm ? pm.label : "등록된 결제 수단이 없어요"}</div>
            <div className="s-item-meta">{pm ? `${dayText(pm.addedAt)} 등록` : "없으면 차에서 판매자에게 요청할 수 없어요"}</div>
          </div>
          {pm ? (
            <button className="s-btn small" disabled={hasActive} onClick={() => void run(() => client.call("DELETE", "/v1/buyer/payment-method"), "결제 수단을 지웠어요")}>
              지우기
            </button>
          ) : (
            <button className="s-btn primary small" onClick={() => void run(() => client.call("PUT", "/v1/buyer/payment-method", { kind: "test" }), "등록했어요")} data-testid="pay-register">
              테스트 결제 수단 등록
            </button>
          )}
        </div>
      </div>
      {hasActive && pm && <p className="s-help">진행 중인 거래가 끝나면 바꿀 수 있어요.</p>}
      <p className="s-help">
        판매자가 수락하는 순간 대금이 결제 대행사(PG)에 보관되고, 받았어요 뒤 이의 제기 기간이 지나면 판매자에게 정산돼요. 현장에서 물건이 다르거나 판매자를 만나지 못하면 전액 환불돼요.
      </p>
      <p className="s-help">
        실서비스에서는 결제 대행사의 결제창에서 카드를 등록하고, 주행중GO!는 카드 번호를 받지 않아요. 이 시연에는 실제 결제가 없는 테스트 수단만 있어요.
      </p>
    </>
  );
}
