/**
 * 같이 올리기(T17·T25·T27) — 다른 앱에 쓴 글을 붙여 넣으면 바로 채우고, 확인할 것만 남긴다.
 * 장소·시간·바로 확정은 지난번 등록을 기본값으로 쓴다(서버가 기억).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { categorize, describeAvailability, productArt, referencePrice, wonText, type Availability, type Condition, type Listing } from "@jhgo/core";
import type { ApiClient } from "@jhgo/api";
import { Icon, Sheet, Toggle } from "./kit.tsx";
import { CONDITIONS, PRESETS, errText, presetOf, won, type Catalog, type Me, type Place } from "./types.ts";

type Field = "title" | "price" | "category" | "size" | "description";
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

function defaultsOf(me: Me, catalog: Catalog | null): { place: Place | null; availability: Availability[]; autoAccept: boolean } {
  const d = me.sellerDefaults;
  if (d) return { place: d.pickupPoint, availability: d.availability, autoAccept: d.autoAccept };
  const first = catalog?.pickupPlaces[0];
  return { place: me.homePlace ?? (first ? { lat: first.lat, lng: first.lng, label: first.label } : null), availability: PRESETS[0].windows, autoAccept: false };
}

/** 어디를 재야 하는지 — 상자 하나 */
function BoxDiagram() {
  return (
    <svg className="s-box-diagram" viewBox="0 0 86 66" aria-hidden="true">
      <path d="M10 22 L43 10 L76 22 L43 34 Z" fill="#f6ecdd" stroke="#8a5c26" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 22 L10 46 L43 58 L43 34 Z" fill="#eed8b6" stroke="#8a5c26" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M43 34 L43 58 L76 46 L76 22 Z" fill="#e2c493" stroke="#8a5c26" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 50 L41 62" stroke="#191f28" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M45 62 L78 50" stroke="#191f28" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M81 22 L81 46" stroke="#191f28" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function Compose({ client, catalog, me, onClose, onPosted }: { client: ApiClient; catalog: Catalog | null; me: Me; onClose: () => void; onPosted: (l: Listing) => void }) {
  const d0 = useMemo(() => defaultsOf(me, catalog), [me, catalog]);
  const [paste, setPaste] = useState("");
  const [parsedFrom, setParsedFrom] = useState("");
  const [filled, setFilled] = useState(false);
  const [manual, setManual] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<Condition>("good");
  const [fragile, setFragile] = useState(false);
  const [size, setSize] = useState({ w: "", d: "", h: "" });
  const [sizeMethod, setSizeMethod] = useState<"ai_photo" | "category_table" | null>(null);
  const [measured, setMeasured] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [place, setPlace] = useState<Place | null>(d0.place);
  const [availability, setAvailability] = useState<Availability[]>(d0.availability);
  const [preset, setPreset] = useState(() => presetOf(d0.availability));
  const [autoAccept, setAutoAccept] = useState(d0.autoAccept);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(new Set<Field>());
  const touch = (f: Field) => touched.current.add(f);

  // 붙여 넣으면 바로 채운다(입력이 멈추고 0.35초 뒤). 손으로 고친 칸은 다시 덮지 않는다
  useEffect(() => {
    const text = paste.trim();
    if (text.length < 4 || text === parsedFrom) return;
    const id = setTimeout(() => void fill(text), 350);
    return () => clearTimeout(id);
  }, [paste]); // eslint-disable-line react-hooks/exhaustive-deps

  const fill = async (text: string) => {
    try {
      const r = await client.call<{ title: string; price: number | null; description: string; category: string | null; sizeEstimate: { sizeCm: { w: number; d: number; h: number }; note: string } | null }>("POST", "/v1/seller/parse", { text });
      const t = touched.current;
      if (!t.has("title")) setTitle(r.title);
      if (r.price && !t.has("price")) setPrice(String(r.price));
      if (!t.has("description")) setDescription(r.description);
      if (r.category && !t.has("category")) {
        setCategory(r.category);
        setFragile(!!catalog?.categories.find((c) => c.id === r.category)?.fragile);
      }
      if (r.sizeEstimate && !t.has("size")) {
        setSize({ w: String(r.sizeEstimate.sizeCm.w), d: String(r.sizeEstimate.sizeCm.d), h: String(r.sizeEstimate.sizeCm.h) });
        setSizeMethod("category_table");
        setMeasured(false);
        setNote(r.sizeEstimate.note);
      }
      setParsedFrom(text);
      setFilled(true);
    } catch (e) {
      setError(errText(e));
    }
  };

  // 사진 AI는 서버에 추정기가 있고 실제 사진(JPEG·PNG·WebP)이 있을 때만. 샘플 그림은 품목 기본 크기로
  const realPhoto = photos.find((p) => /^data:image\/(jpeg|png|webp);base64,/.test(p)) ?? null;
  const canAi = !!catalog?.aiSize && !!realPhoto;
  const fillSize = async () => {
    setEstimating(true);
    try {
      const r = await client.call<{ estimate: { sizeCm: { w: number; d: number; h: number }; note: string; method: "ai_photo" | "category_table" } | null; category: string | null }>(
        "POST",
        "/v1/seller/estimate-size",
        { title, category, photo: canAi ? realPhoto : null },
      );
      if (!r.estimate) {
        setNote("이 품목은 크기를 채우지 못했어요. 줄자로 재서 넣어 주세요.");
        return;
      }
      setSize({ w: String(r.estimate.sizeCm.w), d: String(r.estimate.sizeCm.d), h: String(r.estimate.sizeCm.h) });
      setSizeMethod(r.estimate.method);
      if (!category && r.category) setCategory(r.category);
      setMeasured(false);
      setNote(r.estimate.note);
    } catch (e) {
      setNote(errText(e));
    } finally {
      setEstimating(false);
    }
  };

  const nums = { w: Number(size.w), d: Number(size.d), h: Number(size.h) };
  const sizeOk = nums.w > 0 && nums.d > 0 && nums.h > 0;
  const big = sizeOk && Math.max(nums.w, nums.d, nums.h) >= 60;
  const priceNum = Number(price.replace(/[^\d]/g, ""));
  const ref = category ? referencePrice(category, condition) : null;
  const showReview = filled || manual || !!title;
  const missing = !title.trim()
    ? "제목을 넣어 주세요"
    : !(priceNum > 0)
      ? "가격을 넣어 주세요"
      : !sizeOk
        ? "크기를 넣어 주세요"
        : big && !measured
          ? "줄자로 잰 크기인지 확인해 주세요"
          : !place
            ? "거래 장소를 골라 주세요"
            : preset === "custom" && !availability.some((w) => w.days.length)
              ? "거래할 요일을 골라 주세요"
              : null;

  const submit = async () => {
    if (missing || !place) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.call<{ listing: Listing }>("POST", "/v1/seller/listings", {
        title: title.trim(),
        description,
        category: category || null,
        price: priceNum,
        condition,
        fragile,
        sizeCm: nums,
        sizeSource: measured || !sizeMethod ? "seller_measured" : sizeMethod === "ai_photo" ? "ai" : "category",
        photos,
        pickupPoint: place,
        availability: preset === "anytime" ? [] : availability,
        autoAccept,
      });
      onPosted(r.listing);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const priceNote = (() => {
    if (!ref || !(priceNum > 0)) return null;
    if (priceNum < ref) return { good: true, text: `기준가 ${wonText(ref)}보다 ${wonText(ref - priceNum)} 싸요` };
    if (priceNum > ref) return { good: false, text: `기준가 ${wonText(ref)}보다 ${wonText(priceNum - ref)} 비싸요` };
    return { good: true, text: `기준가 ${wonText(ref)}와 같아요` };
  })();
  const custom = preset === "custom" ? (availability[0] ?? { days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }) : null;
  const setCustom = (w: Availability) => setAvailability([w]);
  const sampleCategory = category || categorize(title) || null;

  return (
    <div className="s-compose" data-testid="compose-form">
      <header className="s-bar">
        <button className="s-icon-btn" onClick={onClose} aria-label="닫기">
          <Icon name="close" size={22} />
        </button>
        <b>같이 올리기</b>
        <span />
      </header>

      <div className="s-compose-head">
        <h1>
          다른 앱에 쓴 글을
          <br />
          붙여 넣어 주세요
        </h1>
        <p>제목, 가격, 품목, 크기를 바로 채워 드려요</p>
      </div>
      <div className="s-compose-body">
        <textarea
          id="paste"
          className="s-textarea"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"회전형 카시트 팝니다\n35,000원\n아이가 커서 정리해요"}
          aria-label="다른 앱에 쓴 글"
        />
        {filled ? (
          <div className="s-filled" role="status">
            <Icon name="ok" size={18} stroke={2.2} /> 채웠어요. 아래에서 확인만 해 주세요
          </div>
        ) : (
          <p className="s-help">그 앱은 계속 쓰셔도 돼요. 본인이 쓴 글과 사진만 옮겨 주세요.</p>
        )}
        <div className="s-photos">
          {photos.map((p, i) => (
            <div className="s-photo" key={i}>
              <img src={p} alt={`사진 ${i + 1}`} />
              <button className="s-photo-x" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} aria-label={`사진 ${i + 1} 빼기`}>
                <Icon name="close" size={13} stroke={2.6} />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <label className="s-photo-add">
              <Icon name="camera" size={22} />
              <span className="s-num">사진 {photos.length}/3</span>
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []).slice(0, 3 - photos.length);
                  const out = await Promise.all(files.map(shrinkImage));
                  setPhotos((p) => [...p, ...out].slice(0, 3));
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {photos.length < 3 && (
            <button className="s-photo-add ghost" onClick={() => setPhotos((p) => [...p, productArt(sampleCategory)].slice(0, 3))}>
              <Icon name="photo" size={22} />
              <span>샘플 사진</span>
            </button>
          )}
        </div>
        {!showReview && (
          <button className="s-link-btn s-skip" onClick={() => setManual(true)}>
            붙여 넣을 글이 없어요. 직접 쓸게요
          </button>
        )}
      </div>

      {showReview && (
        <>
          <div className="s-band" />
          <section className="s-compose-body">
            <div className="s-section-head">
              <h2>확인해 주세요</h2>
            </div>
            <label className="s-label" htmlFor="title">
              제목
            </label>
            <input
              id="title"
              className="s-input"
              value={title}
              onChange={(e) => {
                touch("title");
                setTitle(e.target.value);
              }}
            />
            <div className="s-two">
              <div>
                <label className="s-label" htmlFor="price">
                  가격
                </label>
                <div className="s-suffix">
                  <input
                    id="price"
                    className="s-input"
                    inputMode="numeric"
                    value={priceNum > 0 ? priceNum.toLocaleString("ko-KR") : ""}
                    onChange={(e) => {
                      touch("price");
                      setPrice(e.target.value.replace(/[^\d]/g, ""));
                    }}
                  />
                  <span>원</span>
                </div>
              </div>
              <div>
                <label className="s-label" htmlFor="category">
                  품목
                </label>
                <select
                  id="category"
                  className="s-select"
                  value={category}
                  onChange={(e) => {
                    touch("category");
                    setCategory(e.target.value);
                    setFragile(!!catalog?.categories.find((c) => c.id === e.target.value)?.fragile);
                  }}
                >
                  <option value="">고르기</option>
                  {catalog?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {priceNote && <p className={`s-help ${priceNote.good ? "good" : "bad"}`}>{priceNote.text}. 흥정 없이 이 가격 그대로 거래해요.</p>}

            <div className="s-label">
              크기 <small>cm</small>
            </div>
            <div className="s-size">
              <BoxDiagram />
              <div className="s-size-inputs">
                {(["w", "d", "h"] as const).map((k) => (
                  <label key={k}>
                    <span>{k === "w" ? "가로" : k === "d" ? "깊이" : "높이"}</span>
                    <input
                      className="s-input"
                      inputMode="numeric"
                      value={size[k]}
                      onChange={(e) => {
                        touch("size");
                        setSize({ ...size, [k]: e.target.value.replace(/[^\d]/g, "") });
                        setSizeMethod(null);
                      }}
                      aria-label={`${k === "w" ? "가로" : k === "d" ? "깊이" : "높이"} cm`}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="s-size-foot">
              {sizeMethod && !measured ? (
                <span className="s-tag" data-testid="size-source">
                  {sizeMethod === "ai_photo" ? "사진으로 추정" : "품목 기본 크기"}
                </span>
              ) : measured ? (
                <span className="s-tag ok">
                  <Icon name="check" size={14} stroke={2.6} />
                  줄자로 확인
                </span>
              ) : (
                <span />
              )}
              <button className="s-btn sm" onClick={() => void fillSize()} disabled={estimating || (!title && !category && !canAi)} data-testid="fill-size">
                <Icon name="ruler" size={16} />
                {canAi ? "사진으로 크기 채우기" : "품목 기본 크기로 채우기"}
              </button>
            </div>
            {note && <p className="s-help">{note}</p>}
            {big && (
              <div className={`s-measure ${measured ? "done" : ""}`}>
                <p>
                  <Icon name={measured ? "ok" : "alert"} size={18} />
                  한 변이 60cm 넘는 물건이라 줄자로 잰 크기가 필요해요. 이 물건이 실리는 차에만 알리기 위해서예요.
                </p>
                <Toggle checked={measured} onChange={setMeasured} label="줄자로 재서 확인했어요" testid="measured" />
              </div>
            )}

            <div className="s-label">상태</div>
            <div className="s-cond" role="radiogroup" aria-label="상태">
              {CONDITIONS.map((c) => (
                <button key={c.id} role="radio" aria-checked={condition === c.id} className={condition === c.id ? "on" : ""} onClick={() => setCondition(c.id)}>
                  <b>{c.short}</b>
                  <span>{c.text}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6 }}>
              <Toggle checked={fragile} onChange={setFragile} label="깨지기 쉬워요" sub="구매자에게 편안한 길을 권해요" />
            </div>
            <label className="s-label" htmlFor="desc" style={{ marginTop: 8 }}>
              설명 <small>차 화면에 그대로 보여요</small>
            </label>
            <textarea
              id="desc"
              className="s-textarea short"
              value={description}
              onChange={(e) => {
                touch("description");
                setDescription(e.target.value);
              }}
            />
          </section>

          <div className="s-band" />
          <section className="s-compose-body">
            <div className="s-section-head">
              <h2>언제, 어디서</h2>
            </div>
            <div className="s-label">거래 장소</div>
            <button className="s-place" onClick={() => setPlaceOpen(true)} data-testid="place-open">
              <Icon name="pin" />
              <span className="s-row-main">{place?.label ?? "고르기"}</span>
              <span className="s-link">바꾸기</span>
            </button>
            <p className="s-help">정확한 장소는 수락한 구매자에게만 보여요.</p>
            <div className="s-label">거래할 수 있는 시간</div>
            <div className="s-chips" role="radiogroup" aria-label="거래할 수 있는 시간">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={preset === p.id}
                  className={preset === p.id ? "on" : ""}
                  onClick={() => {
                    setPreset(p.id);
                    setAvailability(p.windows);
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                role="radio"
                aria-checked={preset === "custom"}
                className={preset === "custom" ? "on" : ""}
                onClick={() => {
                  setPreset("custom");
                  setAvailability([availability[0] ?? { days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }]);
                }}
              >
                직접 정하기
              </button>
            </div>
            {custom ? (
              <div className="s-custom-time">
                <div className="s-days">
                  {DOW.map((dd, i) => (
                    <button
                      key={dd}
                      className={custom.days.includes(i) ? "on" : ""}
                      aria-pressed={custom.days.includes(i)}
                      onClick={() => setCustom({ ...custom, days: custom.days.includes(i) ? custom.days.filter((x) => x !== i) : [...custom.days, i].sort() })}
                    >
                      {dd}
                    </button>
                  ))}
                </div>
                <div className="s-time-row">
                  <select className="s-select auto" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="시작">
                    {TIMES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  부터
                  <select className="s-select auto" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="끝">
                    {TIMES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  까지
                </div>
              </div>
            ) : (
              <p className="s-help">{preset === "anytime" ? "언제든 지나가는 차에 보여요." : `${describeAvailability(availability)}에만 지나가는 차에 보여요.`}</p>
            )}
            <div style={{ marginTop: 6 }}>
              <Toggle checked={autoAccept} onChange={setAutoAccept} label="이 시간엔 바로 확정" sub="요청을 기다리지 않고 수락돼요. 그 시간에 집에 있을 때만 켜 주세요" testid="auto-accept" />
            </div>
          </section>
        </>
      )}

      <div className="s-submitbar">
        {error && <p className="s-warn">{error}</p>}
        <button className="s-btn primary lg block" disabled={!!missing || busy || !showReview} onClick={() => void submit()} data-testid="submit">
          {busy ? "올리는 중" : priceNum > 0 && !missing ? `${won(priceNum)}에 올리기` : "올리기"}
        </button>
        {showReview && missing && (
          <p className="s-submit-hint todo" aria-live="polite">
            {missing}
          </p>
        )}
      </div>

      {placeOpen && (
        <Sheet title="어디서 건넬까요?" onClose={() => setPlaceOpen(false)} testid="place-sheet">
          <p className="s-section-note">차가 잠깐 설 수 있는 곳만 골라요.</p>
          <div className="s-rows">
            {(catalog?.pickupPlaces ?? []).map((p) => (
              <button
                key={p.id}
                className={`s-row-btn ${place?.label === p.label ? "on" : ""}`}
                onClick={() => {
                  setPlace({ lat: p.lat, lng: p.lng, label: p.label });
                  setPlaceOpen(false);
                }}
              >
                <Icon name="pin" />
                <span className="s-row-main">{p.label}</span>
                {place?.label === p.label ? <Icon name="check" stroke={2.4} /> : <span />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** 올린 뒤 — 무엇이 일어나는지와 다음 할 일 하나 */
export function Posted({ listing, pushOn, canPush, onPush, onDone }: { listing: Listing; pushOn: boolean; canPush: boolean; onPush: () => void; onDone: () => void }) {
  return (
    <div className="s-posted" data-testid="posted">
      <div className="s-posted-mark" aria-hidden="true">
        <Icon name="check" size={34} stroke={2.6} />
      </div>
      <h1>올렸어요</h1>
      <div className="s-posted-item">
        {listing.photos[0] ? <img src={listing.photos[0]} alt="" /> : <div className="s-thumb" />}
        <div>
          <b>{listing.title}</b>
          <span>
            {won(listing.price)}, {listing.sizeCm.w}×{listing.sizeCm.d}×{listing.sizeCm.h}cm
          </span>
        </div>
      </div>
      <ol className="s-next">
        <li>
          <Icon name="car" />
          <span>{describeAvailability(listing.availability)}에 이 근처를 지나는 차 가운데, 이 물건이 실리는 차에만 보여요.</span>
        </li>
        <li>
          <Icon name="bell" />
          <span>{listing.autoAccept ? "그 시간의 요청은 바로 확정돼요. 도착 3분 전에 나와 달라고 알려 드려요." : "차가 들르겠다고 하면 화면 전체로 알려 드려요. 수락하면 대금이 바로 보관돼요."}</span>
        </li>
      </ol>
      <div className="s-posted-actions">
        {canPush && !pushOn && (
          <button className="s-btn kraft lg block" onClick={onPush} data-testid="posted-push">
            <Icon name="bell" /> 페이지를 닫아도 알림 받기
          </button>
        )}
        <button className={`s-btn lg block ${canPush && !pushOn ? "" : "primary"}`} onClick={onDone} data-testid="posted-done">
          내 물건 보기
        </button>
      </div>
    </div>
  );
}
