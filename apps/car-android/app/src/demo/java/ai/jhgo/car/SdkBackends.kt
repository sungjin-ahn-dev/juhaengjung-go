package ai.jhgo.car

import android.content.Context

/** demo 플레이버: 브리지를 붙이지 않는다 → 웹이 자체 시뮬레이터·가상 콘솔로 돈다(SDK 없이 셸·서버 연결 확인용) */
object SdkBackends {
    val permissions: List<String> = emptyList()

    @Suppress("UNUSED_PARAMETER")
    fun create(context: Context): SdkBackend? = null
}
