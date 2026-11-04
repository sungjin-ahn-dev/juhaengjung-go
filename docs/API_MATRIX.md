# API_MATRIX — 주행중GO!가 쓰는 Pleos SDK

시그니처 출처(새 것이 앞):
1. **실제 SDK 바이너리(2026-11-04)** — PC에서 `pleosDebug`를 실제 SDK로 빌드한 뒤 라이브러리 dex의 Kotlin 메타데이터를 풀어 매개변수 이름·순서·null 가능 여부·기본값까지 확인했다. 방법은 `tools/sdk-dump/README.md`, 결과는 `tools/sdk-dump/pleos-sdk-signatures.txt`(쓰는 클래스만, 126개).
2. 공식 문서(document.pleos.ai) — Gleo AI 앱 연동 가이드(2026-11-03·04), SpeechToText 가이드(2026-11-04), 그리고 TripRoom·멀미예보가 PC 브라우저로 읽어 둔 API 레퍼런스(2026-10-22·23).

이 저장소에서 한 확인:
- **실제 SDK로 컴파일·패키징 성공(2026-11-04, PC)**: `pleosDebug`(30.7 MB)·`pleosRelease`(27.8 MB, `apk/juhaengjung-go_pleos_release.apk`). 문서와 다르던 곳은 `onFailed` 하나였다(아래 Vehicle 리스너).
- Kotlin 코드는 이 표의 시그니처로 만든 스텁에도 컴파일된다(Kotlin 2.0.21, 오류 0) — 저장소 밖(PC 없이)에서 고칠 때 최소 확인용.
- 웹이 브리지로 끝까지 도는지는 가짜 브리지로 확인했다(`npm run e2e:bridge`, 통과).
- **에뮬레이터·실차 동작은 미실행** — 아래 🧪 열은 전부 비어 있다. 에뮬레이터는 Android Studio에 Pleos Connect 이미지(2.1.0, API 34)를 받아 만들어야 한다(README).

판정: ✅ 바이너리 확인(1) · ✅📄 문서로만 확인(2) · 📄 이름만 · ❌ 미확인 · 🧪 에뮬레이터에서 확인할 것 · ↪ 대체(확인된 API로 대신 구현)

## NaviHelper SDK 3.0.5 (`ai.pleos.playground:NaviHelper:3.0.5`)

| 기능 | 시그니처(바이너리) | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 연결 | `NaviHelper(context)`, `initialize(onConnected: () -> Unit, onFailed: (Throwable) -> Unit)`(`initialize()`도 있음), `addListener/removeListener(NaviHelperEventListener)`, `release()` | ✅ | — | PleosBackend.connectNavi | 내비 앱이 없을 때 onFailed 시점 |
| 내비 상태 | `onNavigationStatus(status: NavigationStatus)` {INACTIVE, INITIALIZING, FREE_DRIVE, ROUTE_DRIVE} | ✅ | 리스너 | 경로/지역 매칭 전환 | 연결 직후 한 번 오는지 |
| 상태 조회 | getter **없음**(바이너리에 없음) | ✅ 없음 | — | ↪ 받은 값, 없으면 목적지 유무로 추정 | |
| 목적지 | `getDestinationInfo()` → `onDestinationInfo(DestinationInfo(latitude, longitude, displayLatitude: Double? = null, displayLongitude: Double? = null, name, address, remainDistance: Int, remainTime: Int, tollFare: Int, poiId, poiSubId: String?, poiProvider = ""))` | ✅ | NAVI_ROUTE | 후보 계산, 도착 예정 | 목적지 없을 때 콜백 유무, remainTime 단위(초 추정) |
| 현재 위치 | `getCurrentLocationInfo()` → `onCurrentLocationInfo(CurrentLocationInfo(latitude, longitude, heading: Double = …, address, routeId, currentRouteIndex: Int?))` | ✅ | NAVI_ROUTE | 매칭, 지도, ↪ 주행거리 누적(대체) | 목적지 없이 달릴 때도 오는지, 주기 |
| 경유지 조회 | `getWaypointInfo()` → `onWayPointInfo(List<WaypointInfo(name, address, latitude, longitude, displayLatitude?, displayLongitude?, remainDistance, remainTime, poiId, poiSubId: String?, poiProvider = "")>)` | ✅ | NAVI_ROUTE | 경유지 반영 확인, 판매자에게 도착 예정 | 경유지가 없을 때 빈 목록이 오는지 |
| 경유지 추가 | `addWaypoint(RequestWaypointInfo(latitude, longitude, poiName: String?, waypointIndex: WaypointIndex, poiId, address, poiSubId, poiProvider = ""))`, `WaypointIndex` {FIRST, SECOND, ALL} | ✅ | NAVI_ROUTE_SEARCH | 수락 뒤 경유지 | ① 임의 poiId·좌표로 되는지 ② 자동 재탐색 ③ onWayPointInfo/onWaypointChanged가 오는지 |
| 경유지 삭제 | `removeWaypoint(waypointIndex: WaypointIndex)` | ✅ | NAVI_ROUTE_SEARCH | 거래 끝·취소 | |
| 경유지 변경 알림 | `onWaypointChanged(WaypointChangedInfo(index: WaypointIndex, cmdType: WaypointCmdType {ADD, REMOVE}, routeStartInfo: RouteStartInfo))` | ✅ | 리스너 | addWaypoint 대기 끝 | |
| 경유지 도착 | `onWayPointArrived(WaypointArrivedInfo(duration: Int, distance: Int, index: WaypointIndex, name, address))` — **좌표 없음** | ✅ | 리스너 | 이름·순번·거리를 보내고, 좌표는 콜백 순간의 현재 위치를 같이 보낸다(웹은 좌표로 거래 지점을 맞춘다) | 도착 판정 거리, 도착한 경유지가 목록에서 빠지는지 |
| 지점까지 시간·배터리 | `requestTrip(TripRequest(latitude, longitude, poiId, poiName, poiSubId: String?))` → `onTripInfo(TripInfo(distance: Int, eta: Int, estimatedSocAtDest: Int, energyConsumption: Double, summary: TripSummary(trafficConditions, routePoints)))` | ✅ | NAVI_ROUTE | 알림 전 도착 배터리 확인 | 안내를 바꾸지 않는지, eta 단위, 미등록 poiId |
| TBT | `getTBTInfo()` → `onTBTInfo(List<TBTInfo(type: TurnType, distance: Double, description)>)` | ✅ | NAVI_ROUTE | 알림 미루기(회전 300m 전) | 푸시 주기(셸은 1초 조회를 보조로 둔다) |
| 경로 옵션 | `changeRouteOption(routeOption: RouteOption)` {RECOMMENDED, SHORT_DISTANCE, SHORT_TIME, FREE, HIGHWAY, COMFORTABLE, SCHOOL_ZONE}, `onRouteOptionChanged(routeOption)` | ✅ | NAVI_ROUTE_SEARCH | 깨지기 쉬운 물건 → 편안한 길 | onRouteOptionChanged가 오는지 |
| 경로 취소 | `cancelRoute()`, `onRouteCancelled()` | ✅ | NAVI_ROUTE_SEARCH | 목적지 사라짐 처리 | |
| 오류 | `onError(errorCode: NaviErrorCode)` {CAUSE_LOW_BATTERY, CAUSE_SEARCH_ROUTE, CAUSE_SEARCH_ROUTE_OVER_DISTANCE, CAUSE_SEARCH_ROUTE_TOO_SHORT_DISTANCE, CAUSE_SEARCH_TRIP} | ✅ | 리스너 | 요청 중 경로 실패면 거래 취소 | |
| 목적지 설정 | `requestRoute(RouteInfo(latitude, longitude, displayLatitude: Double? = null, displayLongitude: Double? = null, poiName, poiId, address, poiSubId, routeOption: RouteOption = …, poiProvider = …, isMobileRequest: Boolean = …))`, `requestRouteWithWaypoints(RouteWithWaypointsRequest(destination: RouteInfo, waypoints: List<RequestWaypointInfo>))` → `onRoutingCompleted()`, `onRouteStarted(RouteStartInfo(duration, distance, tollFare, name, remainDestinationChargingValue))` | ✅ (10-22엔 📄였음) | NAVI_ROUTE_SEARCH | 11-04부터 셸이 부른다. 웹은 **경유지가 안 될 때만** — 브리핑 매물은 `requestRouteWithWaypoints` 한 번 → `addWaypoint`, 둘 다 안 되면 판매자 지점을 잠시 목적지로(`requestRoute`) 뒤 원래 목적지로 복귀. 정상 흐름의 목적지는 Pleos 내비에서 | 임의 좌표·빈 poiId를 받는지, 안내 중 다시 부르면 바꾸는지 |
| 목적지 도착 | `onDestinationArrived(DestinationArrivedInfo(duration: Int, distance: Int, name, address))` — **문서엔 없고 바이너리에만** | ✅ | 리스너 | 셸이 그대로 보낸다 + 대체(↪) ROUTE_DRIVE가 300m 안에서 끝나거나 남은 거리 30m 미만. 같은 목적지엔 한 번만 | 실제로 오는지, 대체와 시점 차이 |
| 그 밖의 콜백 | `onRouteEnded()`, `onDrivingInfo(DrivingInfo(destination: DrivingState, waypoints: List<DrivingState>))`, `onDestinationChanged()`, `onReRouteEnded()`, `onRouteStateInfo`, `onCurrentRoadSpeedLimit(Int)`, 북마크·최근 목적지·카메라·주의 지점·충전 사업자 | ✅ | — | 쓰지 않음(DrivingState에 남은 시간·거리가 있어 경유지 도착 예정 보조로 쓸 수 있다) | |
| 경로 선 | 없음 | ✅ 없음 | — | 서버 경로 계산기(시연: 도로망, 서비스: 외부 길찾기 API). 차 지도도 같은 계산기로 그린다 | |

패키지: 데이터 클래스는 전부 `ai.pleos.playground.navi.data`, enum은 `ai.pleos.playground.navi.constants`, 리스너는 `ai.pleos.playground.navi.helper.listener` — 바이너리로 확인(10-22의 "import만 고치면 된다" 메모는 해결).

## Vehicle SDK 2.3.2 (`ai.pleos.playground:Vehicle:2.3.2`)

| 기능 | 시그니처(바이너리) | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 초기화 | `Vehicle(context)`, `initialize()`, `release()`, `getSeat()/getDoor()/getOdometer()/getEvBattery()/getFuel()/getGear()/getBrake()/getSteeringWheel()/getTurnSignal()/getCarInfo()` 등 | ✅ | — | PleosBackend.vehicle | initialize가 동기인지 |
| **리스너 공통** | 모든 리스너가 `sealed interface VehicleListener { fun onFailed(e: Exception) }`를 상속 — **문서에 없던 추상 메서드**. 구현하지 않으면 실제 SDK 컴파일 오류(11-04 PC 빌드에서 발견, 5곳 추가) | ✅ | — | `emitFailed` → 웹 `Vehicle.onFailed {event, error}` | 어떤 상황에 오는지 |
| 2열·3열 착석 | `getSeat().registerSeatOccupancy(area: SeatArea(vararg SeatValue), listener: SeatOccupancyListener{onSeatOccupancyUpdated(occupancy: Boolean?)})`, `unregisterSeatOccupancy`, `getCurrentSeatOccupancy(area, onComplete: (Boolean?) -> Unit, onFailed)`. `SeatValue` {ROW_1_LEFT, ROW_1_CENTER, ROW_1_RIGHT, ROW_2_LEFT, ROW_2_CENTER, ROW_2_RIGHT, ROW_3_LEFT, **ROW_3_CENTER**, ROW_3_RIGHT} | ✅ | CAR_SEATS | 2열·3열을 접을 수 있는지(적재). 줄마다 따로 등록(row2: ROW_2_*, row3: ROW_3_LEFT·RIGHT). ROW_3_CENTER는 이름이 확인됐으니 3열 등록에 넣어도 된다(아직 안 넣음) | Virtual Console 좌석 조작 반영, 3열 차에서 ROW_3 값이 오는지 |
| 방향지시등 | `getTurnSignal().registerTurnSignalState(TurnSignalStateListener{onTurnSignalStateUpdated(state: TurnSignalValue?)})` {OFF, LEFT, RIGHT}, `getCurrentTurnSignalState(onComplete: (TurnSignalValue?) -> Unit, onFailed)` | ✅ | CAR_LIGHTS | 켠 동안 알림 미루기 | |
| 조향각 | `getSteeringWheel().registerSteeringWheelAngle(SteeringWheelAngleListener{onSteeringWheelAngleUpdated(angle: Float?)})`, `checkSteeringWheelAngleCapabilities(onComplete: (CapabilityConfig, AreaBounds<Float>) -> Unit, onFailed)`, `getCurrentSteeringWheelAngle` | ✅ | CAR_DRIVE | 3.5° 넘게 꺾는 동안 알림 미루기 | 갱신 주기 |
| 브레이크 | `getBrake().registerBrakePedalStatus(BrakePedalStatusListener{onBrakePedalStatusUpdated(status: Boolean?)})`, `getCurrentBrakePedalStatus`, `checkBrakePedalStatusCapabilities` | ✅ | CAR_DRIVE | 밟는 동안 알림 미루기 | |
| 배터리 | `getEvBattery().getEvBatteryStateOfCharge(onComplete: (Int?) -> Unit, onFailed: (Exception) -> Unit)`, `registerEvBatteryStateOfCharge(EvBatteryStateOfChargeListener)`, `checkEvBatteryStateOfChargeCapabilities(onComplete: (CapabilityConfig) -> Unit, onFailed)`; 그 밖에 `getEvBatteryLevel/Capacity`, 효율, 충전 포트·스위치 | ✅ | CAR_ENERGY | 도착 배터리 15% 확인 | Energy 조작 반영 |
| 지원 확인 | `CapabilityConfig(accessType: AccessType = …)`, `AccessType` {NONE, READ, WRITE, READ_WRITE}, `AreaBounds<T>(minValue, maxValue)` | ✅ | — | Vehicle.capabilities | |
| 주행거리 | `getOdometer().getCurrentDistanceDriven(onComplete: (Float?) -> Unit, onFailed)`, `registerDistanceDriven(DistanceDrivenListener{onDistanceDrivenUpdated(Float?)})`, trip 누적·현재·주유 뒤 거리/시간도 있음 | ✅ (10-22엔 📄) | — (권한 미확인) | `Vehicle.getOdometerKm` — 한 주행 안에서 출처 고정, 안 되면 ↪ NaviHelper 위치 누적 | **단위**(km로 가정), 권한 |
| 주행 가능 거리 | `getOdometer().getRangeRemainingDistance(onComplete: (Float?) -> Unit, onFailed)`, `registerRangeRemainingListener` — 내연기관·전기차 공통. **@Deprecated**(실제 빌드 경고: "use the Google RANGE_REMAINING property" = AAOS `VehiclePropertyIds.RANGE_REMAINING`) | ✅ (10-22엔 Fuel로 📄) | — | `Vehicle.getFuelRangeKm`(5초 캐시). 값이 안 오면 `CarPropertyManager`의 RANGE_REMAINING(CAR_ENERGY)으로 바꾼다 | 단위, 전기차에서도 값이 오는지, deprecated라 값이 null인지 |
| 연료 | `getFuel().getFuelPercent(onComplete: (Int?) -> Unit, onFailed)`, `registerFuelPercent(FuelPercentListener)`, 연비 | ✅ | — | 쓰지 않음(주행 가능 거리로 충분) | |
| 트렁크 | `getDoor().registerDoorPosition(area: DoorArea(vararg DoorValue), listener: DoorPositionListener{onPositionUpdated(position: Int?)})`, `unregisterDoorPosition`, `getCurrentDoorPosition(area, onComplete: (Int?) -> Unit, onFailed)`, `checkDoorPositionCapabilities(onComplete: (Map<DoorArea, AreaBounds<Int>>) -> Unit, onFailed)`. `DoorValue` {ROW_1_LEFT, ROW_1_RIGHT, ROW_2_LEFT, ROW_2_RIGHT, ROW_3_LEFT, ROW_3_RIGHT, HOOD, **REAR**} | ✅ (10-22엔 ❌) | — (CAR_DOORS 추정, 미확인) | `Vehicle.registerTrunkOpen` → `Vehicle.onTrunkOpen {open: position != 0, position}` → "실으셨나요?" | **position 값의 뜻**(0=닫힘? 범위는 checkDoorPositionCapabilities), 트렁크가 REAR인지, 권한 |
| 기어 | `getGear().registerGearSelection(GearSelectionListener{onSelected(gear: VehicleGear?)})`, `getCurrentGearSelectionState`. `VehicleGear` {GEAR_UNKNOWN, GEAR_NEUTRAL, GEAR_REVERSE, GEAR_PARK, GEAR_DRIVE, GEAR_1…GEAR_9} | ✅ | — | 쓰지 않음 — 주행 중 여부는 AAOS CarUxRestrictions. 그게 안 되면 GEAR_PARK로 대체할 수 있다 | |
| 차종 | `getCarInfo().getVINInfo/getCRNInfo(onComplete: (String?) -> Unit, onFailed)`, `getCapabilityInfo(onComplete: (Map<String, CapabilityConfig<Any>>?) -> Unit, onFailed)` — **모델명 없음** | ✅ 없음 | CAR_INFO | null → 처음 한 번 사용자가 차종 선택 | |
| 속도 | 없음(Vehicle에 속도 API 없음) | ✅ 없음 | — | ↪ 위치 변화로 잰 속도(주행 중 여부 대체) | |

## TextToSpeech SDK 3.3.1 (`ai.pleos.playground:TextToSpeech:3.3.1`)

| 기능 | 시그니처(바이너리) | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 말하기 | `TextToSpeech(context, mode: Mode = …)`, `Mode` {SERVER, ON_DEVICE, HYBRID}, `initialize(listener: OnInitializeListener{onSuccess(), onFailure(errorType: ErrorType)})`, `addEventListener(EventListener{onReady, onStart, onUpdatedRms(rms: Double), onDone, onStop, onError(errorType)})`, `setLocale(locale)`, **`speak(text: String, isFinal: Boolean = …)`**, `stop()`, `release()`; `setAudioZoneId`, `setAudioAttributes`, `setSpeakerType(type: String)` | ✅ | TTS_SERVICE | 알림 문장(`speak(text)` = isFinal 기본값) | ON_DEVICE 한국어, 내비 안내 음성과 겹칠 때, isFinal의 뜻 |
| 오류 | `ErrorType` {AUDIO_ERROR, MIC_ERROR, SERVER_INTERNAL_ERROR, NETWORK_ERROR, INVALID_REQUEST_ERROR, TIMEOUT, UNAUTHENTICATED, PERMISSION_DENIED, ON_DEVICE_ENGINE_ERROR, UNKNOWN, UNAVAILABLE_LANGUAGE, NOT_SUPPORTED_API} | ✅ | — | 실패하면 안드로이드 TextToSpeech(↪) | |

## SpeechToText SDK 3.3.1 (`ai.pleos.playground:SpeechToText:3.3.1`)

2026-10-22에는 "사용 신청 준비 중"이어서 안드로이드 `SpeechRecognizer`로 두었다. 2026-11-04 문서(`…/connect-sdk-pleos/SpeechToText/intro`부터 `error-code`까지)에 v3.3.1 가이드가 있어 채택했고, 같은 날 바이너리로 시그니처를 확인했다. 패키지 `ai.pleos.playground.stt`(상수 `stt.constant`, 리스너 `stt.listener`).

| 기능 | 시그니처(바이너리) | 판정 | 권한 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|---|
| 만들기·초기화 | `SpeechToText(context, mode: Mode = …)`, `initialize(listener: OnInitializeListener)`, `initialize()`; onSuccess 뒤에만 다른 API. `release()` 뒤 다시 쓰려면 새 인스턴스 | ✅ | STT_SERVICE (`pleos.car.permission.STT_SERVICE`) | `NativeVoice.initPleosStt` | 콜백 스레드(문서에 없음), 에뮬레이터에 STT 서비스가 있는지 |
| 모드 | `Mode` {HYBRID, SERVER, ON_DEVICE} — 문서: HYBRID·SERVER는 Pleos Playground 앱 등록(`registerApp`) 필요, **ON_DEVICE는 등록 없이** | ✅ | — | ON_DEVICE | 에뮬레이터 ON_DEVICE 한국어 인식 품질 |
| 언어 | `setLocale(locale: Locale)` — 문서: ko-KR·en-US·fr-CA·es-US·es-MX, 인식 시작 전에 | ✅ | — | `setLocale(Locale.KOREA)` | |
| 듣기 | `addListener(ResultListener)`, `request()`(인자 없음 — 바이너리로 확정), `stop()`, `removeListener(ResultListener)` | ✅ | STT_SERVICE | `NativeVoice.listenPleos` — `Voice.listen {words, timeoutMs}` | 무음 때 스스로 끝나는지·시간 |
| 결과 | `ResultListener { onReady(), onStartedRecognition(), onUpdated(stt: String, completed: Boolean), onUpdatedEpdData(on: Long, off: Long), onUpdatedRms(rms: Double), onEndedRecognition(), onError(errorType: ErrorType) }` | ✅ | — | 최종 결과 → `match(단어)`; 시간 안에 최종이 없으면 `stop()` 뒤 부분 결과 | 부분 결과(`completed=false`)가 실제로 오는지 |
| 오류 | `ErrorType` {AUDIO_ERROR, MIC_ERROR, SERVER_INTERNAL_ERROR, NETWORK_ERROR, INVALID_REQUEST_ERROR, TIMEOUT, UNAUTHENTICATED, PERMISSION_DENIED, ON_DEVICE_ENGINE_ERROR, UNKNOWN, UNAVAILABLE_LANGUAGE, NOT_SUPPORTED_API} | ✅ | — | NOT_SUPPORTED_API·PERMISSION_DENIED·UNAVAILABLE_LANGUAGE → 그 뒤로 안드로이드 `SpeechRecognizer`(↪) | |
| 오디오 직접 보내기 | `sendAudio(bytes: ByteArray)`, `completeAudioSend()`, `registerApp(…)` 3가지, `getCallApi()`, `getAmbientAi()` | ✅ | — | 쓰지 않음 | |

안 되면(초기화 실패·위 오류) 안드로이드 `SpeechRecognizer`(RECORD_AUDIO, ko-KR 자유 형식). 둘 다 안 되면 웹 음성(시뮬레이터)으로 내려간다. RECORD_AUDIO가 Pleos STT에도 필요한지는 문서에 없다(main 매니페스트에 그대로 둠).

## Gleo AI 앱 연동 (App Integration Guide, `document.pleos.ai/en/docs/pleos-only/app-integration-guide/guide/core-concepts` ~ `use-cases/radio-app`)

SDK가 아니라 스키마 + Intent 규약이다(2026-11-03·04 문서를 이 작업 환경에서 직접 읽음). "LLM이 앱이 정의한 함수 호출을 생성"하는 OpenAI식 function calling. 앱이 Gleo·LLM·STT를 부르는 API는 없다(Gleo가 앱을 부른다). 스키마는 Gleo 측 검토 뒤 자동 활성화되고, Gleo AI 앱이 **부팅 때 한 번** 모든 앱의 `assets/schema.json`을 읽어 DB에 넣는다(설치·삭제 때도 갱신). 바이너리로 확인할 대상이 없다(라이브러리가 아님).

| 기능 | 규약 | 판정 | 쓰는 곳 | 🧪 |
|---|---|---|---|---|
| 음성 기능 선언 | `assets/schema.json` — `packageName`, `appDescription`, `version`(앱 마켓 버전과 같게), `actionCalls`(**최대 3개**: `type:"function"`, `function{component:"activity"|"service", name 대문자_스네이크(동사+대상 2~3단어, 다른 함수와 겹치지 않게), description, parameters(JSON Schema object, type은 string·number·boolean·array 하나만, enum은 문자열만, null 없음, required는 꼭 필요한 것만 순서대로)}`) | ✅📄 | `apps/car-android/app/src/main/assets/schema.json` — ADD_INTEREST(keyword, goLevel enum), ANSWER_ALERT(answer enum yes·no, item), ASK_ABOUT_LISTINGS(question → 앱 조수, silent) | 부팅 때 Gleo가 assets를 읽는지, 에뮬레이터에 Gleo가 있는지 |
| 설명 쓰는 규칙 | 앱·함수·매개변수 설명은 **영어**, 한 문장(최대 두 문장), **구체적 예시를 넣지 않는다**(맥락으로 고르는 걸 방해), Gleo 행동을 조종하거나 다른 앱 사용을 막는 문장 금지. 함수 하나가 사용자 명령 하나를 끝까지 처리 | ✅📄 | 2026-11-04 스키마를 이 규칙대로 고침(예시 목록 삭제) | Gleo가 "주행중GO에 ○○ 물어봐"를 ASK_ABOUT_LISTINGS로 고르는지 |
| 앱 부르는 말 | 공식 예시 스키마에 `"invokeWord": "리마인더"`가 있으나 필드 설명 표에는 없다 | 📄 | `"invokeWord": "주행중고"` | 이 말로 앱을 지정해 부르는지, 없이도 되는지 |
| 호출 받기 | Gleo → `startActivity`(action = function 이름, `setPackage`, extra `ACTION_PARAM` = 인자 JSON 문자열) / service면 `sendBroadcast`. 매니페스트 `<intent-filter><action name=function/><category DEFAULT/></intent-filter>` | ✅📄 | `MainActivity`(singleTask, `onNewIntent`) → `GleoBridge.handle` → 웹 `window.__jhgoGleo` | 실제 action·extra 이름이 문서와 같은지 |
| 결과 돌려주기 | `sendBroadcast(Intent("ai.pleos.playground.intent.action.APP_ACTION_RESPONSE").putExtra("packageName", …).putExtra("response", JSON))` — `functionName`(부른 함수와 같게), `status`(success·asking·fail), `message`(영어 완결 문장 — 검색어·장소·물건 이름은 다른 언어 가능), `data`(JSON 배열 문자열, Gleo가 알아야 할 것만), `mode`(voice 기본: Gleo가 말함 · beep · silent: 앱이 스스로 말할 때). **7초** 안에 안 답하면 Gleo가 취소. silent면 Gleo는 콜백만 보고 최종 응답을 만든다 | ✅📄 | `GleoBridge.send`(웹이 안 답하면 5초 뒤 fail). ASK_ABOUT_LISTINGS는 `c.ask(question, {quick: true})` → 서버가 AI를 3초만 기다리고 규칙 조수로 | Gleo가 message로 뭐라고(어느 언어로) 말하는지 |
| asking 다음 턴 | `asking`은 "필수 매개변수가 없거나 확인 같은 추가 상호작용이 필요할 때". **그 뒤 Gleo가 사용자에게 되묻고 같은 함수를 다시 부르는지는 문서에 없다** | ❌ | 빠진 매개변수·경합 때만 asking. 확인 대화는 asking에 기대지 않고 앱 안(알림 카드·'말하기')에서 끝낸다 | asking 뒤 두 번째 호출이 오는지, 인자가 채워져 오는지 |

## 안드로이드 플랫폼

| 기능 | API | 쓰는 곳 | 🧪 |
|---|---|---|---|
| 주행 중 여부 | `android.car.Car.createCar`, `CarUxRestrictionsManager.getCurrentCarUxRestrictions().isRequiresDistractionOptimization` (`useLibrary("android.car")`) | 주행 중엔 알림 카드만, 정차하면 시트 | Pleos 에뮬레이터에서 값이 기어 P/D에 따라 바뀌는지 |
| 주행 중 화면 | 액티비티 `<meta-data android:name="distractionOptimized" android:value="true"/>` | 주행 중에도 앱 화면 유지 | 서드파티 앱에 허용되는지 |
| 화면 | WebView + `androidx.webkit.WebViewAssetLoader` | 서버의 `/car/` 또는 앱에 넣은 화면(`?local`) | 차량 이미지에 WebView가 있는지 |

## PC 빌드에서 알게 된 것 (2026-11-04)

- Android Studio(Panda) + JBR 21, Gradle 8.11.1, AGP 8.7.3, Kotlin 2.0.21로 `demoDebug`·`pleosDebug`·`pleosRelease` 모두 성공. 실행은 `apps/car-android/build.bat`(둘 다) · `install.bat`(에뮬레이터에 설치) · `release.bat`(`apk/`에 복사).
- 이 PC(i9-14900KF)에서는 Gradle 데몬 JVM이 JIT·R8 중에 크래시했다(hs_err: `ciMethodData ShouldNotReachHere`, `EXCEPTION_ACCESS_VIOLATION`). `gradle.properties`에서 C1만 쓰고(`-XX:TieredStopAtLevel=1`) 병렬을 줄여(`org.gradle.workers.max=4`, `ActiveProcessorCount=4`) 넘겼다. 다른 PC에서는 지워도 된다.
- `lintVitalRelease`가 `lint-gradle`을 받으려다 `dl.google.com`에 못 가 실패 → `lint { checkReleaseBuilds = false }`. release는 debug 키로 서명(심사용).
- 문서와 실제 SDK의 차이는 Vehicle 리스너의 `onFailed` 하나였다. 나머지 import·시그니처는 그대로 컴파일됐다.
- 11-04 15시 두 번째 빌드(트렁크·주행거리·RouteInfo 연결 뒤): demo 11초·pleos 13초·release 16초 모두 성공. 경고 하나 — `Odometer.getRangeRemainingDistance`가 deprecated(위 표).

## 에뮬레이터에서 확인할 순서

1. Android Studio → SDK Manager → SDK Update Sites에 `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml` 추가 → SDK Platforms에서 Pleos Connect 이미지(2.1.0, API 34) 설치 → Device Manager에서 Automotive 기기로 AVD(Cold boot, RAM 4 GB).
2. 에뮬레이터를 켠 뒤 `apps/car-android/install.bat`(pleosDebug 설치, `adb reverse tcp:8787`, 앱 실행). PC에서 `npm start`가 떠 있어야 한다.
3. 앱 오른쪽 아래 'SDK 기록'으로 호출·이벤트 확인. PC 크롬 `chrome://inspect`로 WebView 콘솔도 볼 수 있다. `Vehicle.onFailed`가 찍히는 리스너는 권한·지원 여부를 본다.
4. Virtual Console: 좌석(2열·3열)·방향지시등·조향·브레이크·배터리·**트렁크(REAR 문 위치)**를 바꿔 이벤트가 오는지. 트렁크는 열림·닫힘 때 `position` 값을 적어 `open` 판정(`!= 0`)을 고친다.
5. `Vehicle.odometerSource`가 `pleos`인지, `Vehicle.getOdometerKm`·`getFuelRangeKm` 값의 단위가 km인지(계기판과 비교).
6. Pleos 내비에서 수원 → 송파 목적지 설정 → 브리핑이 열리는지 → 시뮬레이션 주행으로 알림·`addWaypoint`·`onWayPointArrived`(이름·순번이 오는지)·`onDestinationArrived`(대체보다 먼저 오는지)까지.
7. 경유지 추가가 안 되는 상황을 만들어(경유지 2개 꽉 채움) `requestRoute` 대체 경로가 내비에 받아들여지는지, 거래 뒤 원래 목적지로 돌아오는지.
8. Gleo: 에뮬레이터에 Gleo AI가 있으면 "주행중고에 유모차 관심 추가해 줘"가 ADD_INTEREST로, "주행중고에 카시트 흠집 있는지 물어봐"가 ASK_ABOUT_LISTINGS(question)로 들어오는지, 응답 브로드캐스트를 Gleo가 어떻게 말하는지(silent 때 조용한지). 없으면 `adb shell am start -a ADD_INTEREST --es ACTION_PARAM '{"keyword":"유모차"}' ai.jhgo.car`로 Intent 경로만 확인.
9. STT: 차 화면 '말하기'를 누르고 "카시트 흠집 있어?" → 'SDK 기록'에 `Voice.listen` 결과가 오는지, `Voice.capabilities.sttEngine`이 `pleos`인지(안드로이드로 내려갔으면 `android`와 그 이유 로그 `Pleos STT …`).
10. 위 🧪 열의 결과를 이 표에 적고, 대체(↪)로 둔 것 중 확인된 API가 생기면 교체한다.
