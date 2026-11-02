# TASKS — 기능별 구현 위치와 확인

기획서(`01_기획서.md`) 7·8·11절의 기능을 T1~T19로 나눴다. 확인 열의 이름은 테스트 `describe`/`it` 또는 E2E 단계다.

- 단위·API 테스트: `npm test` (vitest, 76개)
- 시뮬레이터 E2E: `npm run e2e` (`tools/e2e.cjs`) — 판매자 폰 + 차량 화면
- 브리지 계약 시험: `npm run e2e:bridge` (`tools/bridge-contract.ts`) — 실제 SDK 모드(가짜 브리지)

| T | 기능 | 구현 | 확인 |
|---|---|---|---|
| T1 | 매칭 모드: 경로 안내 중 → 경로 매칭, 자유 주행 → 지역 매칭 | `core/matching.ts` `decideMode`, 차 `controller.tick`(getNavigationStatus) | T1 테스트 2개, E2E 전체 |
| T2 | 경로 근처 후보(2.5km 안, 경로 순서) | `core/matching.ts` `evaluate`, `core/roadnet.ts` `GraphRouter`(도로 구간 붙이기) | T2 테스트 3개, 경로 계산 테스트 7개 |
| T3 | 우회 시간 = 갈림 지점→매물 + 매물→목적지 − 갈림 지점→목적지 + 거래 90초. 정확한 지점의 `requestTrip`이 있으면 내비 값끼리 비교 | `core/matching.ts` | T3 테스트 5개(주행 중 흔들리지 않음 포함) |
| T4 | 에너지: 도착 배터리 15%·주행 가능 거리 | `core/energy.ts`, 차 `requestTrip` → `estimatedSocAtDest` | T4 테스트 4개, API "배터리가 부족하면…" |
| T5 | 적재: 트렁크에 쏙 / 2열 접으면 가능 / 안 들어감, 2열 착석이면 접기 제외 | `core/load.ts` `fitItem`·`VEHICLE_TABLE`, 차 Seat 리스너 | T5 테스트 2개, E2E 브리핑 "2열에 사람이 있어…" |
| T6 | 제외: 판매자 시간·경유지 2개·이미 지남·이번 주행 거절·응답률 | `core/matching.ts` exclusions | T6 테스트 4개 |
| T7 | 점수 (0.35G + 0.2W + 0.2P + 0.25D) × M, 1위만, 비슷하면 경합 | `core/matching.ts`, 차 `showContention` | T7 테스트 4개, E2E "경합 질문" |
| T8 | 말할 때: 회전 300m 전·방향지시등·조향 3.5°·제동 중에는 미루고 2.5초 뒤 | `core/timing.ts` `AlertGate`, 차 `controller.tick` | T8 테스트 2개, E2E "방향지시등이 켜진 동안 알림 대기" |
| T9 | 요청: 판매자에게 알림, 우회 지점 전까지 유효, 지나면 만료 | `core/trade.ts` `createTrade`·EXPIRE, `service.request`·`driveContext` | T9 테스트 2개, API "응답 없이 우회 지점을 지나면…" |
| T10 | 수락: 대금 보관·매물 예약 → `addWaypoint` → `getWaypointInfo`로 확인 → 확정. 자동 수락 | `core/trade.ts` accept, 차 `onAccepted`(한 번만) | T10 테스트 3개, E2E·브리지 "addWaypoint … 확인 → 확정" |
| T11 | 도착 예정 공유(1분 넘게 바뀔 때만), 3분 전 "나오세요", `onWayPointArrived` → "도착했어요" | `core/trade.ts`, 차 ETA 보내기·`onWaypointArrived` | T11 테스트, E2E "도착 3분 전 '나오세요'", 브리지 "onWayPointArrived" |
| T12 | 현장 확인: 받았어요 / 안 살게요(전액 환불), 트렁크 닫힘 → "실으셨나요?" | `core/trade.ts`, 차 현장 확인 시트, 판매자 "건넸어요" | T12 테스트 3개, E2E 현장 확인, API 불일치 환불 |
| T13 | 정산(이의 제기 기간 뒤)·취소·노쇼·평가·신뢰도 | `core/trade.ts` TICK, `service.applyEffects`, 판매자 정산 탭 | T13 테스트 6개, E2E "35,000원 정산" |
| T14 | 개인화: 다른 날 두 번 지나치면 ×0.9(하한 0.5), 거래 성사 ×1.05(상한 1.2) | `core/personalization.ts`, `service.driveContext` | T14 테스트 2개, API 개인화 |
| T15 | 알림과 응답: 한 번에 하나, 음성 + 큰 버튼, 정해진 단어로만 답, 15초 뒤 닫힘, 결과 카드 | 차 `showAlert`·`listenAnswer`, `pleos/voice.ts`(웹), `NativeVoice.kt`(Pleos TTS → 안드로이드), `GoPanel`·결과 시트 | E2E 알림·결과 카드, 브리지 "Voice.speak" |
| T16 | 출발 전 브리핑: 경로 위 관심 매물 + 제외 이유, 미리 요청 | `service.briefing`, 차 브리핑 시트 | T2+T16 테스트, API 브리핑, E2E·브리지 브리핑 |
| T17 | 같이 올리기: 붙여넣기 → 제목·가격·품목, AI 크기, 60cm 넘으면 실측 확인 | `core/text.ts`, 판매자 등록 화면 | T17 테스트 6개, API T17, E2E 등록 |
| T18 | 개인정보: 구매자 위치·경로는 주행 세션 메모리에만, 판매자는 도착 예정만, 정확한 지점은 수락 뒤, 대략 위치 150~350m 이동, 이름 가림 | `service.ts`(DriveSession·buyerTradeView·maskName), `core/geo.ts` `approxArea` | API 브리핑 "정확한 위치는 안 보인다", 경로 테스트 "가짜 중심", E2E "판매자 화면에 구매자 위치 없음" |
| T19 | 오류 처리: 내비 오류·경유지 실패면 판매자 요청 취소(구매자 신뢰도 제외), `requestTrip` 실패는 거래와 무관 | 차 `onNaviError`·`onAccepted` 대체, `core/trade.ts` BUYER_CANCEL `system` | T19 테스트, 브리지 "경유지 실패 → 취소 … 신뢰도에 넣지 않음" |

## 화면

| 화면 | 위치 |
|---|---|
| 차량(내비 화면 1280×720) | `apps/car-web` — 지도·TBT·도착 예정·GO 패널·시트(목적지·브리핑·관심사·현장 확인·결과·차종) |
| 판매자 폰 | `apps/seller-web` — 내 물건·거래·정산, 요청 전체 화면 |
| 차량 앱 셸 | `apps/car-android` — WebView + Pleos SDK 브리지(`docs/BRIDGE.md`) |
| 체험 페이지 | `apps/demo` — 두 앱 + 페이지 안 서버, 한 파일 |
