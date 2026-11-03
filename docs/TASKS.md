# TASKS — 기능별 구현 위치와 확인

기획서(`01_기획서.md`) 7·8·11절의 기능을 T1~T30으로 나눴다. 확인 열의 이름은 테스트 `describe`/`it` 또는 E2E 단계다.
**완료 기준:** 서버 테스트와 함께 그 기능을 쓰는 사람(구매자·판매자)의 화면 경로가 있어야 한다. 서버만 있고 화면이 없으면 완료로 치지 않는다.
기획서 문장마다 화면 경로를 맞춰 본 표는 `docs/SPEC_CHECK.md`.

- 단위·API 테스트: `npm test` (vitest, 102개: core 73, api 29)
- 시뮬레이터 E2E: `npm run e2e` (`tools/e2e.cjs`) — 판매자 폰 + 차량 화면 끝까지, 2부 판매자 미응대, 3부 구매자 폰
- 브리지 계약 시험: `npm run e2e:bridge` (`tools/bridge-contract.ts`) — 실제 SDK 모드(가짜 브리지)
- 시연 영상: `tools/record-demo.ts`(체험 페이지 → 장면별 MP4), `JHGO_RECORD=<폴더> npm run e2e:bridge`(SDK 모드), 자르기 공통 `tools/video-cut.ts`

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
| T12 | 현장 확인: 받았어요 / 안 살게요(전액 환불, 사유), 사진은 거절 뒤 구매자 폰에서. 트렁크 닫힘 → "실으셨나요?"는 Door 확인 전까지 시뮬레이터에서만 | `core/trade.ts`(BUYER_EVIDENCE), 차 현장 확인 시트, 판매자 "건넸어요"·지난 거래 사진, 구매자 폰 '현장 사진 남기기' | T12 테스트 4개, E2E 현장 확인, API 불일치 환불·현장 사진 |
| T13 | 정산(이의 제기 기간 뒤)·취소·노쇼·신뢰도 | `core/trade.ts` TICK, `service.applyEffects`, 판매자 정산 탭 | T13 테스트 6개, E2E "35,000원 정산" |
| T14 | 개인화: 다른 날 두 번 지나치면 ×0.9(하한 0.5), 거래 성사 ×1.05(상한 1.2) | `core/personalization.ts`, `service.driveContext` | T14 테스트 2개, API 개인화 |
| T15 | 알림과 응답: 한 번에 하나, 음성 + 큰 버튼, 정해진 단어로만 답, 15초 뒤 닫힘, 결과 카드 | 차 `showAlert`·`listenAnswer`, `pleos/voice.ts`(웹), `NativeVoice.kt`(Pleos TTS → 안드로이드), `GoPanel`·결과 시트 | E2E 알림·결과 카드, 브리지 "Voice.speak" |
| T16 | 출발 전 브리핑: 경로 위 관심 매물 + 제외 이유, 미리 요청. 지도 번호·사진 핀과 오른쪽 추천순 목록(주행 중엔 큰 글씨 3줄) | `service.briefing`, 차 `ui/GoList.tsx`(목록·순위)·`ui/MapView.tsx`(핀) | T2+T16 테스트, API 브리핑, E2E 추천 목록(순위·핀 연동)·브리지 브리핑 |
| T17 | 같이 올리기: 붙여넣기 → 제목·가격·품목, 품목 기본 크기(사진 AI는 T25), 60cm 넘으면 실측 확인 | `core/text.ts`, 판매자 등록 화면 | T17 테스트 6개, API T17, E2E 등록·"품목 기본 크기" 표시 |
| T18 | 개인정보: 구매자 위치·경로는 주행 세션 메모리에만, 판매자는 도착 예정만, 정확한 지점은 수락 뒤, 대략 위치 150~350m 이동, 이름 가림. 수락 전 후보 보기에는 정확한 지점으로 잰 값이 없다(거리는 대략 위치 기준 100m 단위) | `service.ts`(DriveSession·candidateView·buyerTradeView·maskName), `core/geo.ts` `approxArea` | API 브리핑 "정확한 위치는 안 보인다", 경로 테스트 "가짜 중심", E2E "판매자 화면에 구매자 위치 없음" |
| T19 | 오류 처리: 내비 오류·경유지 실패면 판매자 요청 취소(구매자 신뢰도·요청 제한 제외, `canceledBy: system`), `requestTrip` 실패는 거래와 무관 | 차 `onNaviError`·`onAccepted` 대체, `core/trade.ts` BUYER_CANCEL `system` | T19 테스트, 브리지 "경유지 실패 → 취소 … 신뢰도에 넣지 않음" |
| T20 | 판매자 미응대: 도착 뒤 '판매자에게 다시 알리기'(1분에 한 번), 도착 5분 뒤 '판매자가 안 나왔어요' → 전액 환불·경유지 해제·판매자 신뢰도(noShow)·추천 점수 R | `core/trade.ts` BUYER_NUDGE·BUYER_REPORT_SELLER_ABSENT, 차 `WaitPanel`(현장 확인 시트), 판매자 '구매자가 기다리고 있어요' | T20 테스트 4개, API T20, E2E 2부 |
| T21 | 구매자 → 판매자 평가: 목적지 도착 결과 카드(정차)에서 별 1~5, 구매자 폰 지난 거래에서도. 판매자 평점에 반영 | 차 결과 시트, `apps/buyer-web` 거래 탭, `RATE by buyer` | API T21, E2E "결과 카드에서 판매자 평가 → 판매자 폰 평점 4" |
| T22 | 요청 제한: 수락 뒤 구매자 취소·노쇼가 최근 30일 3번이면 마지막 건부터 7일. 그동안 알림을 띄우지 않고 이유를 보여 준다 | `core/trade.ts` `requestBlock`, `service.blockFor`·`request`, 차 목록 안내, 구매자 폰 머리 안내 | T22 테스트 2개, API T22 |
| T23 | 결제 수단: 시연은 테스트 결제 수단만(카드 번호를 받지 않음). 없으면 알림을 띄우지 않고 요청을 막는다 | `service.setPaymentMethod`·`blockFor`, `apps/buyer-web` 결제 탭, 차 관심사 시트 결제 수단 줄 | API T23, E2E 3부 |
| T24 | 판매자 웹 푸시: 서비스 워커·VAPID, 판매자 알림 전부를 푸시로도(차가 오는 요청은 놓치지 않게), 끝난 구독 정리. HTTPS 주소에서만 | `services/api/src/push.ts`·`push-node.ts`, `apps/seller-web/public/sw.js`·`src/push.ts`, 거래 탭 '알림 받기' | API T24(가짜 발송기), E2E '알림 받기' 줄. 폰 실제 수신은 미실행 |
| T25 | 사진으로 크기 추정: 서버에 `ANTHROPIC_API_KEY`가 있으면 Claude 비전, 없거나 실패하면 품목 기본 크기로 채우고 그렇게 표시 | `services/api/src/size-ai.ts`·`size-ai-claude.ts`, `service.estimateSizeFor`, 판매자 '사진으로 크기 채우기' | API T25(가짜 추정기·JSON 파싱). 실제 API 호출은 미실행 |
| T26 | 3열 차 적재: 3열 세운 트렁크 → 3열 접으면 → 2·3열 접으면, 3열 착석이면 접는 칸 제외. Seat는 줄마다 따로 등록(ROW_3_LEFT·RIGHT) | `core/load.ts`(row3Up)·`matching.ts`(load_seat3), 차 3열 리스너·콘솔 '3열 착석', 브리지 tag | 매칭 테스트, API T26, 브리지 "줄마다 온 착석 이벤트" |
| T27 | 판매자 편의: 잠깐 쉬기(1시간·오늘은 그만·다시 켤 때까지 — 그동안 매칭에서 빠지고 요청도 거절), 요청 화면 '오늘은 그만 받을래요'(거절 + 오늘 쉬기), 마지막 등록의 장소·시간·바로 확정을 다음 등록 기본값으로 | `core/time.ts` `pauseActive`·`nextKstMidnight`·`nextAvailableAt`, `service.setPause`·`evalFor`·`request`·`createListing`(sellerDefaults), 판매자 홈 머리(받는 중/쉬는 중/몇 시부터) | 시간 테스트, API "쉬는 동안…", "등록하면 장소·시간…", E2E "잠깐 쉬기 1시간 → 다시 받기" |
| T28 | 판매자 '지금 나가요': 만남 화면에서 한 번 누르면 구매자 차 거래 카드·현장 확인 기다림 패널에 '판매자가 나오고 있어요'. 채팅은 만들지 않는다(정해진 신호 하나) | `core/trade.ts` SELLER_COMING, 판매자 `Moments.tsx` 만남 화면, 차 `GoPanel`·`WaitPanel` | T28 테스트, API T28, E2E "지금 나가요 → 차 화면" |
| T29 | 노출 수: 들를 수 있는 추천으로 든 주행 수·음성 알림 수를 매물마다(주행마다 한 번). 판매자에게만, 누가 봤는지는 남기지 않는다 | `service.countShown`·`markAlerted`, `Listing.stats`, 판매자 물건 줄 '지나간 차 N대에 보였어요' | API T29, E2E "지나간 차 1대에 보였어요" |
| T30 | 폰 화면 개편: 판매자 홈(받는 중 한 문장·진행 중 거래·물건 줄), 같이 올리기(붙여 넣으면 바로 채움·확인할 것만·하단 고정 올리기·올린 뒤 안내), 요청·만남 전체 화면(만남은 구매자가 끝낼 수 있게 되기까지 남은 시간), 물건 판(가격·시간·바로 확정·판매 완료, 되돌리기), 구매자 홈(내 차 준비 체크)·관심 물건(빠른 추가·등급별 우회 시간)·거래 상세(대금 흐름·시간순 기록) | `apps/seller-web/src/*`(styles.css 디자인 시스템, kit.tsx), `apps/buyer-web`, 물건 그림 `core/art.ts`, 글꼴 `assets/JHGOSans.woff2` | E2E 1·3부, 화면 캡처 확인(390px) |

## 화면

| 화면 | 위치 |
|---|---|
| 차량(내비 화면 1280×720) | `apps/car-web` — 지도(번호·사진 핀)·추천 목록·TBT·도착 예정·GO 패널·시트(목적지·관심사·현장 확인·결과·차종) |
| 판매자 폰 | `apps/seller-web` — 내 물건(받는 중·쉬기·노출 수)·거래·정산, 요청·만남 전체 화면, 같이 올리기, 알림 받기(웹 푸시), 홈 화면 추가 |
| 구매자 폰 | `apps/buyer-web` (`/buyer/`) — 홈(내 차 준비 체크: 결제 수단·관심 물건·차종), 관심 물건·등급별 우회 시간, 거래 내역·상세(대금 흐름·평가·현장 사진) |
| 차량 앱 셸 | `apps/car-android` — WebView + Pleos SDK 브리지(`docs/BRIDGE.md`) |
| 체험 페이지 | `apps/demo` — 차 화면 + 판매자 폰·구매자 폰(위 버튼으로 바꾸기) + 페이지 안 서버, 한 파일. `?compose`면 카시트를 미리 올리지 않는다(녹화에서 판매자가 직접 등록) |
