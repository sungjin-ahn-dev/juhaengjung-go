/**
 * 판매자 '내 물건' — 지금 요청을 받는지 한 문장, 진행 중 거래, 알림 받기, 물건마다 지나간 차 수(T29).
 * 물건을 누르면 가격·시간·바로 확정·판매 완료를 그 자리에서 바꾼다(되돌리기 있음).
 */
import { useState } from "react";
import { describeAvailability, isAvailableAt, josa, kstClock, kstParts, nextAvailableAt, pauseActive } from "@jhgo/core";
import type { PushState } from "./push.ts";
import { Icon, Sheet, Toggle } from "./kit.tsx";
import { LISTING_KO, PRESETS, SIZE_SOURCE_KO, minutesLeft, presetOf, won, type Me, type SellerListing, type SellerTrade, type Summary } from "./types.ts";

/** 오늘·내일·날짜 */
export function dayWord(at: number, now: number): string {
  const a = kstParts(at);
  const n = kstParts(now);
  const days = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(n.year, n.month - 1, n.day)) / 86400000);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  return `${a.month}월 ${a.day}일(${"일월화수목금토"[a.dow]})`;
}

export function untilText(until: number, now: number): string {
  if (kstClock(until) === "00:00" && dayWord(until, now) === "내일") return "오늘 자정까지";
  return `${dayWord(until, now)} ${kstClock(until)}까지`;
}

export type Receiving = { kind: "on" | "off" | "paused" | "empty"; title: string; sub: string };

export function receivingOf(me: Me, listings: SellerListing[], now: number): Receiving {
  const active = listings.filter((l) => l.status === "active");
  if (pauseActive(me.pause, now))
    return { kind: "paused", title: "쉬는 중이에요", sub: me.pause?.until ? `${untilText(me.pause.until, now)} 지나가는 차에 보이지 않아요` : "다시 켤 때까지 지나가는 차에 보이지 않아요" };
  if (active.length === 0) return { kind: "empty", title: "첫 물건을 올려 볼까요?", sub: "다른 앱에 쓴 글을 붙여 넣으면 끝나요" };
  const inWindow = active.filter((l) => isAvailableAt(l.availability, now));
  if (inWindow.length) return { kind: "on", title: "지금 요청을 받고 있어요", sub: `${describeAvailability(inWindow[0].availability)}, 판매 중 ${active.length}개` };
  const next = active
    .map((l) => nextAvailableAt(l.availability, now))
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b)[0];
  return next
    ? { kind: "off", title: `${dayWord(next, now)} ${kstClock(next)}부터 요청을 받아요`, sub: "지금은 거래할 시간이 아니에요" }
    : { kind: "off", title: "거래할 시간을 정해 주세요", sub: "정한 시간에만 지나가는 차에 보여요" };
}

export function Hero({ me, r, summary, onPause, onResume }: { me: Me; r: Receiving; summary: Summary | null; onPause: () => void; onResume: () => void }) {
  const t = summary?.trust;
  return (
    <section className="s-hero" data-testid="status">
      <div className="s-hello">{me.name}님</div>
      <h1>
        {r.title}
        {(r.kind === "on" || r.kind === "paused") && <span className={`s-pulse ${r.kind === "paused" ? "off" : ""}`} aria-hidden="true" />}
      </h1>
      <p className="s-hero-sub">{r.sub}</p>
      {t && (t.completed > 0 || t.rating !== null || t.responseRate !== null) && (
        <div className="s-trust s-num">
          {t.rating !== null && (
            <span>
              <Icon name="star" size={15} stroke={2.2} />
              평점 <b>{t.rating}</b>
            </span>
          )}
          <span>
            거래 <b>{t.completed}회</b>
          </span>
          {t.responseRate !== null && (
            <span>
              응답률 <b>{Math.round(t.responseRate * 100)}%</b>
            </span>
          )}
        </div>
      )}
      {r.kind !== "empty" && (
        <div className="s-hero-actions">
          {r.kind === "paused" ? (
            <button className="s-btn sm primary" onClick={onResume} data-testid="pause-off">
              다시 받기
            </button>
          ) : (
            <button className="s-btn sm" onClick={onPause} data-testid="pause-open">
              <Icon name="pause" size={16} stroke={2.2} />
              잠깐 쉬기
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function PauseSheet({ now, onClose, onPick }: { now: number; onClose: () => void; onPick: (f: "1h" | "today" | "manual") => void }) {
  return (
    <Sheet title="얼마나 쉴까요?" onClose={onClose} testid="pause-sheet">
      <p className="s-section-note">쉬는 동안 내 물건은 지나가는 차에 보이지 않아요. 진행 중인 거래는 그대로예요.</p>
      <div className="s-rows">
        <button className="s-row-btn" onClick={() => onPick("1h")} data-testid="pause-1h">
          <Icon name="timer" />
          <span className="s-row-main">
            1시간<small>{kstClock(now + 3600_000)}에 다시 받아요</small>
          </span>
          <Icon name="chevron" />
        </button>
        <button className="s-row-btn" onClick={() => onPick("today")} data-testid="pause-today">
          <Icon name="clock" />
          <span className="s-row-main">
            오늘은 그만<small>내일 다시 받아요</small>
          </span>
          <Icon name="chevron" />
        </button>
        <button className="s-row-btn" onClick={() => onPick("manual")} data-testid="pause-manual">
          <Icon name="pause" />
          <span className="s-row-main">
            다시 켤 때까지<small>'다시 받기'를 누르면 돌아와요</small>
          </span>
          <Icon name="chevron" />
        </button>
      </div>
    </Sheet>
  );
}

/** 웹 푸시 켜기(T24) — 안 되는 환경이면 이유와 할 일만 */
export function PushCard({ state, onToggle }: { state: PushState; onToggle: () => void }) {
  if (state.kind === "on") return null;
  const ios = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
  if (state.kind === "unavailable")
    return (
      <div className="s-notice" data-testid="push-row">
        <Icon name="bell" />
        <p>
          페이지를 닫아 두면 요청을 놓칠 수 있어요. {state.why}.{ios ? " 아이폰은 공유에서 홈 화면에 추가한 뒤 거기서 열어 주세요." : ""}
        </p>
      </div>
    );
  if (state.kind === "denied")
    return (
      <div className="s-notice" data-testid="push-row">
        <Icon name="bell" />
        <p>알림이 막혀 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.</p>
      </div>
    );
  return (
    <div className="s-notice" data-testid="push-row">
      <Icon name="bell" />
      <p>페이지를 닫아도 차가 오면 알려 드려요</p>
      <button className="s-btn sm kraft" disabled={state.kind === "busy"} onClick={onToggle} data-testid="push-toggle">
        알림 받기
      </button>
    </div>
  );
}

/** 진행 중 거래 — 누르면 만남 화면이나 거래 탭으로 */
export function LiveLine({ t, now, onOpen }: { t: SellerTrade; now: number; onOpen: () => void }) {
  const m = minutesLeft(t.etaAt, now);
  const item = t.title.split(" (")[0];
  const done = t.status === "completed";
  const span = t.etaAt && t.acceptedAt ? Math.max(1, t.etaAt - t.acceptedAt) : 1;
  const progress = t.status !== "accepted" ? 1 : t.etaAt && t.acceptedAt ? Math.min(1, Math.max(0.04, (now - t.acceptedAt) / span)) : 0.05;
  const big = done ? "구매자가 받았어요" : t.handedAt ? "건넸어요" : t.status === "arrived" ? "도착했어요" : m !== null && m > 0 ? `${m}분 뒤 도착` : "곧 도착해요";
  const sub = done
    ? `${t.settleAt ? `${kstClock(t.settleAt)}에 ` : ""}${won(t.price)}이 정산돼요`
    : t.handedAt
      ? "구매자가 확인하면 정산을 시작해요"
      : `${t.etaAt && t.status === "accepted" ? `${kstClock(t.etaAt)} 도착 예정, ` : ""}${t.vehicleModel}`;
  return (
    <button className={`s-live ${done ? "calm" : ""}`} onClick={onOpen} data-testid="live-line">
      <span className="s-live-what">{done ? `${item} 거래` : `${item} 사러 오는 중`}</span>
      <Icon name="chevron" />
      <span className="s-live-big">{big}</span>
      <span className="s-live-sub">{sub}</span>
      {!done && (
        <span className="s-live-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
      )}
    </button>
  );
}

export function ListingRow({ l, onOpen }: { l: SellerListing; onOpen: () => void }) {
  const shown = l.stats?.shown ?? 0;
  const alerted = l.stats?.alerted ?? 0;
  return (
    <button className={`s-listing ${l.status !== "active" ? "dim" : ""}`} onClick={onOpen} data-testid="listing-row">
      {l.photos[0] ? <img src={l.photos[0]} alt="" /> : <span className="s-thumb" />}
      <span className="s-listing-main">
        <span className="s-listing-title">{l.title}</span>
        <span className="s-listing-price">
          {won(l.price)}
          {l.status !== "active" && <span className={`s-badge ${l.status === "reserved" ? "reserved" : ""}`}>{LISTING_KO[l.status]}</span>}
        </span>
        <span className="s-listing-meta">
          {describeAvailability(l.availability)}
          {l.autoAccept ? ", 바로 확정" : ""}
        </span>
        {l.status === "active" && (
          <span className={`s-listing-stats ${shown ? "" : "zero"}`} data-testid="listing-stats">
            <Icon name="eye" size={15} stroke={2.1} />
            {shown ? `지나간 차 ${shown}대에 보였어요${alerted ? `, 음성 알림 ${alerted}번` : ""}` : "아직 지나간 차가 없어요"}
          </span>
        )}
      </span>
      <Icon name="chevron" />
    </button>
  );
}

/** 물건 하나 바꾸기 — 바꾼 것은 바로 저장 */
export function ListingSheet({
  l,
  onClose,
  patch,
}: {
  l: SellerListing;
  onClose: () => void;
  patch: (id: string, body: Record<string, unknown>, undo?: Record<string, unknown>, done?: string) => Promise<void>;
}) {
  const [price, setPrice] = useState(l.price);
  const preset = presetOf(l.availability);
  const busy = l.status === "reserved";
  return (
    <Sheet title={l.title} onClose={onClose} testid="listing-sheet">
      <div className="s-sheet-item">
        {l.photos[0] ? <img src={l.photos[0]} alt="" /> : <span className="s-thumb" />}
        <span>
          {LISTING_KO[l.status]}
          <br />
          {l.sizeCm.w}×{l.sizeCm.d}×{l.sizeCm.h}cm, {SIZE_SOURCE_KO[l.sizeSource] ?? "추정"}
        </span>
      </div>
      {busy && <p className="s-help">거래 중이라 판매 상태는 바꿀 수 없어요. 가격과 시간은 다음 요청부터 적용돼요.</p>}
      {l.status === "active" || busy ? (
        <>
          <div className="s-label">가격</div>
          <div className="s-stepper" role="group" aria-label="가격">
            <button onClick={() => setPrice((p) => Math.max(0, p - 1000))} aria-label="1천 원 내리기">
              <Icon name="minus" />
            </button>
            <b>{won(price)}</b>
            <button onClick={() => setPrice((p) => p + 1000)} aria-label="1천 원 올리기">
              <Icon name="plus" />
            </button>
          </div>
          {price !== l.price && (
            <button className="s-btn primary lg block" style={{ marginTop: 10 }} onClick={() => void patch(l.id, { price }, { price: l.price }, `${josa(won(price), "으로/로")} 바꿨어요`)} data-testid="price-save">
              {josa(won(price), "으로/로")} 바꾸기
            </button>
          )}
          <div className="s-label">거래할 수 있는 시간</div>
          <div className="s-chips">
            {PRESETS.map((p) => (
              <button key={p.id} className={preset === p.id ? "on" : ""} onClick={() => void patch(l.id, { availability: p.windows }, { availability: l.availability }, `${josa(p.label, "으로/로")} 바꿨어요`)}>
                {p.label}
              </button>
            ))}
            {preset === "custom" && <button className="on">{describeAvailability(l.availability)}</button>}
          </div>
          <div style={{ marginTop: 6 }}>
            <Toggle
              checked={l.autoAccept}
              onChange={(v) => void patch(l.id, { autoAccept: v }, { autoAccept: !v }, v ? "그 시간의 요청은 바로 확정돼요" : "요청마다 수락할게요")}
              label="그 시간엔 바로 확정"
              sub="요청을 기다리지 않고 수락돼요"
            />
          </div>
          {!busy && (
            <div className="s-sheet-actions">
              <button className="s-btn" onClick={() => void patch(l.id, { status: "sold" }, { status: "active" }, "판매 완료로 바꿨어요")} data-testid="sold">
                다른 데서 팔렸어요
              </button>
              <button className="s-btn" onClick={() => void patch(l.id, { status: "hidden" }, { status: "active" }, "내렸어요. 지나가는 차에 보이지 않아요")} data-testid="hide">
                내리기
              </button>
            </div>
          )}
        </>
      ) : (
        <button className="s-btn primary lg block" style={{ marginTop: 16 }} onClick={() => void patch(l.id, { status: "active" }, undefined, "다시 올렸어요")} data-testid="relist">
          다시 올리기
        </button>
      )}
    </Sheet>
  );
}
