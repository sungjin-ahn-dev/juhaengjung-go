# Pleos SDK 바이너리에서 시그니처 뽑기

`docs/API_MATRIX.md`의 "바이너리 확인" 판정은 이 폴더의 도구로 만들었다(2026-11-04). 문서(document.pleos.ai)의 API 레퍼런스 본문은 작업 환경에서 렌더되지 않아, PC에서 실제 SDK로 `pleosDebug`를 빌드한 뒤 라이브러리 dex를 읽었다.

## 입력

PC에서 `apps/car-android/build.bat` 뒤에 생기는 외부 라이브러리 dex:

```
apps/car-android/app/build/intermediates/dex/pleosDebug/mergeExtDexPleosDebug/classes.dex
apps/car-android/app/build/intermediates/dex/pleosDebug/mergeExtDexPleosDebug/classes2.dex
```

(`ai.pleos.playground:Vehicle:2.3.2`, `NaviHelper:3.0.5`, `TextToSpeech:3.3.1`, `SpeechToText:3.3.1` — `apps/car-android/gradle/libs.versions.toml`)

## 순서

1. `python3 -I dump_jvm.py classes.dex classes2.dex` → `pleos-api.txt` — `ai.pleos.*` 모든 클래스의 JVM 필드·메서드(androguard 4.1.4). 제네릭·매개변수 이름·null 가능 여부는 여기엔 없다.
2. `python3 -I extract_metadata.py classes.dex classes2.dex` → `meta.txt` — 각 클래스의 Kotlin `@Metadata`(k, d1, d2)를 base64로.
3. `kotlinc -cp <kotlinc>/lib/kotlin-compiler.jar -d out Decode.kt` 뒤 `java -cp out:<kotlinc>/lib/kotlin-compiler.jar:<kotlinc>/lib/kotlin-stdlib.jar DecodeKt meta.txt pleos-kotlin.txt` — Kotlin 컴파일러에 들어 있는 `JvmProtoBufUtil.readClassDataFrom(d1, d2)`로 메타데이터를 풀어 **Kotlin 시그니처**(매개변수 이름·순서·`?`·기본값 `= …`)로 적는다.
4. 주행중GO!가 쓰는 클래스만 추린 결과가 `pleos-sdk-signatures.txt`다.

## 읽을 때

- 시그니처가 맞는 것(컴파일)과 그 API가 에뮬레이터·실차에서 뜻대로 동작하는 것(🧪)은 다르다. 단위(km/m, 초)·값의 뜻(문 위치 0=닫힘?)·콜백이 오는 조건은 메타데이터에 없다.
- `constructor(secondary)(seen1: Int, …)`은 kotlinx.serialization이 만든 것이라 추렸다.
- 데이터 클래스의 `component1()` 순서 = 생성자 매개변수 순서.
