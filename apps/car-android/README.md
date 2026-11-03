# 차량 앱 셸 (Android, Pleos Connect)

차량 화면은 웹(`apps/car-web`)이다. 이 앱은 WebView로 그 화면을 띄우고 `window.PleosBridge`를 붙여서, 웹이 실제 Pleos SDK(NaviHelper 3.0.5·Vehicle 2.3.2·TextToSpeech 3.3.1)를 부르게 한다. 프로토콜은 `docs/BRIDGE.md`, SDK별 확인 현황은 `docs/API_MATRIX.md`.

| 플레이버 | 하는 일 |
|---|---|
| `demo` | 브리지 없이 WebView만. 웹이 자체 시뮬레이터·가상 콘솔로 돈다. SDK 없이 빌드되므로 셸·서버 연결을 먼저 확인할 때 쓴다 |
| `pleos` | 실제 SDK. 시뮬레이터 대신 NaviHelper·Vehicle 신호로 돈다. 오른쪽 아래 'SDK 기록'에 호출·이벤트가 남는다 |

## 빌드

방법 1 — Android Studio: 이 폴더(`apps/car-android`)를 열고 빌드 변형에서 `demoDebug` 또는 `pleosDebug`를 고른다. Pleos Maven(`nexus-playground.pleos.ai`)은 계정 없이 받을 수 있다.

방법 2 — 명령: `apps\car-android\build.bat`. 웹 화면을 먼저 빌드해 앱 안에 넣고(서버 없이 체험용), `demo`·`pleos`를 차례로 빌드한다. 결과는 `build_log.txt`의 `EXIT_DEMO`·`EXIT_PLEOS`(0이면 성공).

빌드 오류가 나면 그 줄이 문서와 실제 SDK의 차이다. 먼저 볼 곳은 `PleosBackend.kt`의 `TripRequest`·`TripInfo`·`WaypointArrivedInfo` import(패키지를 다른 data 클래스와 같다고 적었다)와 `TripRequest(..., poiSubId = null)`.

## 에뮬레이터에서 실행

1. PC에서 저장소 루트 `npm start` (서버 8787).
2. Pleos Connect 에뮬레이터(API 34 Automotive)를 켠 뒤 `build.bat install` — pleos APK 설치, `adb reverse tcp:8787 tcp:8787`, 앱 실행.
3. 앱은 `http://10.0.2.2:8787/car/`를 연다. 못 붙으면 연결 설정 화면이 뜬다: 주소를 고치거나(실기기는 PC의 LAN 주소) '서버 없이 체험'(앱 안 화면 + 페이지 안 서버)을 누른다.
4. 시연 매물은 수원~송파 도로망 위에 있다. 에뮬레이터 위치를 수원시청 근처로 두고 Pleos 내비에서 목적지를 송파로 정하면 출발 전 브리핑이 열린다. 판매자는 PC나 폰 브라우저의 `/seller/`.
5. 웹 화면 디버깅: PC 크롬 `chrome://inspect` → WebView.

## 확인할 것 (에뮬레이터)

`docs/API_MATRIX.md`의 🧪 열과 마지막 절. 결과는 그 표에 적고, 대체(↪)로 둔 기능 중 확인된 API가 생기면 `PleosBackend.kt`에서 교체한다.

## 파일

```
app/src/main/java/ai/jhgo/car/MainActivity.kt    WebView, 권한, 연결 설정, 서버 없이 체험
app/src/main/java/ai/jhgo/car/PleosBridge.kt     JS ↔ Kotlin 통로, SdkBackend 인터페이스
app/src/pleos/java/ai/jhgo/car/PleosBackend.kt   NaviHelper·Vehicle·CarUxRestrictions 호출
app/src/pleos/java/ai/jhgo/car/NativeVoice.kt    Pleos TTS → 안드로이드 TTS, SpeechRecognizer
app/src/pleos/AndroidManifest.xml                Pleos 권한
app/src/demo/java/ai/jhgo/car/SdkBackends.kt     브리지 없음
app/src/main/res/mipmap-*/                       런처 아이콘(어댑티브: 아스팔트색 바탕 + 'GO!' 도현체, 폰 웹 아이콘과 같은 표식)
```
