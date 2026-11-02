# STATUS

최종 갱신: 2026-11-03 (Asia/Seoul)

## 지금 되는 것

- **판매자 폰** (`/seller/`): 같이 올리기(붙여넣기 → 제목·가격·품목, AI 크기, 60cm 넘으면 실측 확인), 가능 시간·자동 수락, 차가 요청하면 전체 화면(도착 예정·차종·실을 수 있는지·구매자 가린 이름), 수락·거절, 진행(오는 중·곧 도착·도착), 건넸어요, 정산·원장, 평가.
- **차량 화면** (`/car/`): 1280×720 내비 화면. 지도(주행 중 진행 방향 위, 정차 중 전체), TBT, 도착 예정·배터리, GO 패널(감시 중·알림·경합·거래 단계), 정차 시트(목적지·출발 전 브리핑·관심사·현장 확인·결과 카드·차종 고르기).
- **서버** (`services/api`): 매칭·브리핑·알림 억제·개인화·거래 상태 머신·대금 보관과 정산(시연 원장)·신뢰도·실시간 알림(SSE)·SQLite 저장소.
- **차량 앱 셸** (`apps/car-android`): WebView + Pleos SDK 브리지. NaviHelper·Vehicle·TextToSpeech를 확인된 시그니처로 부르고, 미확인 기능은 확인된 API로 대체(`docs/API_MATRIX.md`).
- **체험 페이지** (`apps/demo`): 판매자 폰 + 차량 화면 + 가상 콘솔이 페이지 안 서버로 함께 움직인다. 공유 페이지로 게시: https://claude.ai/artifact/2KLb5hBdgHzuT1Bz844rLL (비공개, 공유는 페이지의 공유 메뉴에서).

## 확인한 것

| 확인 | 결과 |
|---|---|
| 단위·API 테스트 `npm test` | 76개 통과 (core 61, api 15) |
| 타입 검사 (core·api·car-web·seller-web·demo) | 통과 |
| 시뮬레이터 E2E `npm run e2e` | 통과 — 등록(실측 확인) → 브리핑(2열 착석 제외) → 방향지시등 동안 알림 대기 → 캠핑의자 알림 → 카시트·유모차 경합 → 판매자 전체 화면 수락(구매자 위치 없음) → addWaypoint → 3분 전 나오세요 → onWayPointArrived → 트렁크 → 건넸어요 → 받았어요 → 정산 35,000원 → 결과 카드 |
| 브리지 계약 시험 `npm run e2e:bridge` | 통과 — 실제 SDK 모드(가짜 브리지, Kotlin과 같은 프로토콜): 리스너 등록, 내비 목적지 → 브리핑, requestTrip, Voice.speak, 경유지 실패 → 취소(신뢰도 제외)·경유지 중복 방지, addWaypoint → getWaypointInfo 확인, 도착 → 현장 확인 → 결과, 목적지 설정 API 미사용 |
| Android 셸 Kotlin | 레퍼런스 시그니처로 만든 스텁에 대고 컴파일(Kotlin 2.0.21) demo·pleos 오류 0. **실제 SDK·Android SDK로 빌드하지 않았다** |
| 화면 크기 | 차량 화면은 1920×720·1280×720·1024×768에서 넘침 없음, 체험 페이지는 400px 폭에서 가로 스크롤 없음 |

## 미실행 (사람의 조치 필요)

1. **Android 빌드**: PC Android Studio에서 `apps/car-android` 열기 또는 `apps\car-android\build.bat` → `demoDebug`·`pleosDebug`. 오류가 나면 그 줄이 문서와 실제 SDK의 차이다(먼저 볼 곳: `PleosBackend.kt`의 `TripRequest`·`TripInfo`·`WaypointArrivedInfo` import, `TripRequest(poiSubId = null)`).
2. **Pleos Connect 에뮬레이터 확인**: `docs/API_MATRIX.md` 마지막 절 순서대로. 특히 addWaypoint 임의 좌표, onWayPointArrived, CarUxRestrictions, WebView 유무, 주행 중 화면 허용(distractionOptimized).
3. **폰 실기기**: 같은 와이파이에서 `http://<PC IP>:8787/seller/` (서버가 시작할 때 주소를 찍는다).

## 알려진 한계

- 경로 계산은 시연 지역 도로망(수원~송파)뿐이다. 실제 서비스는 같은 인터페이스(`RoutingProvider`)에 외부 길찾기 API를 붙인다. 에뮬레이터 시연도 이 지역에서 해야 매물이 경로 위에 잡힌다.
- 대금 보관·정산은 시연 원장이다(실제 결제 대행 연동 없음).
- 판매자 알림은 페이지가 열려 있을 때 실시간 알림(SSE)과 소리·진동이다. 기획서의 웹 푸시는 아직 없다.
- 판매자 사진은 샘플 이미지와 직접 고른 사진만. 사진으로 크기 추정은 품목 대표 크기 표(AI 추정 자리)다.
- 실제 SDK 모드의 지도 경로 선은 NaviHelper가 경로 선을 주지 않아 서버와 같은 계산기로 그린 근사다.

## 기록

- 11-02 기획서 v2(구매자·판매자 가치, Pleos SDK 활용 설계).
- 11-03 핵심 로직(core)·서버(api) 테스트 73개 → 판매자 앱·차량 화면 → 끝까지 E2E. 경로 계산을 도로 구간 기준으로 바꾸고 우회 시간을 갈림 지점 기준으로(주행 중 값 흔들림 제거).
- 11-03 Android 셸·Pleos 브리지·브리지 계약 시험, 오류 처리(T19: 차 쪽 실패 취소는 구매자 신뢰도 제외, 자동 수락 때 경유지 중복 방지), 체험 페이지 게시.
