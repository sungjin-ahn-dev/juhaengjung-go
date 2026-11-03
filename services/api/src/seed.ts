/** 시연 데이터 — 금요일 퇴근길(수원 → 송파) 시나리오. 인물·매물은 모두 가상이다. */
import { DEMO_NET, kstToMs, productArt, type Availability } from "@jhgo/core";
import type { Service, User } from "./service.ts";

/** 시연 시작 시각: 2026-11-06(금) 18:05 KST */
export const DEMO_START = kstToMs(2026, 11, 6, 18, 5);

const node = (id: string) => {
  const n = DEMO_NET.nodes.find((x) => x.id === id);
  if (!n) throw new Error(id);
  return n;
};

export const PICKUP_PLACES = [
  { id: "baekhyeon", label: "판교 백현동 (아파트 정문)" },
  { id: "jeongja_side", label: "정자동 주택가" },
  { id: "yeongtong_side", label: "영통 주택가" },
  { id: "maetan_side", label: "매탄 주택가" },
  { id: "bojeong", label: "보정동 카페거리" },
  { id: "suseo", label: "수서역 공영주차장" },
  { id: "garak", label: "가락시장역 근처" },
  { id: "songpa", label: "송파 주민센터 앞" },
].map((p) => ({ ...p, lat: node(p.id).lat, lng: node(p.id).lng }));

export function placePoint(id: string) {
  const p = PICKUP_PLACES.find((x) => x.id === id)!;
  return { lat: p.lat, lng: p.lng, label: p.label };
}

const WEEKDAY_EVENING: Availability[] = [{ days: [1, 2, 3, 4, 5], from: "18:00", to: "21:00" }];
const EVERY_EVENING: Availability[] = [{ days: [0, 1, 2, 3, 4, 5, 6], from: "17:00", to: "22:00" }];

export interface SeedResult {
  buyer: User;
  sellers: Record<string, User>;
}

export function seedDemo(svc: Service, opts: { includeCarSeat?: boolean } = {}): SeedResult {
  const includeCarSeat = opts.includeCarSeat ?? true;
  const buyer = svc.createUser("buyer", "김주행");
  // 시연 구매자는 테스트 결제 수단을 미리 등록해 둔다(폰의 구매자 페이지에서 지우고 다시 등록할 수 있다)
  svc.setPaymentMethod(buyer, { kind: "test" });
  for (const [keyword, goLevel] of [
    ["카시트", "must"],
    ["유모차", "must"],
    ["아기 침대", "likely"],
    ["캠핑의자", "near"],
  ] as const)
    svc.addInterest(buyer, { type: "keyword", keyword, goLevel });

  const park = svc.createUser("seller", "박서연", { homePlace: placePoint("baekhyeon") });
  const camp = svc.createUser("seller", "이캠핑", { homePlace: placePoint("yeongtong_side") });
  const bed = svc.createUser("seller", "최보정", { homePlace: placePoint("bojeong") });
  const stroller = svc.createUser("seller", "정유진", { homePlace: placePoint("jeongja_side") });
  const sofa = svc.createUser("seller", "한소파", { homePlace: placePoint("suseo") });

  svc.createListing(camp, {
    title: "릴렉스 캠핑의자 (가방 포함)",
    description: "두 번 썼어요. 가방에 넣으면 길쭉해요.",
    category: "camping_chair",
    price: 20000,
    condition: "good",
    sizeCm: { w: 18, d: 18, h: 95 },
    sizeSource: "seller_measured",
    photos: [productArt("camping_chair")],
    pickupPoint: placePoint("yeongtong_side"),
    availability: EVERY_EVENING,
    autoAccept: true,
  });
  svc.createListing(bed, {
    title: "원목 아기 침대 (분해해 둠)",
    description: "분해해서 판재로 묶어 뒀어요. 길이가 길어요.",
    category: "baby_bed",
    price: 50000,
    condition: "fair",
    sizeCm: { w: 125, d: 68, h: 22 },
    sizeSource: "seller_measured",
    photos: [productArt("baby_bed")],
    pickupPoint: placePoint("bojeong"),
    availability: WEEKDAY_EVENING,
  });
  svc.createListing(stroller, {
    title: "디럭스 유모차 (접은 상태)",
    description: "바퀴 상태 좋아요. 접으면 트렁크에 들어가요.",
    category: "stroller",
    price: 90000,
    condition: "good",
    sizeCm: { w: 55, d: 38, h: 92 },
    sizeSource: "seller_measured",
    photos: [productArt("stroller")],
    pickupPoint: placePoint("jeongja_side"),
    availability: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "18:00", to: "22:00" }],
  });
  if (includeCarSeat)
    svc.createListing(park, {
      title: "회전형 카시트 (신생아~4세)",
      description: "아이가 커서 정리해요. 커버 세탁했어요.",
      category: "car_seat",
      price: 35000,
      condition: "good",
      sizeCm: { w: 45, d: 55, h: 68 },
      sizeSource: "seller_measured",
      photos: [productArt("car_seat")],
      pickupPoint: placePoint("baekhyeon"),
      availability: WEEKDAY_EVENING,
    });
  svc.createListing(sofa, {
    title: "3인용 패브릭 소파",
    description: "이사 가서 정리해요.",
    category: "sofa",
    price: 80000,
    condition: "good",
    sizeCm: { w: 200, d: 90, h: 85 },
    sizeSource: "seller_measured",
    photos: [productArt("sofa")],
    pickupPoint: placePoint("suseo"),
  });
  svc.createListing(sofa, {
    title: "접이식 미니벨로 자전거",
    category: "bicycle",
    price: 70000,
    condition: "fair",
    sizeCm: { w: 80, d: 40, h: 65 },
    sizeSource: "seller_measured",
    photos: [productArt("bicycle")],
    pickupPoint: placePoint("garak"),
  });
  return { buyer, sellers: { park, camp, bed, stroller, sofa } };
}
