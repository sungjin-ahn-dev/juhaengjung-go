/**
 * 시연용 물건 그림 — 실제 사진 자리에 쓰는 평면 일러스트(SVG data URL).
 * 판매자가 올린 사진이 아니라는 게 보이도록 배경·그림체를 하나로 맞췄다. 사진 AI 크기 추정에는 쓰지 않는다(SVG).
 */

interface Tone {
  bg: string;
  floor: string;
  main: string;
  dark: string;
  light: string;
}

const INK = "#3a3f47";
const INK_SOFT = "#5b616b";

const TONES: Record<string, Tone> = {
  car_seat: { bg: "#ece8f6", floor: "#d9d2ee", main: "#6f5fb0", dark: "#4f4290", light: "#c9c0ea" },
  stroller: { bg: "#e3f1ea", floor: "#cbe5d7", main: "#3f8f6b", dark: "#2c6d50", light: "#b7dcc8" },
  camping_chair: { bg: "#f5ecdc", floor: "#eadac0", main: "#c8843a", dark: "#9c6224", light: "#efcf9f" },
  baby_bed: { bg: "#f7e9e6", floor: "#efd6d1", main: "#c98f6a", dark: "#a26b48", light: "#f3ddce" },
  sofa: { bg: "#e5ecf6", floor: "#d0dcee", main: "#5a7fb5", dark: "#40639a", light: "#b9cbe6" },
  bicycle: { bg: "#f3f0dc", floor: "#e6e0bd", main: "#d0a531", dark: "#a8831f", light: "#ecdca0" },
  tent: { bg: "#e7f0e1", floor: "#d3e3c8", main: "#6c9a4a", dark: "#4f7a33", light: "#c4dcb1" },
  camping_table: { bg: "#f1ece4", floor: "#e3d9cb", main: "#9b7b58", dark: "#7a5d3e", light: "#d8c5ad" },
  desk: { bg: "#eeeae6", floor: "#ddd6cf", main: "#a08566", dark: "#7d6448", light: "#dccbb6" },
  etc: { bg: "#f3ebdd", floor: "#e6d8c0", main: "#c9a06a", dark: "#9f7743", light: "#ead3ad" },
};

function carSeat(t: Tone) {
  return `
  <rect x="104" y="174" width="112" height="20" rx="10" fill="${INK}"/>
  <path d="M112 70c0-18 14-28 48-28s48 10 48 28v92c0 10-8 16-18 16h-60c-10 0-18-6-18-16z" fill="${t.main}"/>
  <ellipse cx="114" cy="78" rx="12" ry="22" fill="${t.dark}"/>
  <ellipse cx="206" cy="78" rx="12" ry="22" fill="${t.dark}"/>
  <path d="M130 74c0-10 10-16 30-16s30 6 30 16v76c0 8-6 12-14 12h-32c-8 0-14-4-14-12z" fill="${t.light}"/>
  <path d="M146 86l6 58M174 86l-6 58" stroke="${t.dark}" stroke-width="6" stroke-linecap="round"/>
  <rect x="150" y="134" width="20" height="13" rx="4" fill="${INK}"/>
  <path d="M106 150h22v22h-14a8 8 0 0 1-8-8zM214 150h-22v22h14a8 8 0 0 0 8-8z" fill="${t.dark}"/>`;
}

function stroller(t: Tone) {
  return `
  <path d="M196 132l34-58" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <path d="M224 70h20" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
  <path d="M128 150l-6 28M200 150l8 28M140 150l52 22" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <path d="M104 118h108c0 22-18 38-40 38h-30c-22 0-38-16-38-38z" fill="${t.main}"/>
  <path d="M104 118c0-36 26-58 58-58v58z" fill="${t.dark}"/>
  <path d="M112 112c2-26 22-44 46-46" stroke="${t.light}" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M104 118h108" stroke="${t.light}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="120" cy="182" r="14" fill="${INK}"/><circle cx="120" cy="182" r="5" fill="${t.light}"/>
  <circle cx="210" cy="182" r="14" fill="${INK}"/><circle cx="210" cy="182" r="5" fill="${t.light}"/>`;
}

function campingChair(t: Tone) {
  return `
  <path d="M112 192l96-64M208 192l-96-64" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <path d="M118 58h84a6 6 0 0 1 6 6v58h-96V64a6 6 0 0 1 6-6z" fill="${t.dark}"/>
  <path d="M124 66h72v50h-72z" fill="${t.main}"/>
  <path d="M108 120q52 26 104 0l-4 30q-48 22-96 0z" fill="${t.main}"/>
  <path d="M114 128q46 20 92 0" stroke="${t.light}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M96 116h28M196 116h28" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
  <rect x="214" y="104" width="16" height="14" rx="4" fill="${t.dark}"/>`;
}

function babyBed(t: Tone) {
  const slats = Array.from({ length: 9 }, (_, i) => `<rect x="${102 + i * 14}" y="98" width="6" height="58" rx="3" fill="${t.light}"/>`).join("");
  return `
  <rect x="84" y="74" width="12" height="118" rx="6" fill="${t.dark}"/>
  <rect x="224" y="74" width="12" height="118" rx="6" fill="${t.dark}"/>
  <rect x="92" y="90" width="136" height="10" rx="5" fill="${t.main}"/>
  ${slats}
  <rect x="96" y="148" width="128" height="12" rx="4" fill="#fbf6f1"/>
  <rect x="92" y="158" width="136" height="12" rx="5" fill="${t.main}"/>
`;
}

function sofa(t: Tone) {
  return `
  <rect x="86" y="74" width="148" height="62" rx="18" fill="${t.light}"/>
  <rect x="92" y="80" width="66" height="50" rx="14" fill="${t.main}" opacity=".35"/>
  <rect x="162" y="80" width="66" height="50" rx="14" fill="${t.main}" opacity=".35"/>
  <rect x="76" y="124" width="168" height="44" rx="14" fill="${t.main}"/>
  <path d="M160 128v36" stroke="${t.dark}" stroke-width="3" opacity=".5"/>
  <rect x="58" y="104" width="34" height="68" rx="16" fill="${t.dark}"/>
  <rect x="228" y="104" width="34" height="68" rx="16" fill="${t.dark}"/>
  <rect x="78" y="170" width="10" height="16" rx="3" fill="${INK}"/>
  <rect x="232" y="170" width="10" height="16" rx="3" fill="${INK}"/>`;
}

function bicycle(t: Tone) {
  return `
  <circle cx="104" cy="158" r="36" fill="none" stroke="${INK}" stroke-width="7"/>
  <circle cx="216" cy="158" r="36" fill="none" stroke="${INK}" stroke-width="7"/>
  <circle cx="104" cy="158" r="5" fill="${INK_SOFT}"/><circle cx="216" cy="158" r="5" fill="${INK_SOFT}"/>
  <path d="M104 158l46 2 46-50h-54l-38 48M150 160l-8-50M196 110l20 48" stroke="${t.main}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M196 110l-4-18c8-2 16 0 22 6" stroke="${INK}" stroke-width="6" stroke-linecap="round" fill="none"/>
  <rect x="128" y="96" width="30" height="9" rx="4.5" fill="${INK}"/>
  <circle cx="150" cy="160" r="8" fill="${t.dark}"/>`;
}

function tent(t: Tone) {
  return `
  <path d="M160 58l78 128H82z" fill="${t.main}"/>
  <path d="M160 58l26 128h-52z" fill="${t.dark}"/>
  <path d="M160 108l14 78h-28z" fill="${t.light}"/>
  <path d="M160 52v10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <path d="M82 186h156" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
}

function table(t: Tone) {
  return `
  <rect x="80" y="96" width="160" height="16" rx="8" fill="${t.main}"/>
  <path d="M96 100h128" stroke="${t.light}" stroke-width="3" stroke-linecap="round"/>
  <path d="M104 112l-10 74M216 112l10 74M120 112l80 60M200 112l-80 60" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
}

function parcel(t: Tone) {
  return `
  <path d="M160 64l70 30v62l-70 30-70-30V94z" fill="${t.main}"/>
  <path d="M90 94l70 30 70-30" fill="none" stroke="${t.dark}" stroke-width="3"/>
  <path d="M160 124v62" stroke="${t.dark}" stroke-width="3"/>
  <path d="M90 94l70 30v62l-70-30z" fill="${t.dark}" opacity=".18"/>
  <path d="M125 79l70 30v18" stroke="${t.light}" stroke-width="10" fill="none"/>`;
}

const DRAW: Record<string, (t: Tone) => string> = {
  car_seat: carSeat,
  stroller,
  camping_chair: campingChair,
  baby_bed: babyBed,
  sofa,
  bicycle,
  tent,
  camping_table: table,
  desk: table,
};

/** 물건 그림(320×240). 같은 품목은 늘 같은 그림 */
export function productArt(category: string | null | undefined): string {
  const id = category && DRAW[category] ? category : "etc";
  const t = TONES[id] ?? TONES.etc;
  const body = (DRAW[id] ?? parcel)(t);
  // 작은 썸네일에서도 물건이 잘 보이게 조금 키운다
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 320 240"><rect width="320" height="240" fill="${t.bg}"/><g transform="translate(160 132) scale(1.16) translate(-160 -132)"><ellipse cx="160" cy="196" rx="104" ry="12" fill="${t.floor}"/>${body}</g></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\n\s*/g, ""));
}
