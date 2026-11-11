/**
 * 시연 지역 도로망 — 수원 → 분당·판교 → 송파 (금요일 퇴근길 가정).
 * 좌표는 지도 표시와 시연용 근삿값이고, 속도는 퇴근 시간 정체를 반영한 가정값이다.
 * 실제 서비스의 경로·시간은 외부 길찾기 API가 계산한다(RoutingProvider 교체).
 */
import type { RoadNet } from "../roadnet.ts";

export const DEMO_NET: RoadNet = {
  nodes: [
    // 수원
    { id: "suwon_cityhall", name: "수원시청", lat: 37.2636, lng: 127.0286, label: true },
    { id: "ingye", name: "인계동", lat: 37.2668, lng: 127.0352, label: true },
    { id: "maetan", name: "매탄동", lat: 37.2662, lng: 127.0466, label: true },
    { id: "maetan_side", name: "매탄 주택가", lat: 37.2702, lng: 127.0523, label: false },
    { id: "woncheon", name: "원천동", lat: 37.2758, lng: 127.0598, label: true },
    { id: "yeongtong", name: "영통", lat: 37.2556, lng: 127.0718, label: true },
    { id: "yeongtong_side", name: "영통 주택가", lat: 37.2534, lng: 127.0722, label: false },
    { id: "mangpo", name: "망포", lat: 37.2457, lng: 127.0573, label: true },
    { id: "gwanggyo", name: "광교", lat: 37.2885, lng: 127.0517, label: true },
    { id: "heungdeok", name: "흥덕", lat: 37.2786, lng: 127.0772, label: true },
    { id: "singal_ic", name: "수원신갈IC", lat: 37.2737, lng: 127.0938, label: true },
    { id: "singal_jc", name: "신갈JC", lat: 37.2858, lng: 127.1006, label: true },
    { id: "giheung", name: "기흥", lat: 37.2757, lng: 127.1159, label: true },
    // 용인 수지·죽전
    { id: "suji_ic", name: "수지IC", lat: 37.3165, lng: 127.1029, label: true },
    { id: "jukjeon", name: "죽전", lat: 37.3247, lng: 127.1076, label: true },
    { id: "bojeong", name: "보정동 카페거리", lat: 37.3132, lng: 127.1168, label: false },
    { id: "suji", name: "수지", lat: 37.3221, lng: 127.0975, label: true },
    // 분당
    { id: "ori", name: "오리", lat: 37.3398, lng: 127.1093, label: true },
    { id: "migeum", name: "미금", lat: 37.3500, lng: 127.1089, label: true },
    { id: "jeongja", name: "정자", lat: 37.3670, lng: 127.1083, label: true },
    { id: "jeongja_side", name: "정자동 주택가", lat: 37.3652, lng: 127.0991, label: false },
    { id: "sunae", name: "수내", lat: 37.3784, lng: 127.1144, label: true },
    { id: "seohyeon", name: "서현", lat: 37.3846, lng: 127.1232, label: true },
    { id: "yatap", name: "야탑", lat: 37.4113, lng: 127.1286, label: true },
    { id: "moran", name: "모란", lat: 37.4321, lng: 127.1290, label: true },
    // 판교
    { id: "pangyo", name: "판교", lat: 37.3948, lng: 127.1112, label: true },
    { id: "baekhyeon", name: "백현동", lat: 37.3889, lng: 127.1046, label: false },
    { id: "seopangyo", name: "서판교", lat: 37.3910, lng: 127.0840, label: true },
    { id: "pangyo_jc", name: "판교JC", lat: 37.4040, lng: 127.1050, label: true },
    { id: "geumto", name: "금토", lat: 37.4200, lng: 127.0960, label: true },
    // 서울 동남권
    { id: "heolleung", name: "헌릉IC", lat: 37.4610, lng: 127.0820, label: true },
    { id: "segok", name: "세곡", lat: 37.4650, lng: 127.1050, label: true },
    { id: "bokjeong", name: "복정", lat: 37.4704, lng: 127.1262, label: true },
    { id: "suseo", name: "수서", lat: 37.4875, lng: 127.1018, label: true },
    { id: "munjeong", name: "문정", lat: 37.4858, lng: 127.1225, label: true },
    { id: "garak", name: "가락시장", lat: 37.4926, lng: 127.1183, label: true },
    { id: "songpa", name: "송파", lat: 37.4995, lng: 127.1123, label: true },
    { id: "songpa_home", name: "송파 집", lat: 37.5021, lng: 127.1178, label: false },
    { id: "jamsil", name: "잠실", lat: 37.5133, lng: 127.1001, label: true },
  ],
  edges: [
    // 수원 시내
    { from: "suwon_cityhall", to: "ingye", name: "효원로", cls: "arterial", speedKph: 38 },
    { from: "ingye", to: "maetan", name: "중부대로", cls: "arterial", speedKph: 42 },
    { from: "maetan", to: "yeongtong", name: "중부대로", cls: "arterial", speedKph: 42, shape: [{ lat: 37.2611, lng: 127.0590 }] },
    { from: "maetan", to: "maetan_side", name: "매탄로", cls: "local", speedKph: 25 },
    { from: "maetan", to: "woncheon", name: "원천로", cls: "arterial", speedKph: 35 },
    { from: "woncheon", to: "gwanggyo", name: "광교로", cls: "arterial", speedKph: 40 },
    { from: "woncheon", to: "heungdeok", name: "원천로", cls: "arterial", speedKph: 35 },
    { from: "yeongtong", to: "yeongtong_side", name: "영통로", cls: "local", speedKph: 25 },
    { from: "yeongtong", to: "mangpo", name: "영통로", cls: "local", speedKph: 30 },
    { from: "yeongtong", to: "heungdeok", name: "영통로", cls: "arterial", speedKph: 38 },
    { from: "yeongtong", to: "singal_ic", name: "중부대로", cls: "arterial", speedKph: 48, shape: [{ lat: 37.2652, lng: 127.0839 }] },
    { from: "heungdeok", to: "singal_ic", name: "흥덕중앙로", cls: "local", speedKph: 30 },
    { from: "singal_ic", to: "giheung", name: "신갈로", cls: "local", speedKph: 30 },
    // 경부고속도로 (퇴근길 정체)
    { from: "singal_ic", to: "singal_jc", name: "경부고속도로", cls: "expressway", speedKph: 70 },
    { from: "singal_jc", to: "suji_ic", name: "경부고속도로", cls: "expressway", speedKph: 62, shape: [{ lat: 37.3000, lng: 127.1040 }] },
    { from: "suji_ic", to: "pangyo_jc", name: "경부고속도로", cls: "expressway", speedKph: 34, shape: [{ lat: 37.3480, lng: 127.1000 }, { lat: 37.3800, lng: 127.0985 }] },
    // 죽전·수지
    { from: "suji_ic", to: "jukjeon", name: "포은대로", cls: "arterial", speedKph: 40 },
    { from: "jukjeon", to: "bojeong", name: "죽전로", cls: "local", speedKph: 25 },
    { from: "jukjeon", to: "suji", name: "포은대로", cls: "arterial", speedKph: 38 },
    // 성남대로 (분당 관통)
    { from: "jukjeon", to: "ori", name: "성남대로", cls: "arterial", speedKph: 50 },
    { from: "ori", to: "migeum", name: "성남대로", cls: "arterial", speedKph: 50 },
    { from: "migeum", to: "jeongja", name: "성남대로", cls: "arterial", speedKph: 50 },
    { from: "jeongja", to: "sunae", name: "성남대로", cls: "arterial", speedKph: 46 },
    { from: "sunae", to: "seohyeon", name: "성남대로", cls: "arterial", speedKph: 44 },
    { from: "seohyeon", to: "yatap", name: "성남대로", cls: "arterial", speedKph: 44 },
    { from: "yatap", to: "moran", name: "성남대로", cls: "arterial", speedKph: 40 },
    { from: "moran", to: "bokjeong", name: "성남대로", cls: "arterial", speedKph: 36 },
    { from: "jeongja", to: "jeongja_side", name: "느티로", cls: "local", speedKph: 25 },
    // 판교
    { from: "jeongja", to: "pangyo", name: "판교로", cls: "arterial", speedKph: 44, shape: [{ lat: 37.3812, lng: 127.1090 }] },
    { from: "pangyo", to: "baekhyeon", name: "백현로", cls: "local", speedKph: 25 },
    { from: "pangyo", to: "pangyo_jc", name: "판교로", cls: "arterial", speedKph: 40 },
    { from: "pangyo", to: "seopangyo", name: "운중로", cls: "arterial", speedKph: 38 },
    { from: "pangyo_jc", to: "geumto", name: "경부고속도로", cls: "expressway", speedKph: 36 },
    { from: "geumto", to: "heolleung", name: "경부고속도로", cls: "expressway", speedKph: 36 },
    // 분당수서로 (도시고속도로)
    { from: "pangyo", to: "segok", name: "분당수서로", cls: "urban_expressway", speedKph: 66, shape: [{ lat: 37.4100, lng: 127.1150 }, { lat: 37.4400, lng: 127.1120 }] },
    // 용인서울고속도로 (정체)
    { from: "heungdeok", to: "seopangyo", name: "용인서울고속도로", cls: "expressway", speedKph: 36, shape: [{ lat: 37.3200, lng: 127.0800 }, { lat: 37.3600, lng: 127.0820 }] },
    { from: "seopangyo", to: "heolleung", name: "용인서울고속도로", cls: "expressway", speedKph: 40, shape: [{ lat: 37.4300, lng: 127.0830 }] },
    // 서울 동남권
    { from: "heolleung", to: "segok", name: "헌릉로", cls: "arterial", speedKph: 40 },
    { from: "segok", to: "suseo", name: "밤고개로", cls: "arterial", speedKph: 42 },
    { from: "segok", to: "bokjeong", name: "헌릉로", cls: "arterial", speedKph: 40 },
    { from: "suseo", to: "garak", name: "양재대로", cls: "arterial", speedKph: 38 },
    { from: "bokjeong", to: "munjeong", name: "송파대로", cls: "arterial", speedKph: 40 },
    { from: "munjeong", to: "garak", name: "송파대로", cls: "arterial", speedKph: 38 },
    { from: "garak", to: "songpa", name: "송파대로", cls: "arterial", speedKph: 36 },
    { from: "songpa", to: "songpa_home", name: "백제고분로", cls: "local", speedKph: 25 },
    { from: "songpa", to: "jamsil", name: "송파대로", cls: "arterial", speedKph: 34 },
  ],
};

/** 시연에서 쓰는 장소 */
export const DEMO_PLACES = {
  start: { name: "수원시청", lat: 37.2636, lng: 127.0286 },
  home: { name: "송파 집", lat: 37.5021, lng: 127.1178 },
  jamsil: { name: "잠실역", lat: 37.5133, lng: 127.1001 },
  pangyoOffice: { name: "판교 회사", lat: 37.3948, lng: 127.1112 },
} as const;
