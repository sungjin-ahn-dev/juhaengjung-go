package ai.jhgo.car

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.UUID

/**
 * Gleo AI(차량 음성 비서) ↔ 웹 화면.
 *  - 들어오는 쪽: Gleo가 assets/schema.json의 function 이름을 Intent action으로, 인자를 extra ACTION_PARAM(JSON 문자열)으로 startActivity 한다.
 *    MainActivity가 받아 handle()에 넘기면 웹의 window.__jhgoGleo(json)을 부른다.
 *  - 나가는 쪽: 웹이 window.GleoBridge.respond(json)으로 결과를 주면 APP_ACTION_RESPONSE 브로드캐스트로 돌려준다(Gleo는 7초 뒤 취소).
 *    웹이 답하지 않으면 5초 뒤 fail로 답한다.
 * 문서: document.pleos.ai › App Integration Guide (App Schema, Callback Schema, Delivering the Schema). 에뮬레이터 동작은 미확인(G0).
 */
class GleoBridge(private val context: Context, private val web: WebView) {
    private val main = Handler(Looper.getMainLooper())
    private val pending = HashMap<String, Runnable>()

    /** Gleo가 부른 Intent인지 */
    fun accepts(intent: Intent?): Boolean = intent?.action in FUNCTIONS

    fun handle(intent: Intent) {
        val name = intent.action ?: return
        val raw = intent.getStringExtra(EXTRA_PARAM) ?: "{}"
        // 예시 문서대로 값에 따옴표가 한 겹 더 올 수 있다 → 벗긴다
        val paramsText = raw.trim().let { if (it.startsWith("\"") && it.endsWith("\"") && it.length >= 2) JSONObject("{\"v\":$it}").getString("v") else it }
        val params = try { JSONObject(paramsText) } catch (e: Exception) { JSONObject() }
        val id = UUID.randomUUID().toString()
        val timeout = Runnable {
            pending.remove(id)
            send(callback(name, "fail", "The app did not respond in time."))
        }
        pending[id] = timeout
        main.postDelayed(timeout, 5000)
        val req = JSONObject().put("requestId", id).put("name", name).put("params", params)
        Log.i(TAG, "Gleo → $name $params")
        deliver(id, req)
    }

    /** 웹이 아직 안 떴으면(앱을 Gleo가 처음 띄운 경우) 0.5초마다 다시 시도한다. 5초 timeout이 fail을 보낸다 */
    private fun deliver(id: String, req: JSONObject) {
        if (!pending.containsKey(id)) return
        web.evaluateJavascript("window.__jhgoGleo?(window.__jhgoGleo(${JSONObject.quote(req.toString())}),true):false") { r ->
            if (r != "true") main.postDelayed({ deliver(id, req) }, 500)
        }
    }

    /** 웹이 부른다: {requestId, functionName, status, message, data?, mode?} */
    @JavascriptInterface
    fun respond(json: String) {
        main.post {
            try {
                val o = JSONObject(json)
                val id = o.optString("requestId")
                pending.remove(id)?.let { main.removeCallbacks(it) }
                o.remove("requestId")
                send(o)
            } catch (e: Exception) {
                Log.w(TAG, "응답 해석 실패: ${e.message}")
            }
        }
    }

    private fun callback(name: String, status: String, message: String): JSONObject =
        JSONObject().put("functionName", name).put("status", status).put("message", message)

    private fun send(response: JSONObject) {
        val i = Intent(ACTION_RESPONSE)
            .putExtra("packageName", context.packageName)
            .putExtra("response", response.toString())
        context.sendBroadcast(i)
        Log.i(TAG, "Gleo ← $response")
    }

    companion object {
        private const val TAG = "JhgoGleo"
        /** assets/schema.json actionCalls의 이름과 같아야 한다(브리지 계약 시험이 맞춘다) */
        val FUNCTIONS = setOf("ADD_INTEREST", "ANSWER_ALERT", "ASK_ABOUT_LISTINGS")
        const val EXTRA_PARAM = "ACTION_PARAM"
        const val ACTION_RESPONSE = "ai.pleos.playground.intent.action.APP_ACTION_RESPONSE"
    }
}
