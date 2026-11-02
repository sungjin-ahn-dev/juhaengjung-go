/** 오른쪽 주행중GO! 패널 — 감시 상태, 알림(유일하게 눈에 띄는 카드), 경합 질문, 거래 진행 */
import { useEffect, useState } from "react";
import type { CarController, CarState, CandidateView, TradeView } from "../controller.ts";
import { fmtClock, fmtWon } from "./format.ts";

export function GoPanel({ s, c, now }: { s: CarState; c: CarController; now: number }) {
  return (
    <div className="c-go">
      {s.fragilePrompt && (
        <div className="c-fragile">
          <div style={{ fontSize: 19, marginBottom: 12 }}>깨지기 쉬운 물건을 실었어요. 편안한 길로 바꿀까요?</div>
          <div className="c-trade-actions">
            <button className="c-btn primary" onClick={() => void c.comfortable(true)}>
              편안한 길로
            </button>
            <button className="c-btn" onClick={() => void c.comfortable(false)}>
              지금 길 그대로
            </button>
          </div>
        </div>
      )}
      {s.trade ? <TradeCard t={s.trade} c={c} now={now} restricted={s.restricted} /> : s.alert ? <AlertCard s={s} c={c} /> : <WatchCard s={s} />}
    </div>
  );
}

function WatchCard({ s }: { s: CarState }) {
  if (s.mode === "idle") {
    return (
      <div className="c-watch">
        <div className="c-watch-count">{s.interests.length}</div>
        <div className="c-watch-text">
          관심사 {s.interests.length}개
          <small>목적지를 정하면 길 위의 매물을 찾아요</small>
        </div>
      </div>
    );
  }
  const next = s.candidates
    .filter((x) => x.exclusions.length === 0 && x.timeToBranchS !== null && x.timeToBranchS > 0)
    .sort((a, b) => (a.timeToBranchS ?? 0) - (b.timeToBranchS ?? 0))[0];
  return (
    <div className="c-watch" data-testid="watch">
      <div className="c-watch-count">{s.watching}</div>
      <div className="c-watch-text">
        {s.mode === "route" ? "이번 길의 관심 매물" : "근처 관심 매물"}
        <small>{next ? `다음 갈림길: ${next.categoryLabel}, 약 ${Math.max(1, Math.round((next.timeToBranchS ?? 0) / 60))}분 뒤` : "알릴 때가 되면 한 번에 하나씩 말할게요"}</small>
        {s.holdNote && <div className="c-hold">{s.holdNote}</div>}
      </div>
    </div>
  );
}

function AlertCard({ s, c }: { s: CarState; c: CarController }) {
  const a = s.alert!;
  const [left, setLeft] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, 1 - (Date.now() - a.shownAt) / 15000)), 100);
    return () => clearInterval(id);
  }, [a.shownAt]);
  if (a.kind === "contention") {
    return (
      <div className="c-alert" role="alertdialog" aria-label="어느 쪽에 들를까요" data-testid="contention">
        <div className="c-alert-item" style={{ fontSize: 40 }}>
          오늘은 어느 쪽?
        </div>
        <div className="c-alert-title">비슷한 매물이 가까이 있어요. 하나만 고르세요.</div>
        <div className="c-choice">
          {a.pair.map((x) => (
            <button key={x.listingId} onClick={() => c.choose(x.listingId)}>
              <b>{x.categoryLabel}</b>
              <span>
                {x.detourMin}분 더, {x.fit.label}
              </span>
            </button>
          ))}
        </div>
        {a.listening && <div className="c-listening">듣고 있어요</div>}
        <div className="c-timer">
          <i style={{ transform: `scaleX(${left})` }} />
        </div>
      </div>
    );
  }
  const x = a.c;
  const cheaper = x.referencePrice - x.price;
  return (
    <div className="c-alert" role="alertdialog" aria-label={x.speech} data-testid="alert">
      <div className="c-alert-head">
        <div className="c-alert-item">{x.categoryLabel}</div>
        <div className="c-alert-detour">{s.mode === "region" ? `여기서 ${x.detourMin}분` : `${x.detourMin}분 더`}</div>
      </div>
      <div className="c-alert-title">{x.title}</div>
      <div className="c-facts">
        <span className="c-fact">{x.fit.label}</span>
        <span className="c-fact">{cheaper > 0 ? `기준가보다 ${fmtWon(cheaper)} 싸요` : fmtWon(x.price)}</span>
        {x.energy.arrivalSocPct !== undefined && <span className="c-fact">도착 배터리 {Math.round(x.energy.arrivalSocPct)}%</span>}
      </div>
      <div className="c-answer">
        <button className="c-yes" onClick={() => void c.answer(true)}>
          들를게요
        </button>
        <button className="c-no" onClick={() => void c.answer(false)}>
          아니요
        </button>
      </div>
      {a.listening && <div className="c-listening">"응" 또는 "아니"라고 말해 주세요</div>}
      <div className="c-timer">
        <i style={{ transform: `scaleX(${left})` }} />
      </div>
    </div>
  );
}

const STEP_LABEL = ["판매자 응답", "확정 · 경유지 추가", "가는 중", "도착", "건넴 확인"];

function stepIndex(t: TradeView): number {
  if (t.status === "requested") return 0;
  if (t.status === "accepted" && !t.waypointConfirmedAt) return 1;
  if (t.status === "accepted") return 2;
  if (t.status === "arrived") return 3;
  return 4;
}

function TradeCard({ t, c, now, restricted }: { t: TradeView; c: CarController; now: number; restricted: boolean }) {
  const idx = stepIndex(t);
  const right = (i: number) => {
    if (i === 0 && t.status === "requested") {
      const m = Math.max(0, Math.round((t.expiresAt - now) / 60000));
      return <em>{m}분 안에</em>;
    }
    if (i === 2 && t.etaAt) return <em>{fmtClock(t.etaAt)}</em>;
    if (i === 1 && t.autoAccepted) return <span style={{ fontSize: 14 }}>자동 수락</span>;
    return null;
  };
  return (
    <div className="c-trade" data-testid="trade">
      <div className="c-trade-head">
        <div className="c-trade-item">{t.title.length > 12 ? t.title.slice(0, 12) + "…" : t.title}</div>
        <div className="c-trade-price">
          {fmtWon(t.price)} {t.payment.status === "held" ? "보관 중" : ""}
        </div>
      </div>
      <ol className="c-steps">
        {STEP_LABEL.map((l, i) => (
          <li key={l} className={i < idx ? "done" : i === idx ? "now" : ""}>
            <i />
            <span>{l}</span>
            {right(i)}
          </li>
        ))}
      </ol>
      {t.status === "arrived" && restricted && <div className="c-note">정차하면 물건 확인 화면이 열려요</div>}
      <div className="c-trade-actions">
        {t.status === "arrived" && !restricted && (
          <button className="c-btn kraft" onClick={() => c.open("inspect")}>
            물건 확인
          </button>
        )}
        {["requested", "accepted"].includes(t.status) && (
          <button className="c-btn" onClick={() => void c.cancelTrade()}>
            이번엔 안 들를게요
          </button>
        )}
      </div>
    </div>
  );
}

export function candidateTitle(x: CandidateView) {
  return x.title;
}
