import type { TurnType } from "@jhgo/core";

/** 회전 안내 화살표 (Pleos TurnType) */
export function TurnIcon({ type, size = 52 }: { type: TurnType; size?: number }) {
  const stroke = { stroke: "#e8edf3", strokeWidth: 6, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const head = (d: string) => <path d={d} fill="#e8edf3" />;
  let body: JSX.Element;
  switch (type) {
    case "TURN_LEFT":
    case "TURN_SHARP_L":
      body = (
        <>
          <path d="M34 48 V28 Q34 20 26 20 H16" {...stroke} />
          {head("M8 20 L18 11 L18 29 Z")}
        </>
      );
      break;
    case "TURN_RIGHT":
    case "TURN_SHARP_R":
    case "TURN_EXIT_IC_R":
      body = (
        <>
          <path d="M18 48 V28 Q18 20 26 20 H36" {...stroke} />
          {head("M44 20 L34 11 L34 29 Z")}
        </>
      );
      break;
    case "TURN_KEEP_L":
      body = (
        <>
          <path d="M32 48 V34 L20 18" {...stroke} />
          {head("M15 11 L28 15 L16 25 Z")}
        </>
      );
      break;
    case "TURN_KEEP_R":
    case "TURN_ENTER_IC_R":
      body = (
        <>
          <path d="M20 48 V34 L32 18" {...stroke} />
          {head("M37 11 L24 15 L36 25 Z")}
        </>
      );
      break;
    case "TURN_UTURN":
      body = (
        <>
          <path d="M34 48 V24 Q34 12 24 12 Q14 12 14 24 V34" {...stroke} />
          {head("M14 44 L6 32 L22 32 Z")}
        </>
      );
      break;
    case "TURN_WAY":
      body = (
        <>
          <circle cx="26" cy="22" r="11" fill="#d9b27c" />
          <path d="M26 33 V48" {...stroke} />
          <text x="26" y="27" textAnchor="middle" fontSize="13" fontWeight={700} fill="#1d1a16" stroke="none">
            P
          </text>
        </>
      );
      break;
    case "TURN_ARRIVE":
      body = (
        <>
          <path d="M18 48 V10" {...stroke} />
          <path d="M18 10 H38 L33 17 L38 24 H18 Z" fill="#e8edf3" />
        </>
      );
      break;
    default:
      body = (
        <>
          <path d="M26 48 V16" {...stroke} />
          {head("M26 6 L36 18 L16 18 Z")}
        </>
      );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" aria-hidden>
      {body}
    </svg>
  );
}

export function BatteryIcon({ pct }: { pct: number | null }) {
  const w = Math.max(0, Math.min(100, pct ?? 0)) * 0.24;
  const color = pct == null ? "#8e9bad" : pct < 20 ? "#f2a65a" : "#7bd389";
  return (
    <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden>
      <rect x="1" y="1" width="28" height="16" rx="3" fill="none" stroke="#8e9bad" strokeWidth="2" />
      <rect x="30" y="6" width="3" height="6" rx="1" fill="#8e9bad" />
      <rect x="3" y="3" width={w} height="12" rx="1.5" fill={color} />
    </svg>
  );
}

export function RailIcon({ name }: { name: "map" | "dest" | "brief" | "heart" | "sound" | "mute" }) {
  const s = { stroke: "currentColor", strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "map":
      return (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" {...s} />
        </svg>
      );
    case "dest":
      return (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 21s-6-5.3-6-11a6 6 0 0112 0c0 5.7-6 11-6 11z" {...s} />
          <circle cx="12" cy="10" r="2.2" {...s} />
        </svg>
      );
    case "brief":
      return (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          <path d="M4 6h10 M4 12h16 M4 18h12" {...s} />
          <circle cx="19" cy="6" r="2" {...s} />
        </svg>
      );
    case "heart":
      return (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" {...s} />
        </svg>
      );
    case "sound":
      return (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          <path d="M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 010 6 M18.5 6.5a8 8 0 010 11" {...s} />
        </svg>
      );
    case "mute":
      return (
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          <path d="M4 9h4l5-4v14l-5-4H4z M16 9l5 6 M21 9l-5 6" {...s} />
        </svg>
      );
  }
}
