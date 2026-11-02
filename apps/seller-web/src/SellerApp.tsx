/**
 * 판매자 앱 — 같이 올리기, 요청 수락, 진행(도착 예정·나오세요·도착), 건넸어요, 정산.
 * 판매자는 앱 설치 없이 모바일 웹으로 쓴다. 차가 오고 있다는 요청은 화면 전체로 알린다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeAvailability, kstClock, referencePrice, type Availability, type Condition, type Listing } from "@jhgo/core";
import type { ApiClient, AppClock, AppEvent } from "@jhgo/api";
import "./styles.css";

interface Me {
  id: string;
  name: string;
  role: string;
  homePlace?: { lat: number; lng: number; label: string };
}
interface SellerTrade {
  id: string;
  listingId: string;
  title: string;
  category: string;
  price: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  etaAt: number | null;
  detourMin: number;
  fitLabel: string;
  vehicleModel: string;
  autoAccepted: boolean;
  acceptedAt?: number;
  waypointConfirmedAt?: number;
  comeOutSentAt?: number;
  arrivedAt?: number;
  handedAt?: number;
  receivedAt?: number;
  settleAt?: number;
  settledAt?: number;
  canceledBy?: string;
  reason?: string;
  mismatch?: { reason: string };
  payment: { status: string; amount: number };
  ratings: { buyerToSeller?: number; sellerToBuyer?: number };
  photos: string[];
  pickupPoint: { label: string } | null;
  buyer: { name: string; vehicleModel: string; completed: number; noShow: number; rating: number | null } | null;
}
interface Summary {
  held: number;
  settled: number;
  refunded: number;
  nextSettleAt: number | null;
  ledger: { id: string; action: string; amount: number; at: number; tradeId: string }[];
  trust: { responseRate: number | null; completed: number; rating: number | null; requests: number };
}
interface Catalog {
  categories: { id: string; label: string; fragile: boolean }[];
  pickupPlaces: { id: string; label: string; lat: number; lng: number }[];
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const ACTIVE = ["requested", "accepted", "arrived"];
const STATUS_KO: Record<string, string> = {
  requested: "응답 대기",
  accepted: "오는 중",
  arrived: "도착",
  completed: "정산 대기",
  settled: "정산 완료",
  declined: "거절함",
  expired: "응답 시간 지남",
  canceled: "취소",
  declined_mismatch: "현장 거절 · 환불",
  no_show: "구매자 미도착",
};
const LISTING_KO: Record<string, string> = { active: "판매 중", reserved: "예약", sold: "판매 완료", hidden: "내림" };

function beep() {
  try {
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* 소리 못 내도 계속 */
  }
}
function buzz(p: number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* 무시 */
  }
}

export function SellerApp({ client, clock, embedded = false, storageKey = "jhgo.seller.token" }: { client: ApiClient; clock: AppClock; embedded?: boolean; storageKey?: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<"items" | "trades" | "money">("items");
  const [composing, setComposing] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [trades, setTrades] = useState<SellerTrade[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(clock.now());
  const [banner, setBanner] = useState<{ tradeId: string; kind: "come_out" | "arrived" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((t: string) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    const [l, t, s] = await Promise.all([
      client.call<{ listings: Listing[] }>("GET", "/v1/seller/listings"),
      client.call<{ trades: SellerTrade[] }>("GET", "/v1/seller/trades"),
      client.call<Summary>("GET", "/v1/seller/summary"),
    ]);
    setListings(l.listings);
    setTrades(t.trades);
    setSummary(s);
  }, [client]);

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
        } catch {
          client.setToken(null);
        }
      }
      setCatalog(await client.call<Catalog>("GET", "/v1/catalog"));
      setChecked(true);
    })();
  }, [client, clock, storageKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), 500);
    const sync = setInterval(() => void clock.sync(), 5000);
    return () => {
      clearInterval(id);
      clearInterval(sync);
    };
  }, [clock]);

  // 실시간 알림
  useEffect(() => {
    if (!me) return;
    void refresh();
    const off = client.subscribe((e: AppEvent) => {
      void refresh();
      if (e.type === "request.new") {
        beep();
        buzz([300, 120, 300, 120, 300]);
      } else if (e.type === "trade.come_out") {
        beep();
        buzz([500, 150, 500]);
        setBanner({ tradeId: e.tradeId!, kind: "come_out" });
        setTab("trades");
      } else if (e.type === "trade.arrived") {
        buzz([200, 100, 200]);
        setBanner({ tradeId: e.tradeId!, kind: "arrived" });
        setTab("trades");
      } else if (["trade.received", "trade.settled", "trade.mismatch", "trade.canceled", "trade.no_show", "trade.expired"].includes(e.type)) {
        say(e.title);
      }
    });
    const poll = setInterval(() => void refresh(), 15000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [me, client, refresh, say]);

  const pending = trades.find((t) => t.status === "requested" && t.expiresAt > now);
  const active = trades.filter((t) => ["accepted", "arrived", "completed"].includes(t.status));

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

  const act = async (tradeId: string, action: string, body?: unknown) => {
    try {
      await client.call("POST", `/v1/seller/trades/${tradeId}/${action}`, body ?? {});
      await refresh();
      if (action === "accept") say("수락했어요. 대금이 보관됐어요");
      if (action === "handed") say("건넸다고 표시했어요");
      if (action === "decline") say("이번엔 거절했어요");
    } catch (e) {
      say((e as Error).message);
    }
  };

  if (!checked) return <div className={`s-root ${embedded ? "embedded" : ""}`} />;
  if (!me) return <Login client={client} onLogin={login} embedded={embedded} />;

  return (
    <div className={`s-root ${embedded ? "embedded" : ""}`} data-testid="seller-app">
      <div className="s-phone">
        <header className="s-top">
          <div>
            <div className="s-brand">주행중GO! 판매자</div>
            <h1>{me.name}님</h1>
          </div>
          <div className="s-trust">
            {summary ? (
              <>
                응답률 {summary.trust.responseRate === null ? "아직 없음" : `${Math.round(summary.trust.responseRate * 100)}%`}
                <br />
                거래 {summary.trust.completed}회{summary.trust.rating ? `, 평점 ${summary.trust.rating}` : ""}
              </>
            ) : null}
          </div>
        </header>
        <main className="s-main">
          {composing ? (
            <Compose
              client={client}
              catalog={catalog}
              me={me}
              onDone={async (ok) => {
                setComposing(false);
                if (ok) {
                  say("올렸어요. 지나가는 차에도 보여요");
                  await refresh();
                }
              }}
            />
          ) : tab === "items" ? (
            <Items listings={listings} client={client} onCompose={() => setComposing(true)} refresh={refresh} say={say} />
          ) : tab === "trades" ? (
            <Trades trades={trades} active={active} now={now} act={act} banner={banner} clearBanner={() => setBanner(null)} />
          ) : (
            <Money summary={summary} />
          )}
        </main>
        {!composing && (
          <nav className="s-tabs" aria-label="판매자 메뉴">
            <button className={tab === "items" ? "on" : ""} onClick={() => setTab("items")}>
              내 물건
            </button>
            <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")} data-testid="tab-trades">
              거래
              {active.some((t) => ACTIVE.includes(t.status)) && <span className="s-dot" />}
            </button>
            <button className={tab === "money" ? "on" : ""} onClick={() => setTab("money")}>
              정산
            </button>
          </nav>
        )}
      </div>
      {pending && <Takeover t={pending} now={now} act={act} embedded={embedded} />}
      {toast && (
        <div className="s-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({ client, onLogin, embedded }: { client: ApiClient; onLogin: (b: { userId?: string; role?: string; name?: string }) => Promise<void>; embedded: boolean }) {
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [name, setName] = useState("");
  useEffect(() => {
    client
      .call<{ users: { id: string; name: string; role: string }[] }>("GET", "/v1/demo/users")
      .then((r) => setUsers(r.users.filter((u) => u.role === "seller")))
      .catch(() => setUsers([]));
  }, [client]);
  return (
    <div className={`s-root ${embedded ? "embedded" : ""}`}>
      <div className="s-phone s-login">
        <h1>주행중GO!</h1>
        <p>
          큰 물건, "차 있으세요?"부터 묻지 않아도 돼요.
          <br />
          실을 수 있는 차만 집 앞까지 와요.
        </p>
        <div className="s-h2">시연용 판매자로 시작</div>
        <div className="s-list">
          {users.map((u) => (
            <div className="s-item" key={u.id} style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
              <div className="s-item-title">{u.name}</div>
              <button className="s-btn primary small" onClick={() => void onLogin({ userId: u.id })} data-testid={`login-${u.name}`}>
                이 계정으로
              </button>
            </div>
          ))}
          {users.length === 0 && <div className="s-empty">시연 계정을 불러오지 못했어요</div>}
        </div>
        <div className="s-h2">새 이름으로 시작</div>
        <div className="s-row">
          <input className="s-input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" aria-label="이름" />
          <button className="s-btn primary" disabled={!name.trim()} onClick={() => void onLogin({ role: "seller", name: name.trim() })}>
            시작
          </button>
        </div>
      </div>
    </div>
  );
}

function Items({ listings, client, onCompose, refresh, say }: { listings: Listing[]; client: ApiClient; onCompose: () => void; refresh: () => Promise<void>; say: (t: string) => void }) {
  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await client.call("PATCH", `/v1/seller/listings/${id}`, body);
      await refresh();
    } catch (e) {
      say((e as Error).message);
    }
  };
  return (
    <>
      <button className="s-btn kraft block" onClick={onCompose} data-testid="compose">
        같이 올리기
      </button>
      <p className="s-help">다른 중고 앱에 쓴 글을 그대로 붙여 넣으면 돼요. 그 앱은 그대로 쓰고, 여기서는 지나가는 차에도 보여요.</p>
      <div className="s-h2">내 물건 {listings.length}개</div>
      {listings.length === 0 ? (
        <div className="s-list">
          <div className="s-empty">아직 올린 물건이 없어요. 같이 올리기로 시작해 보세요.</div>
        </div>
      ) : (
        <div className="s-list">
          {listings.map((l) => (
            <div className="s-item" key={l.id} data-testid="listing-row">
              {l.photos[0] ? <img src={l.photos[0]} alt="" /> : <div className="s-thumb" />}
              <div>
                <div className="s-item-title">{l.title}</div>
                <div className="s-item-meta">
                  <span className={`s-chip ${l.status}`}>{LISTING_KO[l.status]}</span>
                  {won(l.price)}
                  <br />
                  거래 가능: {describeAvailability(l.availability)}
                  {l.autoAccept ? ", 자동 수락" : ""}
                  <br />
                  {l.sizeCm.w}×{l.sizeCm.d}×{l.sizeCm.h}cm{l.sizeSource === "seller_measured" ? " (실측)" : " (AI 추정)"}
                </div>
                {l.status === "active" && (
                  <div className="s-item-actions">
                    <button className="s-btn small" onClick={() => void patch(l.id, { autoAccept: !l.autoAccept })}>
                      {l.autoAccept ? "자동 수락 끄기" : "자동 수락 켜기"}
                    </button>
                    <button className="s-btn small" onClick={() => void patch(l.id, { status: "sold" })}>
                      다른 데서 팔렸어요
                    </button>
                    <button className="s-btn small" onClick={() => void patch(l.id, { status: "hidden" })}>
                      내리기
                    </button>
                  </div>
                )}
                {l.status === "hidden" && (
                  <div className="s-item-actions">
                    <button className="s-btn small" onClick={() => void patch(l.id, { status: "active" })}>
                      다시 올리기
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 640 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function samplePhoto(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#e9d6b8"/><rect x="96" y="58" width="128" height="104" rx="18" fill="#c59a63" opacity=".6"/><text x="160" y="205" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#5a4224">${label}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function Compose({ client, catalog, me, onDone }: { client: ApiClient; catalog: Catalog | null; me: Me; onDone: (ok: boolean) => void }) {
  const [paste, setPaste] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [condition, setCondition] = useState<Condition>("good");
  const [fragile, setFragile] = useState(false);
  const [size, setSize] = useState({ w: "", d: "", h: "" });
  const [sizeFromAi, setSizeFromAi] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const places = catalog?.pickupPlaces ?? [];
  const [placeId, setPlaceId] = useState<string>(() => places.find((p) => p.label === me.homePlace?.label)?.id ?? places[0]?.id ?? "");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("21:00");
  const [anytime, setAnytime] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!placeId && places[0]) setPlaceId(places.find((p) => p.label === me.homePlace?.label)?.id ?? places[0].id);
  }, [places, placeId, me.homePlace]);

  const nums = { w: Number(size.w), d: Number(size.d), h: Number(size.h) };
  const sizeOk = nums.w > 0 && nums.d > 0 && nums.h > 0;
  const big = sizeOk && Math.max(nums.w, nums.d, nums.h) >= 60;
  const ref = category ? referencePrice(category, condition) : null;
  const priceNum = Number(price.replace(/[^\d]/g, ""));
  const ready = title.trim() && priceNum > 0 && sizeOk && placeId && (!big || measured) && (anytime || days.length > 0);

  const fill = async () => {
    const r = await client.call<{ title: string; price: number | null; description: string; category: string | null; sizeEstimate: { sizeCm: { w: number; d: number; h: number }; note: string } | null }>("POST", "/v1/seller/parse", { text: paste });
    setTitle(r.title);
    if (r.price) setPrice(String(r.price));
    setDescription(r.description);
    if (r.category) {
      setCategory(r.category);
      setFragile(!!catalog?.categories.find((c) => c.id === r.category)?.fragile);
    }
    if (r.sizeEstimate) {
      setSize({ w: String(r.sizeEstimate.sizeCm.w), d: String(r.sizeEstimate.sizeCm.d), h: String(r.sizeEstimate.sizeCm.h) });
      setSizeFromAi(true);
      setMeasured(false);
      setNote(r.sizeEstimate.note);
    }
  };
  const aiSize = async () => {
    const r = await client.call<{ estimate: { sizeCm: { w: number; d: number; h: number }; note: string } | null }>("POST", "/v1/seller/estimate-size", { title, category });
    if (!r.estimate) {
      setNote("이 품목은 크기를 추정하지 못했어요. 직접 재서 넣어 주세요.");
      return;
    }
    setSize({ w: String(r.estimate.sizeCm.w), d: String(r.estimate.sizeCm.d), h: String(r.estimate.sizeCm.h) });
    setSizeFromAi(true);
    setMeasured(false);
    setNote(r.estimate.note);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const place = places.find((p) => p.id === placeId)!;
    const availability: Availability[] = anytime ? [] : [{ days, from, to }];
    try {
      await client.call("POST", "/v1/seller/listings", {
        title: title.trim(),
        description,
        category: category || null,
        price: priceNum,
        condition,
        fragile,
        sizeCm: nums,
        sizeSource: measured || !sizeFromAi ? "seller_measured" : "ai",
        photos,
        pickupPoint: { lat: place.lat, lng: place.lng, label: place.label },
        availability,
        autoAccept,
      });
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="s-form" data-testid="compose-form">
      <div className="s-row" style={{ justifyContent: "space-between" }}>
        <div className="s-h2" style={{ margin: "8px 2px" }}>
          같이 올리기
        </div>
        <button className="s-btn small" onClick={() => onDone(false)}>
          닫기
        </button>
      </div>
      <div className="s-field">
        <label htmlFor="paste">다른 앱에 쓴 글 붙여넣기</label>
        <textarea id="paste" className="s-textarea" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"예)\n회전형 카시트 팝니다\n35,000원\n아이가 커서 정리해요"} />
        <div className="s-row" style={{ marginTop: 8 }}>
          <button className="s-btn primary" disabled={!paste.trim()} onClick={() => void fill()} data-testid="fill">
            채우기
          </button>
          <span className="s-help" style={{ margin: 0 }}>
            본인이 쓴 글과 사진만 옮겨 주세요
          </span>
        </div>
      </div>

      <div className="s-field">
        <label htmlFor="title">제목</label>
        <input id="title" className="s-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="s-row" style={{ marginTop: 10 }}>
          <select className="s-select" style={{ flex: 1 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="품목">
            <option value="">품목 고르기</option>
            {catalog?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input className="s-input" style={{ flex: 1 }} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="가격(원)" aria-label="가격" />
        </div>
        {ref && (
          <p className="s-help">
            주행중GO! 기준가 {won(ref)}. 다른 사이트 시세가 아니라 품목·상태별 자체 기준표예요.
          </p>
        )}
      </div>

      <div className="s-field">
        <span className="s-label">사진</span>
        <div className="s-photos">
          {photos.map((p, i) => (
            <img key={i} src={p} alt="" />
          ))}
        </div>
        <div className="s-row" style={{ marginTop: 8 }}>
          <label className="s-btn" style={{ fontWeight: 400 }}>
            사진 고르기
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []).slice(0, 3 - photos.length);
                const out = await Promise.all(files.map(shrinkImage));
                setPhotos((p) => [...p, ...out].slice(0, 3));
              }}
            />
          </label>
          <button className="s-btn" onClick={() => setPhotos((p) => [...p, samplePhoto(title.slice(0, 8) || "물건")].slice(0, 3))}>
            샘플 사진
          </button>
        </div>
      </div>

      <div className="s-field">
        <span className="s-label">
          크기 (cm){sizeFromAi && !measured && <span className="s-badge-ai">AI 추정</span>}
        </span>
        <div className="s-grid3">
          {(["w", "d", "h"] as const).map((k) => (
            <label key={k}>
              {k === "w" ? "가로" : k === "d" ? "세로(깊이)" : "높이"}
              <input className="s-input" inputMode="numeric" value={size[k]} onChange={(e) => setSize({ ...size, [k]: e.target.value.replace(/[^\d]/g, "") })} aria-label={`크기 ${k}`} />
            </label>
          ))}
        </div>
        <div className="s-row" style={{ marginTop: 8 }}>
          <button className="s-btn" onClick={() => void aiSize()} disabled={!title && !category}>
            AI로 크기 채우기
          </button>
        </div>
        {note && <p className="s-help">{note}</p>}
        {big && (
          <label className="s-switch" style={{ marginTop: 10, fontWeight: 600 }}>
            줄자로 재서 확인했어요
            <input type="checkbox" checked={measured} onChange={(e) => setMeasured(e.target.checked)} data-testid="measured" />
          </label>
        )}
        {big && !measured && <div className="s-warn">한 변이 60cm 이상이라 실측 확인이 있어야 올릴 수 있어요. 실을 수 있는 차에만 알리기 위해서예요.</div>}
      </div>

      <div className="s-field">
        <span className="s-label">상태</span>
        <div className="s-seg">
          {(["good", "fair", "worn"] as Condition[]).map((c) => (
            <button key={c} className={condition === c ? "on" : ""} onClick={() => setCondition(c)}>
              {c === "good" ? "상" : c === "fair" ? "중" : "하"}
            </button>
          ))}
        </div>
        <label className="s-switch" style={{ marginTop: 12 }}>
          깨지기 쉬워요 (구매자에게 편안한 길을 권해요)
          <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
        </label>
      </div>

      <div className="s-field">
        <span className="s-label">거래 장소</span>
        <div className="s-places">
          {places.map((p) => (
            <label key={p.id}>
              <input type="radio" name="place" checked={placeId === p.id} onChange={() => setPlaceId(p.id)} />
              {p.label}
            </label>
          ))}
        </div>
        <p className="s-help">수락한 구매자에게만 정확한 위치가 보여요. 그 전에는 이 근처라는 것만 보여요.</p>
      </div>

      <div className="s-field">
        <span className="s-label">거래 가능 시간</span>
        <label className="s-switch" style={{ marginBottom: 10 }}>
          언제든 괜찮아요
          <input type="checkbox" checked={anytime} onChange={(e) => setAnytime(e.target.checked)} />
        </label>
        {!anytime && (
          <>
            <div className="s-days">
              {DOW.map((d, i) => (
                <button key={d} className={days.includes(i) ? "on" : ""} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())} aria-pressed={days.includes(i)}>
                  {d}
                </button>
              ))}
            </div>
            <div className="s-row" style={{ marginTop: 10 }}>
              <select className="s-select" style={{ width: "auto" }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="시작">
                {TIMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              부터
              <select className="s-select" style={{ width: "auto" }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="끝">
                {TIMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              까지
            </div>
          </>
        )}
        <p className="s-help">이 시간 밖에는 구매자에게 알리지 않아요.</p>
        <label className="s-switch" style={{ marginTop: 12, fontWeight: 600 }}>
          이 시간에는 요청을 바로 받기 (자동 수락)
          <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} />
        </label>
      </div>

      {error && <div className="s-warn">{error}</div>}
      <button className="s-btn primary block" disabled={!ready || busy} onClick={() => void submit()} data-testid="submit">
        올리기
      </button>
    </div>
  );
}

function Takeover({ t, now, act, embedded }: { t: SellerTrade; now: number; act: (id: string, a: string, b?: unknown) => Promise<void>; embedded: boolean }) {
  const total = Math.max(1, t.expiresAt - t.createdAt);
  const left = Math.max(0, t.expiresAt - now);
  const mins = t.etaAt ? Math.max(1, Math.round((t.etaAt - now) / 60000)) : null;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return (
    <div className={`s-takeover ${embedded ? "embedded" : ""}`} role="alertdialog" aria-label="구매 요청" data-testid="takeover">
      <div className="s-take-inner">
        <div className="s-take-title">{t.title.split(" (")[0]} 사러 오는 차가 있어요</div>
        <div className="s-take-eta">{mins !== null ? `${mins}분 뒤` : "곧"}</div>
        <div className="s-take-sub">{t.etaAt ? `${kstClock(t.etaAt)} 도착 예정` : ""}</div>
        <ul className="s-take-facts">
          <li>
            <span>차</span>
            <b>{t.vehicleModel}</b>
          </li>
          <li>
            <span>실을 수 있나요</span>
            <b>{t.fitLabel}</b>
          </li>
          <li>
            <span>가격</span>
            <b>{won(t.price)} (흥정 없음)</b>
          </li>
          <li>
            <span>구매자</span>
            <b>
              {t.buyer?.name} · 거래 {t.buyer?.completed ?? 0}회{t.buyer?.noShow ? `, 노쇼 ${t.buyer.noShow}회` : ""}
            </b>
          </li>
          <li>
            <span>장소</span>
            <b>{t.pickupPoint?.label}</b>
          </li>
        </ul>
        <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>수락하면 대금이 바로 보관돼요. 구매자가 받았다고 확인하면 정산돼요.</p>
        <div className="s-take-timer" aria-label={`응답할 수 있는 시간 ${mm}분 ${ss}초`}>
          <i style={{ transform: `scaleX(${left / total})` }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 14 }}>
          구매자가 갈림길을 지나기 전까지 {mm > 0 ? `${mm}분 ` : ""}{ss}초 남았어요
        </div>
        <div className="s-take-actions">
          <button className="s-accept" onClick={() => void act(t.id, "accept")} data-testid="accept">
            수락
          </button>
          <button className="s-decline" onClick={() => void act(t.id, "decline", { reason: "지금은 어려워요" })}>
            이번엔 어려워요
          </button>
        </div>
      </div>
    </div>
  );
}

const STEPS = ["수락 · 대금 보관", "오는 중", "곧 도착", "도착", "건넴", "정산"];
function stepOf(t: SellerTrade) {
  if (t.status === "settled") return 6;
  if (t.status === "completed") return 5;
  if (t.status === "arrived") return t.handedAt ? 5 : 3;
  if (t.comeOutSentAt) return 2;
  if (t.waypointConfirmedAt) return 1;
  return 0;
}

function Trades({
  trades,
  active,
  now,
  act,
  banner,
  clearBanner,
}: {
  trades: SellerTrade[];
  active: SellerTrade[];
  now: number;
  act: (id: string, a: string, b?: unknown) => Promise<void>;
  banner: { tradeId: string; kind: "come_out" | "arrived" } | null;
  clearBanner: () => void;
}) {
  const past = trades.filter((t) => !active.includes(t) && t.status !== "requested");
  return (
    <>
      {active.length === 0 && <div className="s-empty">진행 중인 거래가 없어요. 지나가는 차가 요청하면 화면 전체로 알려 드려요.</div>}
      {active.map((t) => {
        const step = stepOf(t);
        const mins = t.etaAt ? Math.max(0, Math.round((t.etaAt - now) / 60000)) : null;
        return (
          <div className={`s-trade ${["accepted", "arrived"].includes(t.status) ? "live" : ""}`} key={t.id} data-testid="active-trade">
            <div className="s-trade-head">
              <div className="s-trade-title">{t.title}</div>
              <span className="s-chip reserved">{STATUS_KO[t.status]}</span>
            </div>
            {t.status === "accepted" && (
              <>
                <div className="s-eta-big">{mins !== null ? (mins <= 0 ? "곧 도착" : `${mins}분 남음`) : ""}</div>
                <div className="s-help" style={{ margin: 0 }}>
                  {t.etaAt ? `${kstClock(t.etaAt)} 도착 예정` : ""} · {t.buyer?.vehicleModel}
                </div>
              </>
            )}
            {banner?.tradeId === t.id && (
              <div className="s-banner go" onClick={clearBanner}>
                {banner.kind === "come_out" ? "곧 도착해요. 물건을 들고 나와 주세요" : "구매자가 도착했어요. 물건을 건네 주세요"}
              </div>
            )}
            <ol className="s-steps">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
                  <i />
                  <span>{s}</span>
                  <span>{i === 5 && t.settleAt && t.status === "completed" ? `${kstClock(t.settleAt)} 예정` : ""}</span>
                </li>
              ))}
            </ol>
            <div className="s-row">
              {["accepted", "arrived"].includes(t.status) && !t.handedAt && (
                <button className="s-btn primary" onClick={() => void act(t.id, "handed")} data-testid="handed">
                  건넸어요
                </button>
              )}
              {t.handedAt && t.status !== "completed" && <span className="s-help">구매자 확인을 기다려요. 확인이 없으면 20분 뒤 자동으로 확인돼요.</span>}
              {["accepted", "arrived"].includes(t.status) && (
                <button className="s-btn" onClick={() => void act(t.id, "cancel", { reason: "판매자 사정" })}>
                  취소
                </button>
              )}
            </div>
            {t.status === "completed" && <p className="s-help">구매자가 받았어요. 이의 제기 기간이 지나면 {won(t.price)}이 정산돼요.</p>}
          </div>
        );
      })}
      <div className="s-h2">지난 거래</div>
      <div className="s-list">
        {past.length === 0 && <div className="s-empty">아직 없어요</div>}
        {past.map((t) => (
          <div className="s-item" key={t.id} style={{ gridTemplateColumns: "64px 1fr" }}>
            {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <div className="s-thumb" />}
            <div>
              <div className="s-item-title">{t.title}</div>
              <div className="s-item-meta">
                {STATUS_KO[t.status] ?? t.status}, {won(t.price)}
                {t.mismatch ? ` — ${t.mismatch.reason}` : ""}
                {t.reason && !t.mismatch ? ` — ${t.reason}` : ""}
              </div>
              {(t.status === "settled" || t.status === "completed") && !t.ratings.sellerToBuyer && (
                <div className="s-stars" aria-label="구매자 평가">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => void act(t.id, "rate", { stars: n })} aria-label={`${n}점`}>
                      ★
                    </button>
                  ))}
                </div>
              )}
              {t.ratings.sellerToBuyer && <div className="s-item-meta">구매자 평가 {t.ratings.sellerToBuyer}점</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Money({ summary }: { summary: Summary | null }) {
  const L: Record<string, string> = { hold: "대금 보관", capture: "정산", refund: "환불" };
  const rows = useMemo(() => summary?.ledger ?? [], [summary]);
  if (!summary) return null;
  return (
    <>
      <div className="s-money" data-testid="money">
        <div>
          <span>보관 중</span>
          <b>{won(summary.held)}</b>
        </div>
        <div>
          <span>정산 완료</span>
          <b>{won(summary.settled)}</b>
        </div>
        <div>
          <span>환불</span>
          <b>{won(summary.refunded)}</b>
        </div>
      </div>
      {summary.nextSettleAt && <p className="s-help">다음 정산 예정 {kstClock(summary.nextSettleAt)}</p>}
      <p className="s-help">대금은 결제 대행사(PG)의 에스크로에 보관돼요. 지금은 시연용 가상 결제예요.</p>
      <div className="s-h2">내역</div>
      <div className="s-list s-ledger">
        {rows.length === 0 && <div className="s-empty">아직 없어요</div>}
        {rows.map((r) => (
          <div key={r.id}>
            <span>
              {kstClock(r.at)} {L[r.action] ?? r.action}
            </span>
            <b>{won(r.amount)}</b>
          </div>
        ))}
      </div>
    </>
  );
}
