package ai.jhgo.car

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * 실제 SDK 쪽 구현. pleos 플레이버의 PleosBackend가 NaviHelper·Vehicle·TextToSpeech를 부른다.
 * 메서드 이름·인자·결과는 docs/BRIDGE.md와 apps/car-web/src/pleos/bridge.ts가 정한다.
 */
interface SdkBackend {
    /** 리스너 콜백을 웹으로 내보낼 함수(브리지가 넣어 준다) */
    fun setEmitter(emit: (event: String, payload: Any?) -> Unit)

    /** 결과는 JSONObject · JSONArray · String · Number · Boolean · null 중 하나 */
    suspend fun call(method: String, args: JSONObject): Any?

    fun release()
}

/**
 * WebView ↔ SDK 브리지.
 *   JS → Kotlin: window.PleosBridge.call(id, method, argsJson)
 *   Kotlin → JS: window.__pleos.resolve(id, json) / reject(id, message) / emit(event, json)
 * @JavascriptInterface 메서드는 WebView의 JavaBridge 스레드에서 불리므로 메인 스레드 코루틴으로 넘긴다.
 */
class PleosBridge(private val web: WebView, private val backend: SdkBackend) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    init {
        backend.setEmitter { event, payload ->
            js("window.__pleos&&window.__pleos.emit(${q(event)},${q(Json.text(payload))})")
        }
    }

    @JavascriptInterface
    fun call(id: String, method: String, argsJson: String) {
        scope.launch {
            try {
                val args = if (argsJson.isBlank()) JSONObject() else JSONObject(argsJson)
                val result = backend.call(method, args)
                js("window.__pleos&&window.__pleos.resolve(${q(id)},${q(Json.text(result))})")
            } catch (e: Throwable) {
                Log.w(TAG, "$method 실패: ${e.message}")
                js("window.__pleos&&window.__pleos.reject(${q(id)},${q(e.message ?: e.javaClass.simpleName)})")
            }
        }
    }

    fun release() {
        scope.cancel()
        backend.release()
    }

    private fun js(code: String) {
        web.post { web.evaluateJavascript(code, null) }
    }

    private fun q(s: String): String = JSONObject.quote(s)

    companion object {
        private const val TAG = "PleosBridge"
    }
}

/** 결과 값을 JSON 글로 바꾼다(웹이 JSON.parse 한다) */
object Json {
    fun text(v: Any?): String = when (v) {
        null, Unit -> "null"
        is JSONObject -> v.toString()
        is JSONArray -> v.toString()
        is String -> JSONObject.quote(v)
        is Boolean -> v.toString()
        is Double -> if (v.isFinite()) v.toString() else "null"
        is Float -> if (v.isFinite()) v.toString() else "null"
        is Number -> v.toString()
        else -> JSONObject.quote(v.toString())
    }
}
