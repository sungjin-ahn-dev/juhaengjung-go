# API_MATRIX — 주행중GO!가 쓰는 Pleos SDK

시그니처 출처: 공식 API 레퍼런스(document.pleos.ai)를 PC 브라우저로 직접 읽어 기록한 TripRoom `docs/API_MATRIX.md`(2026-10-22)와 멀미예보 `docs/API_MATRIX.md`(2026-10-22·23). 이 저장소에서는 새로 읽지 않았다.

이 저장소에서 한 확인:
- Kotlin 코드(`apps/car-android`)를 위 시그니처로 만든 스텁에 대고 컴파일했다(Kotlin 2.0.21, demo·pleos 두 플레이버 오류 0). **실제 SDK 바이너리로 한 컴파일이 아니다** — 이 작업 환경은 Google Maven·Pleos Maven이 막혀 있다.
- 웹이 브리지로 끝까지 도는지는 가짜 브리지로 확인했다(`npm run e2e:bridge`, 통과).
- 에뮬레이터·실차 동작은 **미실행**.

판정: ✅ 레퍼런스 시그니처 확인 · 📄 문서에 이름만 · ❌ 미확인 · 🧪 에뮬레이터에서 확인할 것 · ↪ 대체(확인된 API로 대신 구현)

## NaviHelper SDK 3.0.5 (`ai.pleos.playground:NaviHelper:3.0.5`)

| 기능 | 시그니처 | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 연결 | `NaviHelper(context)`, `initialize(onConnected: () -> Unit, onFailed: (Throwable) -> Unit)`, `addListener/removeListener(NaviHelperEventListener)`, `release()` | ✅ | — | PleosBackend.connectNavi | 내비 앱이 없을 때 onFailed 시점 |
| 내비 상태 | `onNavigationStatus(NavigationStatus)` {INACTIVE, INITIALIZING, FREE_DRIVE, ROUTE_DRIVE} | ✅ | 리스너 | 경로/지역 매칭 전환 | 연결 직후 한 번 오는지 |
| 상태 조회 | getter | ❌ | — | ↪ 받은 값, 없으면 목적지 유무로 추정 | |
| 목적지 | `getDestinationInfo()` → `onDestinationInfo(DestinationInfo(latitude, longitude, …, name, address, remainDistance: Int, remainTime: Int, …))` | ✅ | NAVI_ROUTE | 후보 계산, 도착 예정 | 목적지 없을 때 콜백 유무, remainTime 단위(초 추정) |
| 현재 위치 | `getCurrentLocationInfo()` → `onCurrentLocationInfo(CurrentLocationInfo(latitude, longitude, heading, address, routeId, currentRouteIndex))` | ✅ | NAVI_ROUTE | 매칭, 지도, ↪ 주행거리 누적 | 목적지 없이 달릴 때도 오는지 |
| 경유지 조회 | `getWaypointInfo()` → `onWayPointInfo(List<WaypointInfo>)` | ✅ | NAVI_ROUTE | 경유지 반영 확인, 판매자에게 도착 예정 | 경유지가 없을 때 빈 목록이 오는지 |
| 경유지 추가 | `addWaypoint(RequestWaypointInfo(latitude, longitude, poiName: String?, waypointIndex: WaypointIndex, poiId: String, address: String, poiSubId: String, poiProvider: String = ""))`, 최대 2개 | ✅ | NAVI_ROUTE_SEARCH | 수락 뒤 경유지 | ① 임의 poiId·좌표로 되는지 ② 자동 재탐색 ③ onWayPointInfo/onWaypointChanged가 오는지 |
| 경유지 삭제 | `removeWaypoint(WaypointIndex)` {FIRST, SECOND, ALL} | ✅ | NAVI_ROUTE_SEARCH | 거래 끝·취소 | |
| 경유지 변경 알림 | `onWaypointChanged(WaypointChangedInfo)` | ✅ | 리스너 | addWaypoint 대기 끝 | |
| 경유지 도착 | `onWayPointArrived(WaypointArrivedInfo)` — 필드 미확인 | ✅ 이름 · ❌ 필드 | 리스너 | ↪ 도착 지점 = 콜백 순간 현재 위치 | 도착 판정 거리, 도착한 경유지가 목록에서 빠지는지 |
| 지점까지 시간·배터리 | `requestTrip(TripRequest(latitude, longitude, poiId, poiName, poiSubId?))` → `onTripInfo(TripInfo(distance: Int, eta: Int, estimatedSocAtDest: Int, energyConsumption: Double, summary))` | ✅ 필드 · ❌ 패키지 | NAVI_ROUTE | 알림 전 도착 배터리 확인 | 안내를 바꾸지 않는지, eta 단위, 미등록 poiId |
| TBT | `getTBTInfo()` → `onTBTInfo(List<TBTInfo(type: TurnType, distance: Double, description: String)>)` | ✅ | NAVI_ROUTE | 알림 미루기(회전 300m 전) | 푸시 주기(셸은 1초 조회를 보조로 둔다) |
| 경로 옵션 | `changeRouteOption(RouteOption)` {RECOMMENDED, SHORT_DISTANCE, SHORT_TIME, FREE, HIGHWAY, COMFORTABLE, SCHOOL_ZONE}, `onRouteOptionChanged` | ✅ | NAVI_ROUTE_SEARCH | 깨지기 쉬운 물건 → 편안한 길 | onRouteOptionChanged가 오는지 |
| 경로 취소 | `cancelRoute()`, `onRouteCancelled()` | ✅ | NAVI_ROUTE_SEARCH | 목적지 사라짐 처리 | |
| 오류 | `onError(NaviErrorCode)` {CAUSE_LOW_BATTERY, CAUSE_SEARCH_ROUTE_OVER_DISTANCE, CAUSE_SEARCH_ROUTE, CAUSE_SEARCH_ROUTE_TOO_SHORT_DISTANCE, CAUSE_SEARCH_TRIP} | ✅ | 리스너 | 요청 중 경로 실패면 거래 취소 | |
| 목적지 설정 | `requestRoute(RouteInfo)`, `requestRouteWithWaypoints(RouteWithWaypointsRequest(destination: RouteInfo, waypoints))` — **RouteInfo 필드 미확인** | 📄 | NAVI_ROUTE_SEARCH | 부르지 않음(셸이 거절). 목적지는 Pleos 내비에서 | RouteInfo 필드 확인 뒤 출발 전 한 번에 설정·경유지 대체 경로에 쓴다 |
| 목적지 도착 | 전용 콜백 미확인 | ❌ | — | ↪ ROUTE_DRIVE가 300m 안에서 끝나거나 남은 거리 30m 미만 | 도착 때 상태 변화 순서 |
| 경로 선 | 없음 | — | — | 서버 경로 계산기(시연: 도로망, 서비스: 외부 길찾기 API). 차 지도도 같은 계산기로 그린다 | |

`TripRequest`·`TripInfo`·`WaypointArrivedInfo`는 다른 data 클래스와 같은 `ai.pleos.playground.navi.data` 패키지로 적었다. 실제 SDK로 컴파일할 때 오류가 나면 import 한 줄만 고치면 된다(`PleosBackend.kt` TODO(G0)).

## Vehicle SDK 2.3.2 (`ai.pleos.playground:Vehicle:2.3.2`)

| 기능 | 시그니처 | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 초기화 | `Vehicle(context)`, `initialize()`, `release()` | ✅ | — | PleosBackend.vehicle | initialize가 동기인지 |
| 2열·3열 착석 | `getSeat().registerSeatOccupancy(SeatArea(vararg SeatValue), SeatOccupancyListener)` → `onSeatOccupancyUpdated(occupancy: Boolean?)`, `unregisterSeatOccupancy`. SeatValue 범위 ROW_1_LEFT…ROW_3_RIGHT | ✅ (ROW_3_CENTER는 이름 ❌ → 쓰지 않음) | CAR_SEATS | 2열·3열을 접을 수 있는지(적재). 줄마다 따로 등록(row2: ROW_2_LEFT·CENTER·RIGHT, row3: ROW_3_LEFT·RIGHT). 이 SDK에 없는 이름은 셸이 건너뛰고 등록한 이름을 돌려준다 | Virtual Console 좌석 조작 반영, 3열 차에서 ROW_3 값이 오는지 |
| 방향지시등 | `getTurnSignal().registerTurnSignalState(TurnSignalStateListener)` → `onTurnSignalStateUpdated(TurnSignalValue?)` {OFF, LEFT, RIGHT} | ✅ | CAR_LIGHTS | 켠 동안 알림 미루기 | |
| 조향각 | `getSteeringWheel().registerSteeringWheelAngle(SteeringWheelAngleListener)` → `onSteeringWheelAngleUpdated(Float?)`, `checkSteeringWheelAngleCapabilities(onComplete: (CapabilityConfig, AreaBounds<Float>) -> Unit, onFailed)` | ✅ | CAR_DRIVE | 3.5° 넘게 꺾는 동안 알림 미루기 | 갱신 주기 |
| 브레이크 | `getBrake().registerBrakePedalStatus(BrakePedalStatusListener)` → `onBrakePedalStatusUpdated(Boolean?)` | ✅ | CAR_DRIVE | 밟는 동안 알림 미루기 | |
| 배터리 | `getEvBattery().getEvBatteryStateOfCharge(onComplete: (Int?) -> Unit, onFailed)`, `registerEvBatteryStateOfCharge(EvBatteryStateOfChargeListener)`, `checkEvBatteryStateOfChargeCapabilities(onComplete: (CapabilityConfig) -> Unit, onFailed)` | ✅ | CAR_ENERGY | 도착 배터리 15% 확인 | Energy 조작 반영 |
| 지원 확인 | `CapabilityConfig(accessType: AccessType)` {NONE, READ, WRITE, READ_WRITE} | ✅ | — | Vehicle.capabilities | |
| 차종 | CarInfo — VIN·CRN만 | 📄 | CAR_INFO | 모델명 없음 → 처음 한 번 사용자가 차종 선택 | 모델명이 있는지 |
| 주행거리 | Odometer | 📄 | — | ↪ NaviHelper 위치 누적 거리 | Odometer 시그니처 확인 뒤 교체 |
| 연료 주행 가능 거리 | Fuel | 📄 | — | 쓰지 않음(내연기관은 에너지 확인 생략) | |
| 트렁크 | Door | ❌ | — | 쓰지 않음("실으셨나요?" 없이 현장 확인) | |
| 기어·속도·주차 | 없음 | — | — | AAOS CarUxRestrictions | |

## TextToSpeech SDK 3.3.1 (`ai.pleos.playground:TextToSpeech:3.3.1`)

| 기능 | 시그니처 | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 말하기 | `TextToSpeech(context, Mode.ON_DEVICE)`, `initialize(OnInitializeListener{onSuccess, onFailure(ErrorType)})`, `addEventListener(EventListener{onReady, onStart, onUpdatedRms, onDone, onStop, onError})`, `setLocale(Locale.KOREA)`, `speak(text)`, `stop()`, `release()` | ✅ | TTS_SERVICE | 알림 문장 | ON_DEVICE 한국어, 내비 안내 음성과 겹칠 때 |

안 되면 안드로이드 `android.speech.tts.TextToSpeech`. 듣기는 안드로이드 `SpeechRecognizer`(RECORD_AUDIO) — Pleos SpeechToText는 사용 신청 준비 중이라 쓰지 않는다.

## Gleo AI 앱 연동 (App Integration Guide, `document.pleos.ai/docs/pleos-only/app-integration-guide`)

SDK가 아니라 스키마 + Intent 규약이다(2026-11-03 문서를 이 작업 환경에서 직접 읽음). 사용 신청 항목이 아니고, 스키마는 Gleo 측 검토 뒤 자동 활성화된다.

| 기능 | 규약 | 판정 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|
| 음성 기능 선언 | `assets/schema.json` — `packageName`, `appDescription`, `version`, `actionCalls`(최대 3개: `type:"function"`, `function{component:"activity"|"service", name 대문자_스네이크, description 영어, parameters(JSON Schema object, type은 string·number·boolean·array, enum은 문자열만)}`) | 📄 | `apps/car-android/app/src/main/assets/schema.json` — ADD_INTEREST(keyword, goLevel enum), ANSWER_ALERT(answer enum yes·no, item), ASK_ABOUT_LISTINGS(question → 앱 조수, silent) | 부팅 때 Gleo가 assets를 읽는지, 에뮬레이터에 Gleo가 있는지 |
| 호출 받기 | Gleo → `startActivity`(action = function 이름, extra `ACTION_PARAM` = 인자 JSON 문자열) / service면 `sendBroadcast`. 매니페스트 `<intent-filter><action name=function/><category DEFAULT/></intent-filter>` | 📄 | `MainActivity`(singleTask, `onNewIntent`) → `GleoBridge.handle` → 웹 `window.__jhgoGleo` | 실제 action·extra 이름이 문서와 같은지 |
| 결과 돌려주기 | `sendBroadcast(Intent("ai.pleos.playground.intent.action.APP_ACTION_RESPONSE").putExtra("packageName", …).putExtra("response", JSON))` — `functionName`, `status`(success·asking·fail), `message`(영어 문장), `data`(JSON 배열 문자열), `mode`(voice·beep·silent). 7초 안에 | 📄 | `GleoBridge.send`(웹이 안 답하면 5초 뒤 fail) | Gleo가 message로 뭐라고 말하는지 |

## 안드로이드 플랫폼

| 기능 | API | 쓰는 곳 | 🧪 |
|---|---|---|---|
| 주행 중 여부 | `android.car.Car.createCar`, `CarUxRestrictionsManager.getCurrentCarUxRestrictions().isRequiresDistractionOptimization` (`useLibrary("android.car")`) | 주행 중엔 알림 카드만, 정차하면 시트 | Pleos 에뮬레이터에서 값이 기어 P/D에 따라 바뀌는지 |
| 주행 중 화면 | 액티비티 `<meta-data android:name="distractionOptimized" android:value="true"/>` | 주행 중에도 앱 화면 유지 | 서드파티 앱에 허용되는지 |
| 화면 | WebView + `androidx.webkit.WebViewAssetLoader` | 서버의 `/car/` 또는 앱에 넣은 화면(`?local`) | 차량 이미지에 WebView가 있는지 |

## 에뮬레이터에서 확인할 순서

1. Android Studio에서 `apps/car-android` 열기 → `demoDebug` 실행(SDK 없이 셸·서버 연결 확인).
2. `pleosDebug` 동기화·컴파일. 오류가 나면 그 줄이 문서와 실제 SDK의 차이 → 이 표에 적는다(먼저 볼 곳: `TripRequest`·`TripInfo`·`WaypointArrivedInfo` import, `TripRequest`의 `poiSubId`).
3. PC에서 `npm start` → 에뮬레이터에서 앱 실행 → 오른쪽 아래 'SDK 기록'으로 호출·이벤트 확인. PC 크롬 `chrome://inspect`로 WebView 콘솔도 볼 수 있다.
4. Virtual Console: 좌석(2열)·방향지시등·조향·브레이크·배터리를 바꿔 'SDK 기록'에 이벤트가 오는지.
5. Pleos 내비에서 수원 → 송파 목적지 설정 → 브리핑이 열리는지 → 시뮬레이션 주행으로 알림·경유지 추가·도착까지.
6. Gleo: 에뮬레이터에 Gleo AI가 있으면 "주행중GO에 유모차 관심 추가해 줘"가 ADD_INTEREST로 들어오는지, 응답 브로드캐스트를 Gleo가 말로 읽는지. 없으면 `adb shell am start -a ADD_INTEREST --es ACTION_PARAM '{"keyword":"유모차"}' ai.jhgo.car`로 Intent 경로만 확인.
7. 위 🧪 열의 결과를 이 표에 적고, 대체(↪)로 둔 것 중 확인된 API가 생기면 교체한다.
