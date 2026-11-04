/** 오른쪽 열 아래 카드 — 알림(이 화면에서 유일하게 눈에 띄는 카드), 경합 질문, 거래 진행, 편안한 길 제안. 감시 상태는 추천 목록 머리말이 맡는다 */
import { useEffect, useState } from "react";
import { categoryLabel } from "@jhgo/core";
import { Check } from "lucide-react";
import type { CarController, CarState, TradeView } from "../controller.ts";
import { CONDITION_KO, fmtClock, fmtWon } from "./format.ts";

export function GoPanel({ s, c, now }: { s: CarState; c: CarController; now: number }) {
  return (
    <div className="c-go">
      {s.fragilePrompt && (
        <div className="c-fragile c-card">
          <div style={{ fontSize: 19, fontWeight: 650, marginBottom: 12 }}>깨지기 쉬운 물건을 실었어요. 편안한 길로 바꿀까요?</div>
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
      {s.trade ? <TradeCard t={s.trade} c={c} now={now} restricted={s.restricted} /> : s.alert ? <AlertCard s={s} c={c} /> : null}
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
      <div className={`c-alert ${a.listening ? "listening" : ""}`} role="alertdialog" aria-label="어느 쪽에 들를까요" data-testid="contention">
        <div className="c-alert-item" style={{ fontSize: 34 }}>
          오늘은 어느 쪽?
        </div>
        <div className="c-alert-title">비슷한 매물이 가까이 있어요. 하나만 고르세요.</div>
        <div className="c-choice">
          {a.pair.map((x) => (
            <button key={x.listingId} onClick={() => c.choose(x.listingId)}>
              {x.photo && <img src={x.photo} alt="" />}
              <b>{x.categoryLabel}</b>
              <span>
                {x.detourMin}분 더, {x.fit.label}
              </span>
            </button>
          ))}
        </div>
        <div className="c-timer">
          <i style={{ transform: `scaleX(${left})` }} />
        </div>
      </div>
    );
  }
  const x = a.c;
  const cheaper = x.referencePrice - x.price;
  return (
    <div className={`c-alert ${a.listening ? "listening" : ""}`} role="alertdialog" aria-label={x.speech} data-testid="alert">
      <div className="c-alert-head">
        {x.photo ? <img src={x.photo} alt="" /> : <div className="c-alert-ph" />}
        <div style={{ minWidth: 0 }}>
          <div className="c-alert-item">{x.categoryLabel}</div>
          <div className="c-alert-title">{x.title}</div>
        </div>
        <div className="c-alert-detour">
          {s.mode === "region" ? `${x.detourMin}분` : `+${x.detourMin}분`}
          <small>{s.mode === "region" ? "여기서" : "더 걸려요"}</small>
        </div>
      </div>
      <div className="c-facts">
        <span className={`c-fact ${x.fit.kind === "trunk" ? "good" : ""}`}>{x.fit.label}</span>
        <span className="c-fact">{cheaper > 0 ? `기준가보다 ${fmtWon(cheaper)} 싸요` : fmtWon(x.price)}</span>
        {x.energy.arrivalSocPct !== undefined && <span className="c-fact">도착 배터리 {Math.round(x.energy.arrivalSocPct)}%</span>}
        {/* 사진에서 본 상태(T33): AI가 봤을 때만 '사진:'이라고 쓴다 */}
        {x.brief?.condition.photoChecked ? (
          <span className={`c-fact ${x.brief.condition.findings.length ? "" : "good"}`}>사진: {x.brief.condition.findings[0] ?? "흠집 안 보임"}</span>
        ) : x.condition ? (
          <span className="c-fact">{CONDITION_KO[x.condition]}(판매자 표시)</span>
        ) : null}
      </div>
      <div className="c-answer">
        <button className="c-yes" onClick={() => void c.answer(true)}>
          들를게요
        </button>
        <button className="c-no" onClick={() => void c.answer(false)}>
          아니요
        </button>
      </div>
      <div className="c-timer">
        <i style={{ transform: `scaleX(${left})` }} />
      </div>
    </div>
  );
}

const STEP_LABEL = ["판매자 응답", "확정, 경유지 추가", "가는 중", "도착", "건넴 확인"];

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
    <div className="c-trade c-card" data-testid="trade">
      <div className="c-trade-head">
        {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <div className="c-trade-ph" />}
        <div style={{ minWidth: 0 }}>
          <div className="c-trade-item">{categoryLabel(t.category)}</div>
          <div className="c-trade-title">{t.title}</div>
        </div>
        <div className="c-trade-price">
          {fmtWon(t.price)}
          <small>{t.payment.status === "held" ? "보관 중" : t.status === "requested" ? "수락하면 보관" : ""}</small>
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
      {t.sellerComingAt && !t.handedAt && ["accepted", "arrived"].includes(t.status) && (
        <div className="c-coming-line" data-testid="trade-seller-coming">
          <Check size={18} strokeWidth={2.6} aria-hidden="true" /> 판매자가 나오고 있어요
        </div>
      )}
      {t.status === "arrived" && restricted && <div className="c-note">정차하면 물건 확인 화면이 열려요</div>}
      <div className="c-trade-actions">
        {t.status === "arrived" && !restricted && (
          <button className="c-btn kraft lg" onClick={() => c.open("inspect")}>
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

export function candidateTitle(x: { title: string }) {
  return x.title;
}
