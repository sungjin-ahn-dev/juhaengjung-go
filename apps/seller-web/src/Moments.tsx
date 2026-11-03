/**
 * 판매자 폰의 두 순간 — 화면 전체를 크라프트로 덮는다.
 *  1) 요청: 차가 들르겠다고 한다 → 수락/거절(T9·T10), 오늘은 그만 받기(T27)
 *  2) 만남: 곧 도착·도착·기다림 → 지금 나가요(T28), 건넸어요(T11·T12)
 */
import { useState } from "react";
import { kstClock } from "@jhgo/core";
import { Icon, Mark } from "./kit.tsx";
import { won, type Catalog, type SellerTrade } from "./types.ts";

type Act = (id: string, a: string, b?: unknown) => Promise<boolean>;

function Item({ t }: { t: SellerTrade }) {
  return (
    <div className="s-moment-item">
      {t.photos[0] ? <img src={t.photos[0]} alt="" /> : <div className="s-thumb" />}
      <div>
        <b>{t.title}</b>
        <span>{won(t.price)}</span>
      </div>
    </div>
  );
}

export function Takeover({ t, now, act, onPauseToday }: { t: SellerTrade; now: number; act: Act; onPauseToday: () => Promise<void> }) {
  const total = Math.max(1, t.expiresAt - t.createdAt);
  const left = Math.max(0, t.expiresAt - now);
  const mins = t.etaAt ? Math.max(1, Math.round((t.etaAt - now) / 60000)) : null;
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="s-moment" role="alertdialog" aria-label="구매 요청" data-testid="takeover">
      <div className="s-moment-inner">
        <div className="s-moment-top">
          <Mark />
        </div>
        <Item t={t} />
        <div className="s-moment-title">사러 오는 차가 있어요</div>
        <div className="s-moment-big">
          {mins !== null ? (
            <>
              {mins}
              <small>분 뒤</small>
            </>
          ) : (
            "곧"
          )}
        </div>
        <div className="s-moment-sub">{t.etaAt ? `${kstClock(t.etaAt)} 도착 예정` : ""}</div>
        <dl className="s-facts">
          <div>
            <dt>차</dt>
            <dd>{t.vehicleModel}</dd>
          </div>
          <div>
            <dt>실을 수 있나요</dt>
            <dd>{t.fitLabel}</dd>
          </div>
          <div>
            <dt>구매자</dt>
            <dd>
              {t.buyer?.name}, 거래 {t.buyer?.completed ?? 0}회{t.buyer?.noShow ? `, 노쇼 ${t.buyer.noShow}회` : ""}
            </dd>
          </div>
          <div>
            <dt>장소</dt>
            <dd>{t.pickupPoint?.label}</dd>
          </div>
        </dl>
        <p className="s-moment-note">수락하면 {won(t.price)}이 바로 보관돼요. 흥정 없이 이 가격 그대로예요.</p>
        <div className="s-timer" aria-hidden="true">
          <i style={{ transform: `scaleX(${left / total})` }} />
        </div>
        <div className="s-timer-text">
          {mm}:{ss} 안에 답해 주세요. 구매자가 갈림길을 지나면 요청이 끝나요
        </div>
        <div className="s-moment-actions">
          <button className="s-moment-primary" disabled={busy} onClick={() => void run(() => act(t.id, "accept"))} data-testid="accept">
            수락
          </button>
          <button className="s-moment-secondary" disabled={busy} onClick={() => void run(() => act(t.id, "decline", { reason: "지금은 어려워요" }))} data-testid="decline">
            이번엔 어려워요
          </button>
          <button
            className="s-moment-link"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (await act(t.id, "decline", { reason: "오늘은 거래가 어려워요" })) await onPauseToday();
              })
            }
            data-testid="decline-pause"
          >
            오늘은 그만 받을래요
          </button>
        </div>
      </div>
    </div>
  );
}

/** 만남 단계 */
export function handoffStage(t: SellerTrade): "soon" | "arrived" | "waiting" | "handed" | null {
  if (!["accepted", "arrived"].includes(t.status)) return null;
  if (t.handedAt) return "handed";
  if (t.status === "arrived") return t.nudgedAt ? "waiting" : "arrived";
  if (t.comeOutSentAt) return "soon";
  return null;
}

export function Handoff({ t, now, act, cfg, onMinimize }: { t: SellerTrade; now: number; act: Act; cfg?: Catalog["tradeConfig"]; onMinimize: () => void }) {
  const stage = handoffStage(t);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!stage) return null;
  const mins = t.etaAt ? Math.max(0, Math.round((t.etaAt - now) / 60000)) : null;
  // 도착 뒤에는 '구매자가 거래를 끝낼 수 있게 되는 때'까지 남은 시간을 크게
  const waitMin = cfg?.sellerWaitMin ?? 5;
  const leftMs = t.arrivedAt ? t.arrivedAt + waitMin * 60000 - now : null;
  const left = leftMs !== null && leftMs > 0 ? `${Math.floor(leftMs / 60000)}:${String(Math.floor((leftMs % 60000) / 1000)).padStart(2, "0")}` : null;
  const head =
    stage === "soon"
      ? { title: "곧 도착해요", lede: "물건을 들고 나와 주세요" }
      : stage === "arrived"
        ? { title: "구매자가 도착했어요", lede: "물건을 건네 주세요" }
        : stage === "waiting"
          ? { title: "구매자가 기다리고 있어요", lede: "물건을 들고 나와 주세요" }
          : { title: "건넸어요", lede: `구매자가 확인하면 정산을 시작해요. 확인이 없으면 ${cfg?.autoConfirmMin ?? 30}분 뒤 자동으로 확인돼요.` };
  return (
    <div className={`s-moment ${stage === "waiting" ? "urgent" : ""} ${stage === "handed" ? "calm" : ""}`} role="dialog" aria-label={head.title} data-testid="handoff">
      <div className="s-moment-inner">
        <div className="s-moment-top">
          <Mark />
          <button className="s-moment-min" onClick={onMinimize} data-testid="handoff-min">
            작게 보기
          </button>
        </div>
        <Item t={t} />
        <div className="s-moment-title">{head.title}</div>
        <div className="s-moment-lede">{head.lede}</div>
        {stage === "soon" && (
          <div className="s-moment-big">
            {mins !== null && mins > 0 ? (
              <>
                {mins}
                <small>분 뒤</small>
              </>
            ) : (
              "지금"
            )}
          </div>
        )}
        {(stage === "arrived" || stage === "waiting") && (
          <div className="s-moment-big stack" data-testid="handoff-left">
            {left ?? "지금"}
            <small>{left ? "안에 나가 주세요" : "바로 나가 주세요"}</small>
          </div>
        )}
        {stage !== "handed" && (
          <dl className="s-facts">
            <div>
              <dt>차</dt>
              <dd>{t.vehicleModel}</dd>
            </div>
            <div>
              <dt>장소</dt>
              <dd>{t.pickupPoint?.label}</dd>
            </div>
            <div>
              <dt>구매자</dt>
              <dd>{t.buyer?.name}</dd>
            </div>
          </dl>
        )}
        {(stage === "arrived" || stage === "waiting") && (
          <p className="s-moment-note" data-testid="arrived-wait">
            {left ? `구매자가 도착하고 ${waitMin}분 안에 만나지 못하면 구매자가 거래를 끝낼 수 있어요. 그러면 대금은 구매자에게 돌아가요.` : `구매자가 ${waitMin}분 넘게 기다렸어요. 지금은 구매자가 거래를 끝낼 수 있어요.`}
          </p>
        )}
        {!confirmCancel ? (
          <div className="s-moment-actions">
            {stage !== "handed" &&
              (t.sellerComingAt ? (
                <div className="s-moment-done" data-testid="coming-done">
                  <Icon name="check" stroke={2.4} /> 나간다고 알렸어요
                </div>
              ) : (
                <button className="s-moment-secondary" onClick={() => void act(t.id, "coming")} data-testid="coming">
                  지금 나가요
                </button>
              ))}
            {stage !== "handed" ? (
              <button className="s-moment-primary" onClick={() => void act(t.id, "handed")} data-testid="handed">
                건넸어요
              </button>
            ) : (
              <button className="s-moment-primary" onClick={onMinimize}>
                확인
              </button>
            )}
            {stage !== "handed" && (
              <button className="s-moment-link" onClick={() => setConfirmCancel(true)}>
                거래 취소
              </button>
            )}
          </div>
        ) : (
          <div className="s-moment-actions">
            <p className="s-moment-note">취소하면 대금은 구매자에게 돌아가고, 판매자 신뢰도에 남아요.</p>
            <button className="s-moment-secondary" onClick={() => void act(t.id, "cancel", { reason: "판매자 사정" })}>
              취소할게요
            </button>
            <button className="s-moment-primary" onClick={() => setConfirmCancel(false)}>
              돌아가기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
