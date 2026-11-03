/**
 * T5 적재 판단 — 차종(Vehicle CarInfo) → 트렁크 치수표와 매물 실측 비교.
 * 2열에 사람이 있으면(Vehicle Seat 착석) "2열 접으면 가능"은 쓸 수 없다.
 * 3열 차(T26)는 3열을 세운 트렁크 → 3열 접기 → 2·3열 접기 순서로 보고, 3열에 사람이 있으면 접는 칸은 쓸 수 없다.
 *
 * 치수는 공개 제원과 실내 사진을 바탕으로 한 **추정치**다. 출시 전 실측으로 바꾼다.
 */
import type { SizeCm, VehicleProfile } from "./types.ts";

export type FitKind = "trunk" | "folded3" | "folded" | "none";

export interface FitResult {
  kind: FitKind;
  /** 음성·화면 문구 */
  label: string;
}

const MARGIN_CM = 2;

function fitsBox(item: SizeCm, box: SizeCm): boolean {
  const it = [item.w, item.d, item.h];
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  return perms.some(([a, b, c]) => it[a] + MARGIN_CM <= box.w && it[b] + MARGIN_CM <= box.d && it[c] + MARGIN_CM <= box.h);
}

export function fitItem(item: SizeCm, v: Pick<VehicleProfile, "trunk" | "folded"> & Partial<Pick<VehicleProfile, "seatRows" | "row3Up">>): FitResult {
  if (v.seatRows === 3 && v.row3Up) {
    if (fitsBox(item, v.row3Up)) return { kind: "trunk", label: "트렁크에 쏙" };
    if (fitsBox(item, v.trunk)) return { kind: "folded3", label: "3열 접으면 가능" };
    if (fitsBox(item, v.folded)) return { kind: "folded", label: "2·3열 접으면 가능" };
    return { kind: "none", label: "안 들어감" };
  }
  if (fitsBox(item, v.trunk)) return { kind: "trunk", label: "트렁크에 쏙" };
  if (fitsBox(item, v.folded)) return { kind: "folded", label: "2열 접으면 가능" };
  return { kind: "none", label: "안 들어감" };
}

/** 현대·기아 주요 차종 적재 공간 추정치(cm). w=폭, d=깊이(길이), h=높이 */
export const VEHICLE_TABLE: VehicleProfile[] = [
  { model: "아이오닉 5", powertrain: "ev", seatRows: 2, trunk: { w: 100, d: 98, h: 72 }, folded: { w: 100, d: 178, h: 72 }, defaultSocPctPerKm: 0.24 },
  { model: "아이오닉 6", powertrain: "ev", seatRows: 2, trunk: { w: 96, d: 102, h: 48 }, folded: { w: 96, d: 160, h: 44 }, defaultSocPctPerKm: 0.2 },
  { model: "아이오닉 9", powertrain: "ev", seatRows: 3, trunk: { w: 112, d: 112, h: 86 }, row3Up: { w: 110, d: 44, h: 80 }, folded: { w: 112, d: 205, h: 86 }, defaultSocPctPerKm: 0.21 },
  { model: "EV6", powertrain: "ev", seatRows: 2, trunk: { w: 100, d: 96, h: 66 }, folded: { w: 100, d: 172, h: 66 }, defaultSocPctPerKm: 0.23 },
  { model: "EV9", powertrain: "ev", seatRows: 3, trunk: { w: 112, d: 110, h: 86 }, row3Up: { w: 110, d: 45, h: 80 }, folded: { w: 112, d: 200, h: 86 }, defaultSocPctPerKm: 0.21 },
  { model: "코나 일렉트릭", powertrain: "ev", seatRows: 2, trunk: { w: 96, d: 82, h: 66 }, folded: { w: 96, d: 158, h: 66 }, defaultSocPctPerKm: 0.25 },
  { model: "싼타페", powertrain: "hybrid", seatRows: 2, trunk: { w: 110, d: 115, h: 86 }, folded: { w: 110, d: 200, h: 86 } },
  { model: "쏘렌토", powertrain: "hybrid", seatRows: 2, trunk: { w: 106, d: 110, h: 80 }, folded: { w: 106, d: 190, h: 80 } },
  { model: "투싼", powertrain: "ice", seatRows: 2, trunk: { w: 100, d: 100, h: 76 }, folded: { w: 100, d: 176, h: 76 } },
  { model: "스포티지", powertrain: "ice", seatRows: 2, trunk: { w: 100, d: 98, h: 76 }, folded: { w: 100, d: 175, h: 76 } },
  { model: "팰리세이드", powertrain: "ice", seatRows: 3, trunk: { w: 114, d: 114, h: 86 }, row3Up: { w: 112, d: 48, h: 80 }, folded: { w: 114, d: 204, h: 86 } },
  { model: "카니발", powertrain: "ice", seatRows: 3, trunk: { w: 120, d: 112, h: 105 }, row3Up: { w: 118, d: 52, h: 100 }, folded: { w: 120, d: 210, h: 105 } },
  { model: "그랜저", powertrain: "ice", seatRows: 2, trunk: { w: 100, d: 106, h: 48 }, folded: { w: 100, d: 150, h: 40 } },
  { model: "쏘나타", powertrain: "ice", seatRows: 2, trunk: { w: 98, d: 104, h: 47 }, folded: { w: 98, d: 150, h: 40 } },
  { model: "아반떼", powertrain: "ice", seatRows: 2, trunk: { w: 95, d: 100, h: 46 }, folded: { w: 95, d: 150, h: 40 } },
  { model: "레이", powertrain: "ice", seatRows: 2, trunk: { w: 96, d: 70, h: 100 }, folded: { w: 96, d: 140, h: 100 } },
];

export function vehicleByModel(model: string): VehicleProfile | undefined {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return VEHICLE_TABLE.find((v) => norm(v.model) === norm(model));
}
