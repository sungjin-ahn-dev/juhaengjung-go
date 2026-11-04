import {
  approxArea,
  DEFAULT_GO_SETTING,
  DEMO_NET,
  DEMO_PLACES,
  Graph,
  GraphRouter,
  kstToMs,
  referencePrice,
  vehicleByModel,
  type DriveContext,
  type Interest,
  type Listing,
} from "../src/index.ts";

export const graph = new Graph(DEMO_NET);
export const router = new GraphRouter(graph);
export const IONIQ5 = vehicleByModel("아이오닉 5")!;
export const AVANTE = vehicleByModel("아반떼")!;
/** 금요일 18:05 KST */
export const FRI_1805 = kstToMs(2026, 11, 6, 18, 5);

const node = (id: string) => graph.node(id);

export function listing(id: string, nodeId: string, over: Partial<Listing> = {}): Listing {
  const n = node(nodeId);
  const category = over.category ?? "car_seat";
  const condition = over.condition ?? "good";
  return {
    id,
    sellerId: over.sellerId ?? `seller_${id}`,
    title: over.title ?? "카시트",
    description: "",
    category,
    price: 35000,
    referencePrice: referencePrice(category, condition),
    condition,
    fragile: false,
    sizeCm: { w: 45, d: 55, h: 68 },
    sizeSource: "seller_measured",
    photos: [],
    approxArea: approxArea(n, id),
    pickupPoint: { lat: n.lat, lng: n.lng, label: n.name },
    availability: [],
    autoAccept: false,
    status: "active",
    createdAt: 0,
    confirmedAt: FRI_1805, // 시험은 금요일 18:05 기준 — 방금 확인한 매물
    ...over,
  };
}

export function demoListings(): Listing[] {
  return [
    listing("camp", "yeongtong_side", { title: "캠핑의자 릴렉스체어", category: "camping_chair", price: 20000, sizeCm: { w: 18, d: 18, h: 95 } }),
    listing("bed", "bojeong", { title: "원목 아기 침대 (분해)", category: "baby_bed", condition: "fair", price: 50000, referencePrice: referencePrice("baby_bed", "fair"), sizeCm: { w: 125, d: 68, h: 22 } }),
    listing("stroller", "jeongja_side", { title: "디럭스 유모차", category: "stroller", price: 90000, referencePrice: referencePrice("stroller", "good"), sizeCm: { w: 55, d: 38, h: 92 } }),
    listing("carseat", "baekhyeon", { title: "회전형 카시트", category: "car_seat", price: 35000 }),
    listing("sofa", "suseo", { title: "3인 소파", category: "sofa", price: 80000, referencePrice: referencePrice("sofa", "good"), sizeCm: { w: 200, d: 90, h: 85 } }),
  ];
}

export function interest(keyword: string, goLevel: Interest["goLevel"], id = keyword): Interest {
  return { id, userId: "buyer", type: "keyword", keyword, goLevel, createdAt: 0 };
}

export function demoInterests(): Interest[] {
  return [interest("카시트", "must"), interest("유모차", "must"), interest("아기 침대", "likely"), interest("캠핑의자", "near"), interest("소파", "must")];
}

export function ctxAtStart(over: Partial<DriveContext> = {}): DriveContext {
  return {
    now: FRI_1805,
    navStatus: "ROUTE_DRIVE",
    location: { ...DEMO_PLACES.start },
    destination: { ...DEMO_PLACES.home },
    waypointCount: 0,
    socPct: 62,
    fuelRangeKm: null,
    seats: { row2Occupied: false },
    ...over,
  };
}

export const settings = DEFAULT_GO_SETTING;
