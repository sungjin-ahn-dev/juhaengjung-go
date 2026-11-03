/** 정차 중에만 여는 화면 — 목적지, 관심사, 현장 확인, 결과, 차종 고르기 (출발 전 브리핑은 오른쪽 추천 목록) */
import { useEffect, useState } from "react";
import { DEMO_PLACES, VEHICLE_TABLE, type GoLevel, type VehicleProfile } from "@jhgo/core";
import { Car, Check, CircleAlert, CreditCard, Minus, Plus, Star, Trash2, X } from "lucide-react";
import type { CarController, CarState, TradeView } from "../controller.ts";
import { CONDITION_KO, fmtWon, GO_KO } from "./format.ts";

/** 시연 시계 기준 지금 시각 — 1초마다 다시 그린다 */
function useNow(c: CarController) {
  const [now, setNow] = useState(() => c.clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(c.clock.now()), 1000);
    return () => clearInterval(id);
  }, [c]);
  return now;
}

/** 차종 적재 공간 한 줄(추정치) */
export function vehicleSpaceText(v: VehicleProfile): string {
  if (v.seatRows === 3 && v.row3Up)
    return `${v.model}, 3열 세우면 트렁크 깊이 ${v.row3Up.d}cm, 3열 접으면 ${v.trunk.d}cm, 2·3열 접으면 ${v.folded.d}cm (추정치)`;
  return `${v.model}, 트렁크 ${v.trunk.w}×${v.trunk.d}×${v.trunk.h}cm, 2열 접으면 깊이 ${v.folded.d}cm (추정치)`;
}

function Head({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="c-sheet-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <button className="c-close" aria-label="닫기" onClick={onClose}>
        <X size={24} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Sheet({ s, c }: { s: CarState; c: CarController }) {
  const close = () => c.open("map");
  switch (s.screen) {
    case "destination":
      return <DestinationSheet s={s} c={c} close={close} />;
    case "interests":
      return <InterestsSheet s={s} c={c} close={close} />;
    case "inspect":
      return <InspectSheet s={s} c={c} close={close} />;
    case "result":
      return <ResultSheet s={s} c={c} />;
    case "vehicle":
      return <VehicleSheet s={s} c={c} close={close} />;
    default:
      return null;
  }
}

const DESTS = [
  { ...DEMO_PLACES.home, note: "자주 가는 곳" },
  { ...DEMO_PLACES.jamsil, note: "잠실역" },
  { ...DEMO_PLACES.pangyoOffice, note: "판교 회사" },
];

function DestinationSheet({ s, c, close }: { s: CarState; c: CarController; close: () => void }) {
  if (c.platformKind === "bridge") {
    return (
      <div className="c-sheet" data-testid="sheet-destination">
        <Head title="목적지는 내비에서" sub="Pleos 내비에서 목적지를 정하면 이 앱이 NaviHelper로 읽어 와요" onClose={close} />
        <div className="c-sheet-body">
          <p className="c-note">목적지가 잡히면 출발 전 브리핑이 열리고, 길 위의 관심 매물을 먼저 보여 드려요.</p>
          <div className="c-big-actions" style={{ marginTop: 18 }}>
            <button className="c-btn kraft" onClick={() => c.open("briefing")}>
              지금 목적지로 브리핑 보기
            </button>
          </div>
        </div>
      </div>
    );
  }
  const cur = s.destination?.name;
  return (
    <div className="c-sheet" data-testid="sheet-destination">
      <Head title="어디로 갈까요?" sub="목적지를 정하면 길 위의 관심 매물을 먼저 보여 드려요" onClose={close} />
      <div className="c-sheet-body">
        <div className="c-dest">
          {DESTS.map((d) => (
            <button key={d.name} className={cur === d.name ? "on" : ""} onClick={() => void c.setDestination(d)}>
              <b>{d.name}</b>
              <span>{d.note}</span>
            </button>
          ))}
        </div>
        <p className="c-note" style={{ marginTop: 18 }}>
          실제 차에서는 Pleos 내비에서 정한 목적지를 NaviHelper로 그대로 읽어요. 여기서는 시뮬레이터 내비에 목적지를 넣어요.
        </p>
      </div>
    </div>
  );
}

const KEYWORD_SUGGEST = ["카시트", "유모차", "아기 침대", "캠핑의자", "캠핑 테이블", "텐트", "자전거", "책상", "모니터"];
const LEVELS: GoLevel[] = ["must", "likely", "near"];
const LEVEL_HINT: Record<GoLevel, string> = { must: "꼭 사고 싶은 것", likely: "조건이 맞으면", near: "가는 길 바로 옆이면" };

function Stepper({ value, unit, onChange, step, min, label }: { value: number; unit: string; onChange: (v: number) => void; step: number; min: number; label: string }) {
  return (
    <div className="c-stepper" role="group" aria-label={label}>
      <button onClick={() => onChange(Math.max(min, value - step))} aria-label="줄이기">
        <Minus size={22} aria-hidden="true" />
      </button>
      <b>
        {value}
        {unit}
      </b>
      <button onClick={() => onChange(value + step)} aria-label="늘리기">
        <Plus size={22} aria-hidden="true" />
      </button>
    </div>
  );
}

function InterestsSheet({ s, c, close }: { s: CarState; c: CarController; close: () => void }) {
  const [kw, setKw] = useState("");
  const st = s.settings;
  return (
    <div className="c-sheet" data-testid="sheet-interests">
      <Head title="관심사" sub="가는 길에 이 물건이 있으면 알려 드려요. 얼마나 사고 싶은지에 따라 돌아가도 되는 시간이 달라요" onClose={close} />
      <div className="c-sheet-body">
        {s.interests.length === 0 && <p className="c-note">아직 없어요. 아래에서 찾는 물건을 더해 보세요.</p>}
        {s.interests.map((it) => (
          <div className="c-row" key={it.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
            <div>
              <div className="c-row-title">{it.type === "keyword" ? it.keyword : it.title ?? "찜한 매물"}</div>
              <div className="c-row-meta">{it.type === "keyword" ? LEVEL_HINT[it.goLevel] : it.listingStatus && it.listingStatus !== "active" ? "찜, 지금은 판매 중이 아니에요" : "찜한 매물"}</div>
            </div>
            <div className="c-seg" role="radiogroup" aria-label="GO 등급">
              {LEVELS.map((g) => (
                <button
                  key={g}
                  className={it.goLevel === g ? "on" : ""}
                  role="radio"
                  aria-checked={it.goLevel === g}
                  onClick={() => {
                    if (it.type === "keyword" && it.keyword) void c.addInterest(it.keyword, g);
                    else if (it.type === "wish" && it.listingId) void c.setWishLevel(it.listingId, g);
                  }}
                >
                  {GO_KO[g]}
                </button>
              ))}
            </div>
            <button className="c-btn" onClick={() => void c.removeInterest(it.id)} aria-label={`${it.type === "keyword" ? it.keyword : it.title} 빼기`}>
              <Trash2 size={20} aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="c-sub">찾는 물건 더하기</div>
        <form
          className="c-field"
          onSubmit={(e) => {
            e.preventDefault();
            if (!kw.trim()) return;
            void c.addInterest(kw.trim(), "likely");
            setKw("");
          }}
        >
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="예: 캠핑 테이블" aria-label="찾는 물건" />
          <button className="c-btn primary" disabled={!kw.trim()}>
            더하기
          </button>
        </form>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {KEYWORD_SUGGEST.filter((k) => !s.interests.some((i) => i.keyword === k)).map((k) => (
            <button key={k} className="c-btn" onClick={() => void c.addInterest(k, "likely")}>
              <Plus size={18} aria-hidden="true" />
              {k}
            </button>
          ))}
        </div>
        {st && (
          <>
            <div className="c-sub">얼마나 돌아가도 될까요?</div>
            {LEVELS.map((g) => (
              <div className="c-setting" key={g}>
                <span className={`lvl ${g}`} aria-hidden="true" />
                <div className="c-setting-main">
                  <b>{GO_KO[g]}</b>
                  <small>{LEVEL_HINT[g]}</small>
                </div>
                <Stepper value={st.maxDetourMin[g]} unit="분" min={1} step={g === "near" ? 1 : 5} label={`${GO_KO[g]} 최대 우회 시간`} onChange={(v) => void c.saveSettings({ maxDetourMin: { ...st.maxDetourMin, [g]: v } })} />
              </div>
            ))}
            <div className="c-setting">
              <span className="lvl battery" aria-hidden="true" />
              <div className="c-setting-main">
                <b>도착 배터리</b>
                <small>들렀다 가도 이만큼은 남게</small>
              </div>
              <Stepper value={st.minArrivalSocPct} unit="%" min={5} step={5} label="도착 배터리 최소" onChange={(v) => void c.saveSettings({ minArrivalSocPct: v })} />
            </div>
          </>
        )}
        <div className="c-sub">내 차</div>
        <div className="c-banner">
          <Car size={22} aria-hidden="true" />
          <span style={{ flex: 1 }}>{s.vehicle ? vehicleSpaceText(s.vehicle) : "차종 정보가 없어요"}</span>
          <button className="c-btn" onClick={() => c.open("vehicle")}>
            바꾸기
          </button>
        </div>
        <div className="c-sub">결제 수단</div>
        <div className={`c-banner ${s.paymentMethod ? "" : ""}`} data-testid="payment-line">
          {s.paymentMethod ? <CreditCard size={22} aria-hidden="true" /> : <CircleAlert size={22} color="var(--warn)" aria-hidden="true" />}
          <span style={{ flex: 1, fontWeight: 500 }}>
            {s.paymentMethod ? s.paymentMethod.label : "등록된 결제 수단이 없어요. 없으면 판매자에게 요청할 수 없어요."}
            <br />
            <span className="c-note">결제 수단은 폰의 주행중GO!(구매자)에서 등록하고 바꿔요. 판매자가 수락하는 순간 대금이 보관돼요.</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const REASONS = ["사진과 상태가 달라요", "크기가 달라요", "파손이 있어요", "구성품이 빠졌어요"];

function InspectSheet({ s, c, close }: { s: CarState; c: CarController; close: () => void }) {
  const t = s.trade;
  const [declining, setDeclining] = useState(false);
  if (!t)
    return (
      <div className="c-sheet">
        <Head title="물건 확인" onClose={close} />
        <div className="c-sheet-body c-note">진행 중인 거래가 없어요.</div>
      </div>
    );
  return (
    <div className="c-sheet" data-testid="sheet-inspect">
      <Head title="물건 확인" sub={`${t.pickupPoint?.label ?? ""}에서 ${t.seller?.name ?? "판매자"}님과 거래 중`} onClose={close} />
      <div className="c-sheet-body">
        {s.loadedPrompt && (
          <div className="c-banner kraft">
            <Check size={22} strokeWidth={2.6} aria-hidden="true" />
            트렁크를 닫았어요. 실으셨나요?
          </div>
        )}
        {t.handedAt && (
          <div className="c-banner ok" data-testid="handed-banner">
            <Check size={22} strokeWidth={2.6} aria-hidden="true" />
            판매자가 건넸다고 표시했어요. 확인되면 받았어요를 눌러 주세요.
          </div>
        )}
        {t.status === "arrived" && !t.handedAt && <WaitPanel t={t} c={c} />}
        <div className="c-inspect-grid">
          <div>{t.photos[0] ? <img className="c-photo" src={t.photos[0]} alt={t.title} /> : <div className="c-photo" />}</div>
          <div>
            <div className="c-row-title" style={{ fontSize: 23 }}>
              {t.title}
            </div>
            <dl className="c-spec">
              <dt>등록 크기</dt>
              <dd>{t.sizeCm ? `${t.sizeCm.w}×${t.sizeCm.d}×${t.sizeCm.h}cm` : "-"}</dd>
              <dt>상태</dt>
              <dd>{t.condition ? CONDITION_KO[t.condition].replace("상태 ", "") : "-"}</dd>
              <dt>가격</dt>
              <dd>{fmtWon(t.price)}, 흥정 없음</dd>
              <dt>판매자</dt>
              <dd>
                {t.seller?.name ?? "-"}
                {t.seller?.completed ? `, 거래 ${t.seller.completed}회` : ""}
                {t.seller?.rating ? `, 평점 ${t.seller.rating}` : ""}
              </dd>
            </dl>
            <p className="c-note" style={{ marginTop: 12 }}>
              {fmtWon(t.price)}은 보관 중이에요. 받았어요를 누르면 이의 제기 기간 뒤 판매자에게 정산돼요.
            </p>
          </div>
        </div>
        {!declining ? (
          <div className="c-big-actions">
            <button style={{ background: "var(--kraft)", color: "var(--kraft-ink)" }} onClick={() => void c.received()}>
              받았어요
            </button>
            <button style={{ background: "var(--raised)", color: "var(--text)" }} onClick={() => setDeclining(true)}>
              안 살게요
            </button>
          </div>
        ) : (
          <>
            <div className="c-sub">등록 정보와 무엇이 다른가요?</div>
            <p className="c-note">고르면 거래가 끝나고 대금은 전액 환불돼요. 판매자 신뢰도에 반영돼요. 현장 사진은 폰의 주행중GO!에서 남길 수 있어요.</p>
            <div className="c-reasons">
              {REASONS.map((r) => (
                <button key={r} className="c-btn" onClick={() => void c.declineMismatch(r)}>
                  {r}
                </button>
              ))}
              <button className="c-btn" onClick={() => setDeclining(false)}>
                돌아가기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** T20 도착했는데 판매자가 안 나올 때 — 다시 알리기, 기다린 뒤 끝내기. T28 판매자가 나오는 중인지 */
function WaitPanel({ t, c }: { t: TradeView; c: CarController }) {
  const now = useNow(c);
  const [confirm, setConfirm] = useState(false);
  const until = t.sellerWaitUntil ?? null;
  const left = until !== null ? until - now : null;
  const can = left !== null && left <= 0;
  const waited = t.arrivedAt ? Math.max(0, Math.floor((now - t.arrivedAt) / 60000)) : 0;
  const nudgedRecently = t.nudgedAt ? now - t.nudgedAt < 60_000 : false;
  const mmss = left !== null && left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` : "";
  const comingMin = t.sellerComingAt ? Math.floor((now - t.sellerComingAt) / 60000) : 0;
  return (
    <div className="c-wait" data-testid="seller-wait">
      {t.sellerComingAt && (
        <div className="c-coming" data-testid="seller-coming">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "inherit", fontSize: "inherit", fontWeight: "inherit" }}>
            <Check size={20} strokeWidth={2.6} aria-hidden="true" /> 판매자가 나오고 있어요
          </span>
          <span>{comingMin ? `${comingMin}분 전` : "방금"}</span>
        </div>
      )}
      <div className="c-wait-head">
        <b>판매자를 기다리는 중</b>
        <span>{can ? `도착하고 ${waited}분이 지났어요` : left !== null ? `${mmss} 뒤에도 안 나오면 거래를 끝낼 수 있어요` : ""}</span>
      </div>
      {!confirm ? (
        <div className="c-wait-actions">
          <button className="c-btn" disabled={nudgedRecently} onClick={() => void c.nudgeSeller()} data-testid="nudge">
            {nudgedRecently ? "다시 알렸어요" : "판매자에게 다시 알리기"}
          </button>
          <button className="c-btn" disabled={!can} onClick={() => setConfirm(true)} data-testid="seller-absent">
            판매자가 안 나왔어요
          </button>
        </div>
      ) : (
        <div className="c-wait-confirm">
          <p>거래를 끝낼까요? 대금은 전액 환불되고 판매자 신뢰도에 반영돼요. 경유지도 해제해요.</p>
          <div className="c-wait-actions">
            <button className="c-btn kraft" onClick={() => void c.sellerAbsent()} data-testid="seller-absent-confirm">
              끝내기
            </button>
            <button className="c-btn" onClick={() => setConfirm(false)}>
              더 기다리기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultSheet({ s, c }: { s: CarState; c: CarController }) {
  const r = s.result;
  if (!r) return null;
  const first = r.items[0];
  return (
    <div className="c-sheet" data-testid="sheet-result">
      <Head title={r.items.length ? "가는 길에 챙겼어요" : "도착했어요"} sub={r.items.length ? r.items.map((i) => `${i.categoryLabel} ${fmtWon(i.price)}`).join(", ") : "이번 길엔 들른 곳이 없어요"} onClose={() => c.dismissResult()} />
      <div className="c-sheet-body">
        {first && (
          <div className="c-result-grid">
            <div>
              <span>따로 다녀왔다면</span>
              <div className="c-result-num">
                {first.separateTripMin ?? "-"}
                <small>분</small>
              </div>
            </div>
            <div>
              <span>실제로 늘어난 시간</span>
              <div className="c-result-num">
                {r.addedMin ?? first.detourMin}
                <small>분</small>
              </div>
            </div>
            <div>
              <span>더 달린 거리</span>
              <div className="c-result-num">
                {r.extraKm ?? "-"}
                <small>km</small>
              </div>
            </div>
          </div>
        )}
        {r.items.map((i) => (
          <div className="c-rate" key={i.tradeId} data-testid={`review-${i.categoryLabel}`}>
            <span>{i.categoryLabel} 판매자는 어땠나요?</span>
            {s.ratings[i.tradeId] ? (
              <b>
                <Star size={20} fill="currentColor" aria-hidden="true" /> {s.ratings[i.tradeId]}점을 남겼어요
              </b>
            ) : (
              <RateStars onRate={(n) => void c.rate(i.tradeId, n)} label={`${i.categoryLabel} 판매자 평가`} />
            )}
          </div>
        ))}
        {r.notes.map((n) => (
          <div className="c-banner" key={n}>
            {n}
          </div>
        ))}
        <p className="c-note">더 달린 거리는 이번 주행에서 잰 거리와 원래 경로의 차이예요. 따로 다녀왔다면 걸렸을 시간은 목적지에서 판매자까지 왕복 경로로 계산했어요.</p>
        <button className="c-btn primary lg" style={{ marginTop: 14 }} onClick={() => c.dismissResult()}>
          닫기
        </button>
      </div>
    </div>
  );
}

function RateStars({ onRate, label }: { onRate: (n: number) => void; label: string }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="c-stars" role="group" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= hover ? "on" : ""} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onClick={() => onRate(n)} aria-label={`${n}점`}>
          <Star size={30} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function VehicleSheet({ s, c, close }: { s: CarState; c: CarController; close: () => void }) {
  return (
    <div className="c-sheet" data-testid="sheet-vehicle">
      <Head title="어떤 차를 타세요?" sub="차 정보(CarInfo)에 모델명이 없을 때 한 번만 물어요. 트렁크에 실을 수 있는지 판단하는 데 써요." onClose={close} />
      <div className="c-sheet-body">
        <div className="c-dest">
          {VEHICLE_TABLE.map((v) => (
            <button key={v.model} className={s.vehicle?.model === v.model ? "on" : ""} onClick={() => void c.pickVehicle(v.model)}>
              <b>{v.model}</b>
              <span>{v.seatRows === 3 && v.row3Up ? `3열 차, 3열 세우면 깊이 ${v.row3Up.d}cm` : `트렁크 ${v.trunk.w}×${v.trunk.d}×${v.trunk.h}cm`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
