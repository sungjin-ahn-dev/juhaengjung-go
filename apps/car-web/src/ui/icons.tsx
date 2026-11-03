import type { TurnType } from "@jhgo/core";
import { Check, ChevronLeft, Heart, ListOrdered, Map as MapIcon, MapPin, Mic, Minus, Plus, Star, Volume2, VolumeX, X, type LucideIcon } from "lucide-react";

/** 회전 안내 화살표 (Pleos TurnType) */
export function TurnIcon({ type, size = 52 }: { type: TurnType; size?: number }) {
  const stroke = { stroke: "#eef2f6", strokeWidth: 6, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const head = (d: string) => <path d={d} fill="#eef2f6" />;
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
          <circle cx="26" cy="22" r="11" fill="#d8ae74" />
          <path d="M26 33 V48" {...stroke} />
          <text x="26" y="27" textAnchor="middle" fontSize="13" fontWeight={800} fill="#2a1c0c" stroke="none">
            P
          </text>
        </>
      );
      break;
    case "TURN_ARRIVE":
      body = (
        <>
          <path d="M18 48 V10" {...stroke} />
          <path d="M18 10 H38 L33 17 L38 24 H18 Z" fill="#eef2f6" />
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
  const w = Math.max(0, Math.min(100, pct ?? 0)) * 0.22;
  const color = pct == null ? "#8e9bad" : pct < 20 ? "#f2a65a" : "#7bd389";
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden>
      <rect x="1" y="1" width="26" height="14" rx="4" fill="none" stroke="#8e9bad" strokeWidth="1.8" />
      <rect x="28.5" y="5" width="2.5" height="6" rx="1" fill="#8e9bad" />
      <rect x="3.2" y="3.2" width={w} height="9.6" rx="2" fill={color} />
    </svg>
  );
}

const RAIL: Record<string, LucideIcon> = { map: MapIcon, dest: MapPin, brief: ListOrdered, heart: Heart, sound: Volume2, mute: VolumeX, mic: Mic };
export function RailIcon({ name, size = 26 }: { name: "map" | "dest" | "brief" | "heart" | "sound" | "mute" | "mic"; size?: number }) {
  const C = RAIL[name];
  return <C size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export const UI = { check: Check, close: X, back: ChevronLeft, plus: Plus, minus: Minus, star: Star, mic: Mic, sound: Volume2 };
