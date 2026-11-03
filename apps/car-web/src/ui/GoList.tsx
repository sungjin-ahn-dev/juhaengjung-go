/**
 * 오른쪽 추천 목록 — 지도의 번호 핀과 같은 순서(추천 점수순).
 * 정차 중: 사진·판매자 설명·우회 시간·거리·적재·기준가·미리 요청.
 * 주행 중: 사진과 설명 없이 큰 글씨 3줄만(시선을 오래 뺏지 않게). 말할 때가 되면 알림 카드가 대신 뜬다.
 */
import { useEffect, useRef } from "react";
import type { CarController, CarState, CandidateView } from "../controller.ts";
import { CONDITION_KO, EXCLUSION_KO, GO_KO, fmtKm, fmtMin, fmtWon } from "./format.ts";

export interface RankedItem extends CandidateView {
  /** 알릴 수 있는 매물의 추천 순위(1부터). 제외된 매물은 null */
  rank: number | null;
}

/** 지나친 매물은 빼고, 알릴 수 있는 것 → 제외된 것 순서로 각각 점수순 */
export function rankItems(s: CarState): RankedItem[] {
  const src = s.candidates.length ? s.candidates : (s.briefing?.items ?? []);
  const visible = src.filter((x) => !x.exclusions.includes("passed"));
  const byScore = (a: CandidateView, b: CandidateView) => b.score - a.score;
  const ok = visible
    .filter((x) => x.exclusions.length === 0)
    .sort(byScore)
    .map((x, i) => ({ ...x, rank: i + 1 }));
  const out = visible
    .filter((x) => x.exclusions.length > 0)
    .sort(byScore)
    .map((x) => ({ ...x, rank: null }));
  return [...ok, ...out];
}

const distText = (x: CandidateView, mode: CarState["mode"]) =>
  mode === "region" ? (x.fromHereM !== null ? `여기서 ${fmtKm(x.fromHereM)}` : "") : x.aheadM !== null ? `${fmtKm(x.aheadM)} 앞` : "";
const detourText = (x: CandidateView, mode: CarState["mode"]) => (mode === "region" ? `${x.detourMin}분` : `+${x.detourMin}분`);

export function GoList({
  s,
  c,
  items,
  selectedId,
  onSelect,
}: {
  s: CarState;
  c: CarController;
  items: RankedItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (selectedId) rows.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);
  const driving = s.restricted;
  const ok = items.filter((x) => x.rank !== null);
  const out = items.filter((x) => x.rank === null);
  const route = s.route ?? s.briefing?.route ?? null;
  const title =
    s.mode === "route" ? (s.destination ? `${s.destination.name}까지 추천` : "이번 길 추천") : s.mode === "region" ? "근처 추천" : "관심 매물";

  if (s.mode === "idle") {
    return (
      <section className="c-list c-card" aria-label="추천 목록" data-testid="go-list">
        <header className="c-list-head">
          <div className="c-list-title">{title}</div>
          <div className="c-list-count">{s.interests.length}</div>
          <p className="c-list-sub">목적지를 정하면 길 위의 관심 매물을 추천순으로 보여 드려요. 지도에 같은 번호로 찍어요.</p>
          <BlockNote s={s} />
        </header>
        {!driving && (
          <div className="c-list-empty">
            <button className="c-btn primary" onClick={() => c.open("destination")}>
              목적지 정하기
            </button>
            <button className="c-btn" onClick={() => c.open("interests")}>
              관심사 {s.interests.length}개 보기
            </button>
          </div>
        )}
      </section>
    );
  }

  const sub = driving
    ? s.holdNote ?? nextText(ok)
    : `${route ? `${fmtMin(route.durationS)}, ${fmtKm(route.distanceM)} 길에서 ` : ""}관심 매물 ${items.length}개를 찾았어요. 알릴 수 있는 건 ${ok.length}개예요.`;

  return (
    <section className={`c-list c-card ${driving ? "compact" : ""}`} aria-label="추천 목록" data-testid="go-list">
      <header className="c-list-head">
        <div className="c-list-title">{title}</div>
        <div className="c-list-count">{ok.length}</div>
        <p className={`c-list-sub ${driving && s.holdNote ? "hold" : ""}`}>{sub}</p>
        <BlockNote s={s} />
      </header>
      <div className="c-list-body">
        {items.length === 0 && <p className="c-list-note">이번 길에는 관심 매물이 없어요. 관심사를 늘리면 더 찾아 드려요.</p>}
        {driving
          ? ok.slice(0, 3).map((x) => (
              <div
                key={x.listingId}
                ref={(el) => void (el ? rows.current.set(x.listingId, el) : rows.current.delete(x.listingId))}
                className={`c-item compact ${selectedId === x.listingId ? "on" : ""}`}
                onClick={() => onSelect(x.listingId)}
                data-testid={`go-row-${x.categoryLabel}`}
              >
                <div className="c-rank">{x.rank}</div>
                <div className="c-item-cat">{x.categoryLabel}</div>
                <div className="c-item-right">
                  <b>{detourText(x, s.mode)}</b>
                  <small>{distText(x, s.mode)}</small>
                </div>
              </div>
            ))
          : items.map((x, i) => (
              <div key={x.listingId}>
                {x.rank === null && (i === 0 || items[i - 1].rank !== null) && <div className="c-list-sep">지금은 알리지 않는 매물 {out.length}개</div>}
                <Row x={x} s={s} c={c} on={selectedId === x.listingId} onSelect={onSelect} refFn={(el) => void (el ? rows.current.set(x.listingId, el) : rows.current.delete(x.listingId))} />
              </div>
            ))}
      </div>
      {driving && ok.length > 0 && <p className="c-list-note">정차하면 사진과 판매자 설명을 볼 수 있어요.</p>}
    </section>
  );
}

/** 요청할 수 없는 이유 — 주행 중에는 짧게 */
function BlockNote({ s }: { s: CarState }) {
  if (!s.block) return null;
  const short = s.block.reason === "payment" ? "결제 수단이 없어 알리지 않아요" : "요청 제한 중이라 알리지 않아요";
  return (
    <p className="c-list-block" data-testid="request-block">
      {s.restricted ? short : s.block.text}
    </p>
  );
}

function nextText(ok: RankedItem[]): string {
  const next = ok.filter((x) => x.timeToBranchS !== null && x.timeToBranchS > 0).sort((a, b) => (a.timeToBranchS ?? 0) - (b.timeToBranchS ?? 0))[0];
  if (!next) return "알릴 때가 되면 한 번에 하나씩 말할게요";
  return `다음은 ${next.categoryLabel}, 약 ${Math.max(1, Math.round((next.timeToBranchS ?? 0) / 60))}분 뒤에 물어볼게요`;
}

function Row({
  x,
  s,
  c,
  on,
  onSelect,
  refFn,
}: {
  x: RankedItem;
  s: CarState;
  c: CarController;
  on: boolean;
  onSelect: (id: string) => void;
  refFn: (el: HTMLDivElement | null) => void;
}) {
  const cheaper = x.referencePrice - x.price;
  const out = x.rank === null;
  const mine = s.trade?.listingId === x.listingId;
  return (
    <div ref={refFn} className={`c-item ${on ? "on" : ""} ${out ? "out" : ""} ${mine ? "mine" : ""}`} onClick={() => onSelect(x.listingId)} data-testid={`go-row-${x.categoryLabel}`}>
      {out ? <div className="c-rank off" aria-hidden /> : <div className="c-rank">{x.rank}</div>}
      {x.photo ? <img src={x.photo} alt="" /> : <div className="c-item-ph" />}
      <div className="c-item-main">
        <div className="c-item-top">
          <div className="c-item-title">{x.title}</div>
          <div className="c-item-detour">{detourText(x, s.mode)}</div>
        </div>
        {x.description && <div className="c-item-desc">{x.description}</div>}
        <div className="c-item-chips">
          <span className={`go-${x.goLevel}`}>{GO_KO[x.goLevel]}</span>
          <span className={x.fit.kind === "trunk" ? "fit-trunk" : ""}>{x.fit.label}</span>
          {cheaper > 0 && <span>기준가보다 {fmtWon(cheaper)} 싸요</span>}
          {x.condition && <span>{CONDITION_KO[x.condition]}</span>}
        </div>
        {out && <div className="c-item-why">{x.exclusions.map((e) => EXCLUSION_KO[e] ?? e).join(" / ")}</div>}
        <div className="c-item-foot">
          <span className="c-item-price">{fmtWon(x.price)}</span>
          <span className="c-item-dist">{distText(x, s.mode)}</span>
          {x.seller.completed > 0 && (
            <span className="c-item-dist">
              거래 {x.seller.completed}회{x.seller.rating ? `, 평점 ${x.seller.rating}` : ""}
            </span>
          )}
          {mine ? (
            <span className="c-item-mine" data-testid="go-row-mine">
              거래 중
            </span>
          ) : !out ? (
            <button
              className="c-btn kraft"
              disabled={!!s.trade || !!s.block}
              onClick={(e) => {
                e.stopPropagation();
                void c.request(x.listingId, "briefing");
              }}
            >
              미리 요청
            </button>
          ) : x.interestType !== "wish" ? (
            <button
              className="c-btn"
              onClick={(e) => {
                e.stopPropagation();
                void c.addWish(x.listingId, x.goLevel);
              }}
            >
              찜해 두기
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
