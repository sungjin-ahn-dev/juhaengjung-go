# 차량 앱 브리지 (WebView ↔ Pleos SDK)

차량 화면은 웹(`apps/car-web`)이다. Android 셸(`apps/car-android`)이 WebView로 이 화면을 띄우고 `window.PleosBridge`를 붙이면, 웹은 시뮬레이터 대신 이 브리지로 실제 SDK를 부른다.

- 웹 쪽: `apps/car-web/src/pleos/bridge.ts` (포트 `ports.ts`와 같은 이름)
- Kotlin 쪽: `apps/car-android/app/src/main/java/ai/jhgo/car/PleosBridge.kt`(통로), `src/pleos/.../PleosBackend.kt`(SDK 호출), `NativeVoice.kt`(음성)
- 계약 시험: `npm run e2e:bridge` — 이 문서와 같은 동작을 하는 가짜 브리지로 웹이 끝까지 도는지 본다(`tools/bridge-contract.ts`)

## 통로

```
JS → Kotlin   window.PleosBridge.call(id, method, argsJson)
Kotlin → JS   window.__pleos.resolve(id, json)      결과(JSON 글)
              window.__pleos.reject(id, message)    실패
              window.__pleos.emit(event, json)      리스너 콜백
```

- `@JavascriptInterface`는 WebView의 JavaBridge 스레드에서 불린다. 셸은 메인 스레드 코루틴으로 넘겨 SDK를 부르고 `evaluateJavascript`로 답한다.
- 웹은 호출마다 시간 제한을 둔다(기본 8초, 말하기는 문장 길이만큼, 듣기는 제한 + 4초).
- NaviHelper 조회는 결과가 리스너 콜백으로 온다. 셸이 콜백을 기다렸다가 같은 호출의 결과로 돌려주고, 같은 콜백을 이벤트로도 내보낸다.

## 메서드

| 메서드 | 인자 | 결과 | SDK |
|---|---|---|---|
| `NaviHelper.getNavigationStatus` | — | `"INACTIVE" \| "INITIALIZING" \| "FREE_DRIVE" \| "ROUTE_DRIVE"` | `onNavigationStatus`로 받은 값. 아직 없으면 목적지 유무로 추정(대체) |
| `NaviHelper.getDestinationInfo` | — | `{latitude, longitude, name, address, remainDistance(m), remainTime(s)}` 또는 `null` | `getDestinationInfo()` → `onDestinationInfo`. 2.5초 안에 안 오면 목적지 없음 |
| `NaviHelper.getCurrentLocationInfo` | — | `{latitude, longitude, heading, address}` | `getCurrentLocationInfo()` → `onCurrentLocationInfo` |
| `NaviHelper.getWaypointInfo` | — | `[{name, address, latitude, longitude, remainDistance, remainTime, poiId}]` | `getWaypointInfo()` → `onWayPointInfo`. 안 오면 빈 목록 |
| `NaviHelper.getTBTInfo` | — | `[{type, distance, description}]` | `getTBTInfo()` → `onTBTInfo` |
| `NaviHelper.requestTrip` | `{latitude, longitude, poiId, poiName}` | `{distance, eta, estimatedSocAtDest, energyConsumption, summary}` | `requestTrip(TripRequest)` → `onTripInfo`. 한 번에 하나씩 |
| `NaviHelper.addWaypoint` | RequestWaypointInfo 모양 `{latitude, longitude, poiName, waypointIndex, poiId, address, poiSubId, poiProvider}` | `null` | `addWaypoint(RequestWaypointInfo)`. `onWayPointInfo`/`onWaypointChanged`를 최대 2.5초 기다림, `onError`면 실패 |
| `NaviHelper.removeWaypoint` | `{idx: "FIRST" \| "SECOND" \| "ALL"}` | `null` | `removeWaypoint(WaypointIndex)` |
| `NaviHelper.changeRouteOption` | `{option}` | `null` | `changeRouteOption(RouteOption)` |
| `NaviHelper.cancelRoute` | — | `null` | `cancelRoute()` |
| `NaviHelper.requestRoute` | `{latitude, longitude, name}` | `null` | `requestRoute(RouteInfo(latitude, longitude, poiName = name, poiId = "", address = "", poiSubId = "0"))`(실제 SDK 메타데이터로 확인). `onRoutingCompleted`/`onRouteStarted`/`onWayPointInfo`를 2.5초 기다리고, `onError`면 실패. 웹은 경유지가 안 될 때의 대체 경로와 그 복귀에서만 쓴다 — 목적지는 Pleos 내비에서 정한다. 임의 좌표를 내비가 받는지 🧪 |
| `NaviHelper.requestRouteWithWaypoints` | `{dest: {latitude, longitude, name}, waypoints: [RequestWaypointInfo 모양]}` | `null` | `requestRouteWithWaypoints(RouteWithWaypointsRequest(destination, waypoints))`. 출발 전 브리핑에서 고른 매물에 한 번 시도, 안 되면 `addWaypoint` |
| `Vehicle.getCarInfo` | — | `{manufacturer: null, model: null, modelYear: null}` | CarInfo는 VIN·CRN만 확인 → 앱이 차종을 한 번 고르게 한다 |
| `Vehicle.capabilities` | — | `{steeringWheelAngle, evBatteryStateOfCharge}` = AccessType 이름 | `checkSteeringWheelAngleCapabilities`, `checkEvBatteryStateOfChargeCapabilities` |
| `Vehicle.registerSeatOccupancy` | `{area: ["ROW_2_LEFT","ROW_2_CENTER","ROW_2_RIGHT"], tag: "row2"}` 또는 `{area: ["ROW_3_LEFT","ROW_3_RIGHT"], tag: "row3"}` | `{tag, registered: [실제로 등록한 이름]}` | 줄(tag)마다 한 번. 좌석마다 `registerSeatOccupancy(SeatArea(sv), listener)`. `SeatValue.valueOf`가 모르는 이름은 건너뛴다 |
| `Vehicle.getEvBatteryStateOfCharge` | — | `%` 또는 `null` | `getEvBatteryStateOfCharge(onComplete, onFailed)` |
| `Vehicle.registerEvBatteryStateOfCharge` | — | `null` | `registerEvBatteryStateOfCharge(listener)` |
| `Vehicle.registerTurnSignalState` | — | `null` | `registerTurnSignalState(listener)` |
| `Vehicle.registerSteeringWheelAngle` | — | `null` | `registerSteeringWheelAngle(listener)` — 0.15초에 한 번 또는 2° 넘게 바뀔 때만 웹으로 |
| `Vehicle.registerBrakePedalStatus` | — | `null` | `registerBrakePedalStatus(listener)` |
| `Vehicle.getOdometerKm` | — | km 또는 `null` | `Odometer.getCurrentDistanceDriven(onComplete, onFailed)`(실제 SDK 바이너리 확인, 단위 🧪). 웹은 출발·도착 값의 차이만 쓰므로 한 주행 안에서 출처를 바꾸지 않는다: 차가 한 번 답하면 계속 차 값(안 오면 `null`), 처음부터 안 되면 대체(↪) NaviHelper 위치를 1초마다 누적한 거리(순간 이동·제자리 흔들림 제외). 출처는 `Vehicle.odometerSource` 이벤트로 알린다 |
| `Vehicle.getFuelRangeKm` | — | km 또는 `null` | `Odometer.getRangeRemainingDistance(onComplete, onFailed)`(바이너리 확인, 단위 🧪) — 내연기관·전기차 공통 주행 가능 거리. 5초 캐시 |
| `Vehicle.registerTrunkOpen` | — | `null` | `Door.registerDoorPosition(DoorArea(DoorValue.REAR), DoorPositionListener)`(바이너리 확인). 한 번만 등록. 열림 판정(`position != 0`)은 에뮬레이터에서 확인 🧪 |
| `CarUx.current` | — | `true`(주행 중) / `false` | AAOS `CarUxRestrictionsManager.isRequiresDistractionOptimization`. 못 쓰면 대체: 위치 변화 속도 > 5km/h |
| `Voice.capabilities` | — | `{tts, stt, ttsEngine: "pleos" \| "android" \| "none", sttEngine: "pleos" \| "android" \| "none"}` | |
| `Voice.speak` | `{text}` | `null`(말이 끝나면) | Pleos TextToSpeech(ON_DEVICE) → 안 되면 안드로이드 TextToSpeech |
| `Voice.stop` | — | `null` | |
| `Voice.listen` | `{words, timeoutMs}` | 들은 단어 또는 `null` | Pleos SpeechToText(ON_DEVICE, ko-KR) `request()` → `onUpdated(stt, completed=true)`; 시간이 지나면 `stop()` 뒤 부분 결과. 초기화 실패나 NOT_SUPPORTED_API·PERMISSION_DENIED·UNAVAILABLE_LANGUAGE면 안드로이드 SpeechRecognizer(↪). 정해진 단어만(띄어쓰기 무시), `words: []`면 들은 문장 그대로 |

## 이벤트

| 이벤트 | 값 | 출처 |
|---|---|---|
| `NaviHelper.onNavigationStatus` | 상태 이름 | 리스너 |
| `NaviHelper.onDestinationInfo` | 목적지 또는 `null`(`onRouteCancelled`) | 리스너 |
| `NaviHelper.onWayPointInfo` | 경유지 목록 | 리스너 |
| `NaviHelper.onWayPointArrived` | `{name, address, index: "FIRST" \| "SECOND", distance, duration, latitude, longitude, poiId: ""}` — `WaypointArrivedInfo(distance, duration, index, name, address)`(바이너리 확인)에 좌표가 없어 **콜백을 받은 순간의 현재 위치**를 같이 보낸다. 웹은 좌표로 거래 지점을 맞춘다 | 리스너 |
| `NaviHelper.onDestinationArrived` | `{name, address, distance, duration}` 또는 `null`(대체) | 리스너 `onDestinationArrived(DestinationArrivedInfo)`(문서엔 없고 바이너리에만 있음) 또는 대체: 안내 중이던 목적지가 300m 안에서 안내가 끝나거나 남은 거리 30m 미만. 같은 목적지엔 한 번만 |
| `NaviHelper.onTBTInfo` | TBT 목록 | 리스너 + 1초 조회 |
| `NaviHelper.onTripInfo` | Trip 결과 | 리스너 |
| `NaviHelper.onRouteOptionChanged` | 옵션 이름 | 리스너 |
| `NaviHelper.onError` | NaviErrorCode 이름 | 리스너 |
| `NaviHelper.onRouteStarted` | `{name, distance, duration}` | 리스너 `onRouteStarted(RouteStartInfo)` — 기록용 |
| `Vehicle.onSeatOccupancyUpdated` | `{tag: "row2" \| "row3", occupied}` — 그 줄에 한 곳이라도 앉았으면 `true`. (예전 셸의 태그 없는 `true/false`는 웹이 2열로 본다) | 리스너 |
| `Vehicle.onEvBatteryStateOfChargeUpdated` | % | 리스너 |
| `Vehicle.onTurnSignalStateUpdated` | `"OFF" \| "LEFT" \| "RIGHT"` | 리스너 |
| `Vehicle.onSteeringWheelAngleUpdated` | ° (좌측 음수) | 리스너 |
| `Vehicle.onBrakePedalStatusUpdated` | `true/false` | 리스너 |
| `Vehicle.onTrunkOpen` | `{open, position}` | `DoorPositionListener.onPositionUpdated(Int?)` — 웹은 `open`이 `true → false`로 바뀌면 "실으셨나요?" |
| `Vehicle.onFailed` | `{event, error}` | 모든 Vehicle 리스너의 `onFailed(Exception)`(바이너리 확인: 리스너는 모두 `VehicleListener`를 상속). 기록 서랍용 |
| `Vehicle.odometerSource` | `"pleos" \| "location"` | 주행거리 출처가 정해질 때 한 번 |
| `restriction` | 주행 중이면 `true` | 0.5초마다 확인해 바뀔 때만 |

## 웹이 실제 SDK 모드에서 다르게 하는 것

- 목적지 시트는 프리셋 대신 "목적지는 내비에서"를 보여 준다. 정차 중에 내비 목적지가 새로 잡히면(100m 넘게 바뀌면) 출발 전 브리핑을 연다.
- 출발 전 브리핑에서 고른 매물도 `requestRouteWithWaypoints`가 안 되면 `addWaypoint`로 넣는다. 반영 확인은 `getWaypointInfo`를 두 번까지(1.5초 간격) 다시 조회한다.
- 지도: 차 위치는 NaviHelper 현재 위치다. 경로 선은 NaviHelper가 주지 않아서 서버와 같은 경로 계산기로 그린 근사이고, 목적지·경유지가 바뀌거나 300m 넘게 벗어나면 다시 그린다.
- 오른쪽 아래 'SDK 기록' 서랍에 호출·이벤트가 남는다(자주 오는 이벤트는 내용이 바뀔 때만).

## Gleo AI 음성 기능 (PleosBridge와 별개 통로)

- 셸 → 웹: `GleoBridge.kt`가 Gleo의 Intent(action = function 이름, extra `ACTION_PARAM`)를 받아 `window.__jhgoGleo(JSON{requestId, name, params})`를 부른다. 웹이 아직 안 떴으면 0.5초마다 다시(5초까지).
- 웹 → 셸: `apps/car-web/src/gleo.ts`가 기능을 수행하고 `window.GleoBridge.respond(JSON{requestId, functionName, status, message, data?, mode?})`로 돌려준다. 셸은 이를 `APP_ACTION_RESPONSE` 브로드캐스트로 Gleo에 보낸다.
- 기능 세 개(`assets/schema.json` = 매니페스트 intent-filter = `GleoBridge.FUNCTIONS` = 웹 `GLEO_FUNCTIONS`, 브리지 계약 시험이 네 곳이 같은지 본다): `ADD_INTEREST`(관심 키워드 추가), `ANSWER_ALERT`(떠 있는 알림에 yes/no 또는 품목 이름 — 알림이 없으면 fail), `ASK_ABOUT_LISTINGS`(question: 운전자의 말 그대로 → 앱 조수가 한국어로 답하고 읽어 주므로 Gleo엔 silent + data에 답).
- 시뮬레이터에서는 가상 콘솔 'Gleo AI 음성 기능'이 같은 함수를 부르고 응답을 보여 준다.
- `Voice.listen`에 `words: []`를 주면 자유 듣기(들은 문장 그대로, 대화로 고르기). 셸이 음성을 못 쓰면 웹 음성으로 내려간다.
