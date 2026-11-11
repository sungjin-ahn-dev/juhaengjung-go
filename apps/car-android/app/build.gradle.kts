plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "ai.jhgo.car"
    compileSdk = 34   // Pleos Connect Emulator 시스템 이미지 API 34, minSdk ≥ 28 (공식 환경 문서)

    defaultConfig {
        applicationId = "ai.jhgo.car"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        // 에뮬레이터에서 PC(호스트)는 10.0.2.2. 앱 안 '연결 설정'에서 바꿀 수 있다.
        buildConfigField("String", "SERVER_BASE_URL", "\"http://10.0.2.2:8787\"")
    }

    // demo:  SDK 없이 WebView만. 차량 화면은 웹의 시뮬레이터·가상 콘솔로 돈다(빌드 확인용).
    // pleos: WebView에 PleosBridge를 붙여 실제 NaviHelper·Vehicle·TextToSpeech·SpeechToText SDK를 부른다.
    flavorDimensions += "sdk"
    productFlavors {
        create("demo") { dimension = "sdk"; applicationIdSuffix = ".demo"; versionNameSuffix = "-demo" }
        create("pleos") { dimension = "sdk" }
    }
    buildTypes {
        debug { isMinifyEnabled = false }
        // 공모전 제출 APK: 서명 키가 따로 없어 디버그 키로 서명한다(에뮬레이터·심사용 설치에는 충분). 스토어 배포 때 바꾼다
        release { isMinifyEnabled = false; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt")); signingConfig = signingConfigs.getByName("debug") }
    }
    buildFeatures { buildConfig = true }
    // 제출용 release 빌드가 lint-gradle 다운로드(dl.google.com)에 막히지 않게 — lint는 debug에서 돌린다
    lint { checkReleaseBuilds = false; abortOnError = false }
    // AAOS 플랫폼 라이브러리(android.car): 주행 중 여부(CarUxRestrictions). pleos 플레이버에서만 참조한다.
    useLibrary("android.car")
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }

    // 서버 없이 쓰는 화면(웹 빌드 결과)을 앱 안에 넣는다: ../car-web/dist → assets/car, ../demo/dist/index.html → assets/demo
    sourceSets { getByName("main") { assets.srcDir(layout.buildDirectory.get().asFile.resolve("generated/carweb")) } }
}

// Sync: 지난 빌드의 해시 붙은 파일(옛 글꼴·스크립트)이 APK에 남지 않게 대상 폴더를 원본과 같게 맞춘다
val copyCarWeb by tasks.registering(Sync::class) {
    description = "apps/car-web/dist를 앱 assets/car로 복사(없으면 건너뜀 — 먼저 npm run build:web)"
    from(rootProject.file("../car-web/dist"))
    into(layout.buildDirectory.dir("generated/carweb/car"))
}
// 시작 화면의 '자동 시연 보기'가 여는 체험 페이지(한 파일): ../demo/dist/index.html → assets/demo (없으면 건너뜀 — npm run build:demo)
val copyDemo by tasks.registering(Sync::class) {
    description = "apps/demo/dist/index.html을 앱 assets/demo로 복사"
    from(rootProject.file("../demo/dist")) { include("index.html") }
    into(layout.buildDirectory.dir("generated/carweb/demo"))
}
tasks.named("preBuild") { dependsOn(copyCarWeb, copyDemo) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.kotlinx.coroutines.android)
    "pleosImplementation"(libs.pleos.vehicle)
    "pleosImplementation"(libs.pleos.navihelper)
    "pleosImplementation"(libs.pleos.tts)
    "pleosImplementation"(libs.pleos.stt)
}
