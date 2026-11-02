package ai.jhgo.car

import android.content.Context

/** pleos 플레이버: 실제 Pleos Connect SDK(NaviHelper 3.0.5 · Vehicle 2.3.2 · TextToSpeech 3.3.1) */
object SdkBackends {
    /** 매니페스트(src/pleos/AndroidManifest.xml)와 같은 목록. 일반 권한이면 대화상자 없이 지나간다. */
    val permissions: List<String> = listOf(
        "pleos.car.permission.CAR_DRIVE",
        "pleos.car.permission.CAR_LIGHTS",
        "pleos.car.permission.CAR_SEATS",
        "pleos.car.permission.CAR_ENERGY",
        "pleos.car.permission.NAVI_ROUTE",
        "pleos.car.permission.NAVI_ROUTE_SEARCH",
        "pleos.car.permission.TTS_SERVICE",
    )

    fun create(context: Context): SdkBackend? = PleosBackend(context.applicationContext)
}
