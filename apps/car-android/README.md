# 차량 앱 셸 (Android, Pleos Connect)

차량 화면은 웹(`apps/car-web`)이다. 이 앱은 WebView로 그 화면을 띄우고 `window.PleosBridge`를 붙여서, 웹이 실제 Pleos SDK(NaviHelper 3.0.5·Vehicle 2.3.2·TextToSpeech 3.3.1·SpeechToText 3.3.1)를 부르게 한다. 2026-11-04에 PC에서 실제 SDK로 `pleosDebug`·`pleosRelease` 빌드에 성공했다(에뮬레이터 실행은 아직). 프로토콜은 `docs/BRIDGE.md`, SDK별 확인 현황은 `docs/API_MATRIX.md`.

| 플레이버 | 하는 일 |
|---|---|
| `demo` | 브리지 없이 WebView만. 웹이 자체 시뮬레이터·가상 콘솔로 돈다. SDK 없이 빌드되므로 셸·서버 연결을 먼저 확인할 때 쓴다 |
| `pleos` | 실제 SDK. 시뮬레이터 대신 NaviHelper·Vehicle 신호로 돈다. 오른쪽 아래 'SDK 기록'에 호출·이벤트가 남는다 |

## 빌드

방법 1 — Android Studio: 이 폴더(`apps/car-android`)를 열고 빌드 변형에서 `demoDebug` 또는 `pleosDebug`를 고른다. Pleos Maven(`nexus-playground.pleos.ai`)은 계정 없이 받을 수 있다.

방법 2 — 명령(탐색기에서 두 번 클릭해도 된다):

| 파일 | 하는 일 | 결과 |
|---|---|---|
| `build.bat` | 웹 화면과 체험 페이지를 먼저 빌드해 앱 안에 넣고(서버 없이 쓰는 화면), `demoDebug`·`pleosDebug`를 차례로 빌드 | `build_log.txt`의 `EXIT_WEB`·`EXIT_DEMOPAGE`·`EXIT_DEMO`·`EXIT_PLEOS`(0이면 성공), `app/build/outputs/apk/{demo,pleos}/debug/` |
| `install.bat` | (= `build.bat install`) 켜져 있는 에뮬레이터에 pleosDebug 설치, `adb reverse tcp:8787 tcp:8787`, 앱 실행 | |
| `release.bat` | (= `build.bat release`) 웹 화면·체험 페이지를 다시 빌드해 넣고 `pleosRelease` 빌드 → 저장소 루트 `apk/juhaengjung-go_pleos_release.apk`로 복사(제출용, debug 키 서명). 제출할 때 `팀명_주행중GO_release.apk`로 이름을 바꾼다 | `EXIT_RELEASE` |

빌드 오류가 나면 그 줄이 문서와 실제 SDK의 차이다. 지금까지 나온 차이는 Vehicle 리스너의 `onFailed(e: Exception)` 하나였다(`docs/API_MATRIX.md`). 시그니처는 실제 SDK 바이너리에서 뽑은 `tools/sdk-dump/pleos-sdk-signatures.txt`와 맞춰 본다.

**Gradle JVM이 죽을 때**(`hs_err_pid*.log`, `EXCEPTION_ACCESS_VIOLATION`): 일부 PC(i9-14900KF 등)에서 JIT·R8 중에 크래시한다. `gradle.properties`에 C1만 쓰고 병렬을 줄이는 설정을 넣어 두었다(느려지지만 끝까지 간다). 안 나는 PC에서는 지워도 된다.

## 에뮬레이터에서 실행

0. (처음 한 번) 에뮬레이터 만들기: Android Studio → SDK Manager → SDK Update Sites에 `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml` 추가 → SDK Platforms에서 Pleos Connect 시스템 이미지(2.1.0, API 34) 설치 → Device Manager에서 Automotive 기기로 AVD 생성(Cold boot, RAM 4 GB).
1. 에뮬레이터를 켠 뒤 `install.bat` — pleos APK 설치, `adb reverse tcp:8787 tcp:8787`, 앱 실행.
2. 앱을 켜면 시작 화면이 뜬다. **자동 시연 보기**: 앱 안의 체험 페이지(판매자 폰 + 차 화면 + 가상 콘솔)가 시뮬레이터로 7단계를 저절로 돌린다(`assets/demo/index.html?auto&sim` — `?sim`이면 브리지가 있어도 시뮬레이터). **실제 차 신호로 쓰기**: 앱 안 차량 화면 + 페이지 안 서버를 Pleos SDK 신호로(`assets/car/index.html?local`). **서버에 연결**: PC에서 저장소 루트 `npm start`(8787) 뒤 주소(기본 `http://10.0.2.2:8787`, 실기기는 PC의 LAN 주소)를 넣는다 — 한 번 연결한 주소는 기억해서 다음부터 바로 그 서버로 간다.
3. 연결·열기에 실패하면 이유와 함께 시작 화면으로 돌아온다. 뒤로 가기도 시작 화면.
4. 시연 매물은 수원~송파 도로망 위에 있다. 에뮬레이터 위치를 수원시청 근처로 두고 Pleos 내비에서 목적지를 송파로 정하면 출발 전 브리핑이 열린다. 판매자는 PC나 폰 브라우저의 `/seller/`.
5. 웹 화면 디버깅: PC 크롬 `chrome://inspect` → WebView.

## 확인할 것 (에뮬레이터)

`docs/API_MATRIX.md`의 🧪 열과 마지막 절. 결과는 그 표에 적고, 대체(↪)로 둔 기능 중 확인된 API가 생기면 `PleosBackend.kt`에서 교체한다.

## 파일

```
app/src/main/java/ai/jhgo/car/MainActivity.kt    WebView, 권한, 연결 설정, 서버 없이 체험
app/src/main/java/ai/jhgo/car/PleosBridge.kt     JS ↔ Kotlin 통로, SdkBackend 인터페이스
app/src/pleos/java/ai/jhgo/car/PleosBackend.kt   NaviHelper·Vehicle·CarUxRestrictions 호출
app/src/pleos/java/ai/jhgo/car/NativeVoice.kt    Pleos TTS·STT(ON_DEVICE) → 안 되면 안드로이드 TTS·SpeechRecognizer
app/src/main/java/ai/jhgo/car/GleoBridge.kt      Gleo AI 음성 기능(Intent → 웹 → APP_ACTION_RESPONSE)
app/src/main/assets/schema.json                  Gleo App Schema(기능 3개, 공식 작성 규칙)
app/src/pleos/AndroidManifest.xml                Pleos 권한
app/src/demo/java/ai/jhgo/car/SdkBackends.kt     브리지 없음
app/src/main/res/mipmap-*/                       런처 아이콘(어댑티브: 아스팔트색 바탕 + 'GO!' 도현체, 폰 웹 아이콘과 같은 표식)
```
