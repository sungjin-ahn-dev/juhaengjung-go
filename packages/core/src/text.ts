/**
 * T17 같이 올리기 — 판매자가 다른 앱에 쓴 자기 글을 붙여 넣으면 제목·가격·설명·품목을 채운다.
 * 크기 추정은 실제 서비스에서는 사진 기반 AI가 하고, 여기서는 품목별 대표 크기 표로 대신한다(시뮬레이션).
 */
import type { SizeCm } from "./types.ts";

export interface CategoryDef {
  id: string;
  label: string;
  /** 제목·키워드에 들어가면 이 품목으로 본다 */
  words: string[];
  /** 대표 크기(가로×깊이×높이, cm) — AI 추정 시뮬레이션 */
  typicalSize: SizeCm;
  /** 상태 '상' 기준 중고 기준가(원) — 자체 기준표, 다른 플랫폼 시세 아님 */
  basePrice: number;
  fragile?: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "car_seat", label: "카시트", words: ["카시트", "카싯", "carseat", "유아용시트", "주니어카시트"], typicalSize: { w: 45, d: 55, h: 68 }, basePrice: 65000 },
  { id: "stroller", label: "유모차", words: ["유모차", "디럭스", "휴대용유모차", "절충형유모차"], typicalSize: { w: 55, d: 38, h: 92 }, basePrice: 150000 },
  { id: "baby_bed", label: "아기 침대", words: ["아기침대", "유아침대", "베이비베드", "원목침대", "범퍼침대"], typicalSize: { w: 125, d: 68, h: 22 }, basePrice: 90000 },
  { id: "camping_chair", label: "캠핑의자", words: ["캠핑의자", "릴렉스체어", "캠핑체어", "접이식의자", "헬리녹스"], typicalSize: { w: 18, d: 18, h: 95 }, basePrice: 30000 },
  { id: "camping_table", label: "캠핑 테이블", words: ["캠핑테이블", "롤테이블", "캠핑식탁"], typicalSize: { w: 60, d: 12, h: 15 }, basePrice: 40000 },
  { id: "tent", label: "텐트", words: ["텐트", "타프", "쉘터"], typicalSize: { w: 70, d: 30, h: 30 }, basePrice: 150000 },
  { id: "bicycle", label: "자전거", words: ["자전거", "로드바이크", "미니벨로", "mtb"], typicalSize: { w: 170, d: 60, h: 100 }, basePrice: 120000 },
  { id: "sofa", label: "소파", words: ["소파", "쇼파", "카우치"], typicalSize: { w: 200, d: 90, h: 85 }, basePrice: 200000 },
  { id: "desk", label: "책상", words: ["책상", "데스크", "컴퓨터책상"], typicalSize: { w: 120, d: 60, h: 74 }, basePrice: 60000 },
  { id: "bookshelf", label: "책장", words: ["책장", "선반", "수납장"], typicalSize: { w: 80, d: 30, h: 180 }, basePrice: 50000 },
  { id: "monitor", label: "모니터", words: ["모니터", "디스플레이"], typicalSize: { w: 62, d: 20, h: 45 }, basePrice: 120000, fragile: true },
  { id: "microwave", label: "전자레인지", words: ["전자레인지", "오븐"], typicalSize: { w: 48, d: 36, h: 28 }, basePrice: 40000 },
  { id: "plant", label: "화분", words: ["화분", "식물", "몬스테라"], typicalSize: { w: 40, d: 40, h: 90 }, basePrice: 30000, fragile: true },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryDef(id: string): CategoryDef | undefined {
  return CATEGORY_BY_ID.get(id);
}

export function categoryLabel(id: string): string {
  return CATEGORY_BY_ID.get(id)?.label ?? id;
}

/** 공백·기호를 빼고 소문자로 */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.,·/()[\]{}!?~"'`]+/g, "");
}

export function categorize(text: string): string | null {
  const t = normalizeText(text);
  let best: { id: string; len: number } | null = null;
  for (const c of CATEGORIES)
    for (const w of [c.label, ...c.words]) {
      const nw = normalizeText(w);
      if (nw && t.includes(nw) && (!best || nw.length > best.len)) best = { id: c.id, len: nw.length };
    }
  return best?.id ?? null;
}

/** 관심 키워드가 매물과 맞는가 — 제목·설명·품목(동의어 포함)으로 본다 */
export function keywordMatches(keyword: string, listing: { title: string; description?: string; category: string }): boolean {
  const k = normalizeText(keyword);
  if (!k) return false;
  const hay = normalizeText(`${listing.title} ${listing.description ?? ""}`);
  if (hay.includes(k)) return true;
  const kc = categorize(keyword);
  return kc !== null && kc === listing.category;
}

export interface ParsedListing {
  title: string;
  price: number | null;
  description: string;
  category: string | null;
}

/** 가격 표기: "3만 5천원", "가격: 35,000", "9만원", "2.5만", "35,000원" */
function findPrice(text: string): number | null {
  const manCheon = text.match(/(\d+)\s*만\s*(\d)\s*천\s*원?/);
  if (manCheon) return parseInt(manCheon[1], 10) * 10000 + parseInt(manCheon[2], 10) * 1000;
  const labeled = text.match(/(?:가격|판매가|희망가)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(만\s*원|만|원)?/);
  if (labeled) {
    const n = parseFloat(labeled[1].replace(/,/g, ""));
    const v = labeled[2]?.startsWith("만") ? n * 10000 : n;
    if (v >= 1000) return Math.round(v);
  }
  const won = text.match(/([\d]{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (won) return parseInt(won[1].replace(/,/g, ""), 10);
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원?/);
  if (man) return Math.round(parseFloat(man[1]) * 10000);
  return null;
}

const PRICE_LINE = /^(?:가격|판매가|희망가)?\s*[:：]?\s*[\d,.]+\s*(?:만\s*원?|원)?\s*$/;

export function parsePastedListing(text: string): ParsedListing {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let title = (lines[0] ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/^(팝니다|판매)\s*[:：-]?\s*/, "");
  // 제목 줄에 가격이 붙어 있으면 떼어 낸다
  title = title.replace(/\s*[-/|]\s*[\d,.]+\s*(만\s*원|만|원)\s*$/, "").trim();
  const price = findPrice(text);
  const description = lines
    .slice(1)
    .filter((l) => !PRICE_LINE.test(l))
    .join("\n");
  return { title: title.slice(0, 60), price, description, category: categorize(text) };
}

export interface SizeEstimate {
  sizeCm: SizeCm;
  confidence: number;
  method: "category_table";
  note: string;
}

/** AI 크기 추정 자리 — 품목별 대표 크기. 사진 분석 모델로 바꿀 수 있게 같은 모양으로 반환 */
export function estimateSize(title: string, category?: string | null): SizeEstimate | null {
  const cat = category ?? categorize(title);
  const def = cat ? CATEGORY_BY_ID.get(cat) : undefined;
  if (!def) return null;
  return { sizeCm: { ...def.typicalSize }, confidence: 0.6, method: "category_table", note: `${def.label} 대표 크기로 채웠어요. 실제 크기로 고쳐 주세요.` };
}

/** 한 변이 60cm 이상이면 판매자 실측 확인이 있어야 등록된다 */
export const BIG_ITEM_CM = 60;
export function needsMeasuredSize(size: SizeCm): boolean {
  return Math.max(size.w, size.d, size.h) >= BIG_ITEM_CM;
}

/** 끝 글자에 받침이 있는지(한글 음절·숫자 읽기 기준). 영문 등은 받침 없음으로 본다 */
function finalConsonant(word: string): number {
  // 끝의 괄호·따옴표·문장부호는 건너뛴다: "긁힘(작음)" → "음"
  const ch = word.trim().replace(/[)\]}»"'’”.!?…]+$/, "").slice(-1);
  if (!ch) return 0;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
  // 숫자 읽기: 영·일·삼·육·칠·팔은 받침, 이·사·오·구는 없음 (일=ㄹ 8, 칠·팔=ㄹ 8)
  const digit: Record<string, number> = { "0": 21, "1": 8, "2": 0, "3": 16, "4": 0, "5": 0, "6": 1, "7": 8, "8": 8, "9": 0 };
  return digit[ch] ?? 0;
}

/** 조사 붙이기: josa("캠핑의자", "은/는") → "캠핑의자는", josa("책상", "을/를") → "책상을" */
export function josa(word: string, pair: "은/는" | "이/가" | "을/를" | "과/와" | "으로/로"): string {
  const jong = finalConsonant(word);
  const [withBatchim, without] = pair.split("/");
  if (pair === "으로/로") return word + (jong === 0 || jong === 8 ? without : withBatchim);
  return word + (jong ? withBatchim : without);
}

/** 금액을 "3만 5천 원"처럼 읽기 쉽게 */
export function wonText(n: number): string {
  if (n >= 10000) {
    const man = Math.floor(n / 10000);
    const rest = n % 10000;
    if (rest === 0) return `${man}만 원`;
    if (rest % 1000 === 0) return `${man}만 ${rest / 1000}천 원`;
    return `${n.toLocaleString("ko-KR")}원`;
  }
  if (n % 1000 === 0 && n > 0) return `${n / 1000}천 원`;
  return `${n.toLocaleString("ko-KR")}원`;
}
