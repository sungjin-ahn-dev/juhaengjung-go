/** 정차 중에만 여는 화면 — 목적지, 출발 전 브리핑, 관심사, 현장 확인, 결과, 차종 고르기 */
import { useState } from "react";
import { DEMO_PLACES, VEHICLE_TABLE, type GoLevel } from "@jhgo/core";
import type { CarController, CarState, CandidateView } from "../controller.ts";
import { CONDITION_KO, EXCLUSION_KO, fmtClock, fmtKm, fmtMin, fmtWon, GO_KO } from "./format.ts";

function Head({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="c-sheet-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <button className="c-close" aria-label="닫기" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path d="M4 4l12 12M16 4L4 16" stroke="#e8edf3" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function Sheet({ s, c }: { s: CarState; c: CarController }) {
  const close = () => c.open("map");
  switch (s.screen) {
    case "destination":
      return <DestinationSheet c={c} close={close} />;
    case "briefing":
      return <BriefingSheet s={s} c={c} close={close} />;
    case "interests":
      return <InterestsSheet s={s} c={c} close={close} />;
    case "inspect":
      return <InspectSheet s={s} c={c} close={close} />;
    case "result":
      return <ResultSheet s={s} c={c} />;
    case "vehicle":
      return <VehicleSheet c={c} close={close} />;
    default:
      return null;
  }
}

const DESTS = [
  { ...DEMO_PLACES.home, note: "자주 가는 곳" },
  { ...DEMO_PLACES.jamsil, note: "잠실역" },
  { ...DEMO_PLACES.pangyoOffice, note: "판교 회사" },
];

function DestinationSheet({ c, close }: { c: CarController; close: () => void }) {
  return (
    <div className="c-sheet" data-testid="sheet-destination">
      <Head title="어디로 갈까요" sub="목적지를 정하면 길 위의 관심 매물을 먼저 보여 드려요" onClose={close} />
      <div className="c-sheet-body">
        <div className="c-dest">
          {DESTS.map((d) => (
            <button key={d.name} onClick={() => void c.setDestination(d)}>
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

function rowWhy(x: CandidateView) {
  if (x.exclusions.length === 0) return null;
  return <div className="c-row-why">{x.exclusions.map((e) => EXCLUSION_KO[e] ?? e).join(" / ")}</div>;
}

function BriefingSheet({ s, c, close }: { s: CarState; c: CarController; close: () => void }) {
  const b = s.briefing;
  const items = b?.items ?? [];
  const ok = items.filter((x) => x.exclusions.length === 0);
  const tradeBusy = !!s.trade;
  return (
    <div className="c-sheet" data-testid="sheet-briefing">
      <Head
        title={s.destination ? `${s.destination.name}까지` : "출발 전 브리핑"}
        sub={
          b?.route
            ? `${fmtMin(b.route.durationS)}, ${fmtKm(b.route.distanceM)}. ${b.route.viaNames.filter((_, i, a) => i % Math.ceil(a.length / 5) === 0).join(", ")} 지나요`
            : "목적지를 먼저 정해 주세요"
        }
        onClose={close}
      />
      <div className="c-sheet-body">
        {!s.destination && (
          <button className="c-btn primary" onClick={() => c.open("destination")}>
            목적지 정하기
          </button>
        )}
        {s.destination && (
          <>
            <div className="c-sub">
              이번 길에 관심 매물 {items.length}개, 알릴 수 있는 것 {ok.length}개
            </div>
            <p className="c-note">주행 중에는 갈림길에 가까워질 때 하나씩 말해요. 지금 미리 요청하면 판매자가 출발 전에 답할 수 있어요.</p>
            {items.map((x) => (
              <div className="c-row" key={x.listingId} data-testid={`brief-${x.categoryLabel}`}>
                {x.photo ? (
                  <img src={x.photo} alt="" style={{ opacity: x.exclusions.length ? 0.45 : 1 }} />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: 12, background: "#222d3c" }} />
                )}
                <div>
                  <div className="c-row-title">{x.title}</div>
                  <div className="c-row-meta">
                    <span className={`c-chip go-${x.goLevel}`}>{GO_KO[x.goLevel]}</span>
                    {x.detourMin}분 더, {x.fit.label}, {fmtWon(x.price)}
                    {x.etaAtListing ? `, ${fmtClock(x.etaAtListing)} 지남` : ""}
                  </div>
                  {rowWhy(x)}
                </div>
                <div>
                  {x.exclusions.length === 0 ? (
                    <button className="c-btn kraft" disabled={tradeBusy} onClick={() => void c.request(x.listingId, "briefing")}>
                      미리 요청
                    </button>
                  ) : (
                    <button className="c-btn" onClick={() => void c.addWish(x.listingId, x.goLevel)}>
                      찜해 두기
                    </button>
                  )}
                </div>
              </div>
            ))}
            {s.trade && (
              <div className="c-banner" style={{ marginTop: 16 }}>
                {s.trade.status === "requested" ? `${s.trade.title} 판매자에게 물어보는 중이에요` : `${s.trade.title} 확정. 경유지가 들어갔어요`}
              </div>
            )}
            <p className="c-note" style={{ marginTop: 18 }}>
              출발하면 이 화면은 닫히고 음성 알림으로 바뀌어요.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const KEYWORD_SUGGEST = ["카시트", "유모차", "아기 침대", "캠핑의자", "캠핑 테이블", "텐트", "자전거", "책상", "모니터"];

function InterestsSheet({ s, c, close }: { s: CarState; c: CarController; close: () => void }) {
  const [kw, setKw] = useState("");
  const [lvl, setLvl] = useState<GoLevel>("likely");
  const st = s.settings;
  return (
    <div className="c-sheet" data-testid="sheet-interests">
      <Head title="관심사" sub="키워드나 찜한 매물마다 얼마나 돌아갈 수 있는지 정해요" onClose={close} />
      <div className="c-sheet-body">
        {s.interests.map((it) => (
          <div className="c-row" key={it.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
            <div>
              <div className="c-row-title">{it.type === "keyword" ? it.keyword : "찜한 매물"}</div>
              <div className="c-row-meta">{it.type === "keyword" ? "키워드" : "찜"}</div>
            </div>
            <div className="c-seg" role="radiogroup" aria-label="GO 등급">
              {(["must", "likely", "near"] as GoLevel[]).map((g) => (
                <button key={g} className={it.goLevel === g ? "on" : ""} role="radio" aria-checked={it.goLevel === g} onClick={() => it.keyword && void c.addInterest(it.keyword, g)}>
                  {GO_KO[g]}
                </button>
              ))}
            </div>
            <button className="c-btn" onClick={() => void c.removeInterest(it.id)}>
              지우기
            </button>
          </div>
        ))}
        <div className="c-sub">키워드 더하기</div>
        <div className="c-field">
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="예: 캠핑 테이블" aria-label="키워드" />
          <div className="c-seg">
            {(["must", "likely", "near"] as GoLevel[]).map((g) => (
              <button key={g} className={lvl === g ? "on" : ""} onClick={() => setLvl(g)}>
                {GO_KO[g]}
              </button>
            ))}
          </div>
          <button
            className="c-btn primary"
            disabled={!kw.trim()}
            onClick={() => {
              void c.addInterest(kw.trim(), lvl);
              setKw("");
            }}
          >
            더하기
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {KEYWORD_SUGGEST.filter((k) => !s.interests.some((i) => i.keyword === k)).map((k) => (
            <button key={k} className="c-btn" onClick={() => setKw(k)}>
              {k}
            </button>
          ))}
        </div>
        {st && (
          <>
            <div className="c-sub">등급별 최대 우회 시간</div>
            {(["must", "likely", "near"] as GoLevel[]).map((g) => (
              <div className="c-field" key={g}>
                <span style={{ width: 140 }}>{GO_KO[g]}</span>
                <button className="c-btn" onClick={() => void c.saveSettings({ maxDetourMin: { ...st.maxDetourMin, [g]: Math.max(1, st.maxDetourMin[g] - (g === "near" ? 1 : 5)) } })}>
                  줄이기
                </button>
                <span style={{ fontFamily: "var(--font-sign)", fontSize: 28, width: 70, textAlign: "center" }}>{st.maxDetourMin[g]}분</span>
                <button className="c-btn" onClick={() => void c.saveSettings({ maxDetourMin: { ...st.maxDetourMin, [g]: st.maxDetourMin[g] + (g === "near" ? 1 : 5) } })}>
                  늘리기
                </button>
              </div>
            ))}
            <div className="c-field">
              <span style={{ width: 140 }}>도착 배터리 최소</span>
              <button className="c-btn" onClick={() => void c.saveSettings({ minArrivalSocPct: st.minArrivalSocPct - 5 })}>
                줄이기
              </button>
              <span style={{ fontFamily: "var(--font-sign)", fontSize: 28, width: 70, textAlign: "center" }}>{st.minArrivalSocPct}%</span>
              <button className="c-btn" onClick={() => void c.saveSettings({ minArrivalSocPct: st.minArrivalSocPct + 5 })}>
                늘리기
              </button>
            </div>
          </>
        )}
        <div className="c-sub">차종</div>
        <p className="c-note">
          {s.vehicle ? `${s.vehicle.model} — 트렁크 ${s.vehicle.trunk.w}×${s.vehicle.trunk.d}×${s.vehicle.trunk.h}cm, 2열 접으면 깊이 ${s.vehicle.folded.d}cm (추정치)` : "차종 정보가 없어요"}
        </p>
        <button className="c-btn" onClick={() => c.open("vehicle")}>
          차종 바꾸기
        </button>
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
        {s.loadedPrompt && <div className="c-banner kraft">트렁크를 닫았어요. 실으셨나요?</div>}
        {t.handedAt && <div className="c-banner">판매자가 건넸다고 표시했어요. 확인되면 받았어요를 눌러 주세요.</div>}
        <div className="c-inspect-grid">
          <div>{t.photos[0] ? <img className="c-photo" src={t.photos[0]} alt={t.title} /> : <div className="c-photo" />}</div>
          <div>
            <div className="c-row-title" style={{ fontSize: 22 }}>
              {t.title}
            </div>
            <p className="c-note">
              {t.sizeCm ? `등록 크기 ${t.sizeCm.w}×${t.sizeCm.d}×${t.sizeCm.h}cm` : ""}
              <br />
              {t.condition ? CONDITION_KO[t.condition] : ""}
              <br />
              {fmtWon(t.price)}은 보관 중이에요. 받았어요를 누르면 이의 제기 기간 뒤 판매자에게 정산돼요.
            </p>
          </div>
        </div>
        {!declining ? (
          <div className="c-big-actions">
            <button className="c-yes" style={{ background: "var(--kraft)", color: "var(--ink)" }} onClick={() => void c.received()}>
              받았어요
            </button>
            <button style={{ background: "#222d3c", color: "#e8edf3" }} onClick={() => setDeclining(true)}>
              안 살게요
            </button>
          </div>
        ) : (
          <>
            <div className="c-sub">등록 정보와 무엇이 다른가요?</div>
            <p className="c-note">고르면 거래가 끝나고 대금은 전액 환불돼요. 판매자 신뢰도에 반영돼요.</p>
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
              <div className="c-result-num">{first.separateTripMin ?? "-"}분</div>
            </div>
            <div>
              <span>실제로 늘어난 시간</span>
              <div className="c-result-num">{r.addedMin ?? first.detourMin}분</div>
            </div>
            <div>
              <span>더 달린 거리</span>
              <div className="c-result-num">{r.extraKm ?? "-"}km</div>
            </div>
          </div>
        )}
        {r.notes.map((n) => (
          <div className="c-banner" key={n}>
            {n}
          </div>
        ))}
        <p className="c-note">더 달린 거리는 주행거리계(Odometer) 차이로 쟀어요. 따로 다녀왔다면 걸렸을 시간은 집에서 판매자까지 왕복 경로로 계산했어요.</p>
        <button className="c-btn primary" onClick={() => c.dismissResult()}>
          닫기
        </button>
      </div>
    </div>
  );
}

function VehicleSheet({ c, close }: { c: CarController; close: () => void }) {
  return (
    <div className="c-sheet" data-testid="sheet-vehicle">
      <Head title="차종을 골라 주세요" sub="차 정보(CarInfo)에 모델명이 없을 때 한 번만 물어요. 트렁크에 실을 수 있는지 판단하는 데 써요." onClose={close} />
      <div className="c-sheet-body">
        <div className="c-dest">
          {VEHICLE_TABLE.map((v) => (
            <button key={v.model} onClick={() => void c.pickVehicle(v.model)}>
              <b>{v.model}</b>
              <span>
                트렁크 {v.trunk.w}×{v.trunk.d}×{v.trunk.h}cm
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
