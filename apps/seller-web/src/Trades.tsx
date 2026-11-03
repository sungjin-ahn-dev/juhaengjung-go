/** 판매자 '거래'(진행 중·지난 거래·구매자 평가)와 '정산'(보관·정산·환불과 내역) */
import { kstClock, kstParts } from "@jhgo/core";
import { Icon, Stars } from "./kit.tsx";
import { STATUS_KO, minutesLeft, won, type Catalog, type SellerTrade, type Summary } from "./types.ts";

type Act = (id: string, a: string, b?: unknown) => Promise<boolean>;

const STEPS = ["수락", "오는 중", "곧 도착", "도착", "건넴", "정산"];
function stepOf(t: SellerTrade) {
  if (t.status === "settled") return 6;
  if (t.status === "completed") return 5;
  if (t.status === "arrived") return t.handedAt ? 5 : 3;
  if (t.handedAt) return 4;
  if (t.comeOutSentAt) return 2;
  return 1;
}

export function LiveTrade({ t, now, act, cfg, onOpenHandoff }: { t: SellerTrade; now: number; act: Act; cfg?: Catalog["tradeConfig"]; onOpenHandoff: () => void }) {
  const step = stepOf(t);
  const m = minutesLeft(t.etaAt, now);
  const live = ["accepted", "arrived"].includes(t.status);
  return (
    <article className={`s-trade ${live ? "live" : ""}`} data-testid="active-trade">
      <div className="s-trade-head">
        <b>{t.title}</b>
        <span className={`s-badge ${live ? "reserved" : "go"}`}>{STATUS_KO[t.status]}</span>
      </div>
      {t.status === "accepted" && !t.handedAt && (
        <div className="s-trade-eta">
          <span className="s-eta-num">{m !== null && m > 0 ? m : "곧"}</span>
          {m !== null && m > 0 && <span className="s-eta-unit">분 뒤 도착</span>}
          <span className="s-eta-sub">
            {t.etaAt ? `${kstClock(t.etaAt)} 도착 예정, ` : ""}
            {t.vehicleModel}, {t.buyer?.name}
          </span>
        </div>
      )}
      {t.status === "arrived" && !t.handedAt && (
        <p className="s-trade-line strong">
          구매자가 도착했어요
          <small>
            {t.vehicleModel}, 도착한 지 {t.arrivedAt ? Math.max(0, Math.floor((now - t.arrivedAt) / 60000)) : 0}분. {cfg?.sellerWaitMin ?? 5}분이 지나도 만나지 못하면 구매자가 거래를 끝낼 수 있어요.
          </small>
        </p>
      )}
      {t.handedAt && t.status !== "completed" && <p className="s-trade-line">건넸어요. 구매자가 확인하면 정산을 시작해요. 확인이 없으면 {cfg?.autoConfirmMin ?? 30}분 뒤 자동으로 확인돼요.</p>}
      {t.status === "completed" && (
        <p className="s-trade-line">
          구매자가 받았어요. {t.settleAt ? `${kstClock(t.settleAt)}에 ` : ""}
          {won(t.price)}이 정산돼요.
        </p>
      )}
      <ol className="s-track" aria-label="거래 단계">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
            <i />
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {live && !t.handedAt && (
        <div className="s-trade-actions">
          {t.sellerComingAt ? (
            <span className="s-done-line">
              <Icon name="check" size={17} stroke={2.4} /> 나간다고 알렸어요
            </span>
          ) : (
            <button className="s-btn" onClick={() => void act(t.id, "coming")} data-testid="coming-inline">
              지금 나가요
            </button>
          )}
          <button className="s-btn primary" onClick={() => void act(t.id, "handed")} data-testid="handed-inline">
            건넸어요
          </button>
        </div>
      )}
      {live && !t.handedAt && (t.comeOutSentAt || t.status === "arrived") && (
        <button className="s-link-btn" style={{ marginTop: 6 }} onClick={onOpenHandoff}>
          크게 보기
        </button>
      )}
    </article>
  );
}

export function dateText(ms: number) {
  const p = kstParts(ms);
  return `${p.month}월 ${p.day}일 ${kstClock(ms)}`;
}

const BAD = ["declined_mismatch", "seller_no_show", "canceled", "no_show", "expired", "declined"];

export function PastTrades({ trades, act }: { trades: SellerTrade[]; act: Act }) {
  return (
    <section className="s-section">
      <div className="s-section-head">
        <h2>
          지난 거래<span>{trades.length}</span>
        </h2>
      </div>
      {trades.length === 0 && <div className="s-empty">아직 없어요</div>}
      {trades.map((t) => (
        <div className="s-past" key={t.id}>
          {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <span className="s-thumb" />}
          <div>
            <div className="s-past-head">
              <b>{t.title}</b>
              <span>{won(t.price)}</span>
            </div>
            <div className="s-past-meta">
              <span className={`s-badge ${t.status === "settled" ? "go" : BAD.includes(t.status) ? "" : "reserved"}`}>{STATUS_KO[t.status] ?? t.status}</span>
              <span>{dateText(t.createdAt)}</span>
            </div>
            {(t.mismatch || (t.reason && t.status !== "settled")) && <div className="s-past-meta">{t.mismatch?.reason ?? t.reason}</div>}
            {(t.status === "settled" || t.status === "completed") &&
              (t.ratings.sellerToBuyer ? (
                <div className="s-past-meta">
                  구매자 {t.buyer?.name}님께 {t.ratings.sellerToBuyer}점을 남겼어요
                </div>
              ) : (
                <div className="s-rate">
                  <span>구매자 {t.buyer?.name}님은 어땠나요?</span>
                  <Stars label="구매자 평가" onRate={(n) => void act(t.id, "rate", { stars: n })} />
                </div>
              ))}
            {t.ratings.buyerToSeller && <div className="s-past-meta">구매자가 남긴 평가 {t.ratings.buyerToSeller}점</div>}
            {t.mismatch?.photos?.length ? (
              <div className="s-evidence" aria-label="구매자가 남긴 현장 사진">
                {t.mismatch.photos.map((p, i) => (
                  <img key={i} src={p} alt={`현장 사진 ${i + 1}`} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

export function Money({ summary }: { summary: Summary | null }) {
  const L: Record<string, string> = { hold: "대금 보관", capture: "정산", refund: "환불" };
  if (!summary) return null;
  return (
    <>
      <div className="s-money" data-testid="money">
        <div className="s-money-main">
          <span>정산 완료</span>
          <b>{won(summary.settled)}</b>
        </div>
        <div className="s-money-row">
          <div>
            <span>보관 중</span>
            <b>{won(summary.held)}</b>
          </div>
          <div>
            <span>환불</span>
            <b>{won(summary.refunded)}</b>
          </div>
        </div>
      </div>
      <p className="s-money-note">
        {summary.nextSettleAt ? `다음 정산은 ${kstClock(summary.nextSettleAt)}이에요. ` : ""}대금은 결제 대행사(PG)에 보관됐다가, 구매자가 받고 이의 제기 기간이 지나면 정산돼요. 지금은 시연용 원장이에요.
      </p>
      <div className="s-band" style={{ marginTop: 22 }} />
      <section className="s-section">
        <div className="s-section-head">
          <h2>내역</h2>
        </div>
        {summary.ledger.length === 0 && <div className="s-empty">아직 없어요</div>}
        {summary.ledger.map((r) => (
          <div className="s-ledger" key={r.id}>
            <span className="s-ledger-title">{r.title || "거래"}</span>
            <span className={`s-ledger-amt ${r.action === "capture" ? "plus" : r.action === "refund" ? "minus" : ""}`}>
              {r.action === "capture" ? "+" : ""}
              {won(r.amount)}
              <small>{L[r.action] ?? r.action}</small>
            </span>
            <span className="s-ledger-sub">{dateText(r.at)}</span>
          </div>
        ))}
      </section>
    </>
  );
}
