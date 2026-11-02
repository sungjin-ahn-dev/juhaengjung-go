package ai.jhgo.car

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader

/**
 * 차량 앱 셸: 차량 화면은 웹(apps/car-web)이고, 이 액티비티는 WebView를 띄우고 SDK 브리지를 붙인다.
 *  - 기본: PC 서버의 /car/ 를 연다(에뮬레이터에서 PC = 10.0.2.2). 판매자 폰과 같은 서버를 쓴다.
 *  - 서버에 못 붙으면: 주소를 고치거나, 앱에 넣은 화면을 브라우저 안 서버(?local)로 연다.
 */
class MainActivity : ComponentActivity() {
    private var web: WebView? = null
    private var bridge: PleosBridge? = null
    private lateinit var root: FrameLayout
    private var overlay: View? = null
    private var offline = false
    private val prefs by lazy { getSharedPreferences("jhgo", MODE_PRIVATE) }
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }
    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { start() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        root.setBackgroundColor(BG)
        setContentView(root)
        // SDK 권한을 먼저 받고 화면을 연다(리스너 등록이 권한 뒤에 일어나도록)
        val wanted = SdkBackends.permissions + Manifest.permission.RECORD_AUDIO
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) start() else permissionRequest.launch(missing.toTypedArray())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun start() {
        if (web != null) return
        val w = try {
            WebView(this)
        } catch (e: Exception) {
            // 일부 차량용 이미지에는 WebView가 없다(G0 확인 항목)
            showMessage("이 기기에서 WebView를 열 수 없어요", "${e.javaClass.simpleName}: ${e.message}")
            return
        }
        // PC 크롬의 chrome://inspect 로 화면·콘솔을 볼 수 있게(점검용)
        WebView.setWebContentsDebuggingEnabled(true)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.settings.mediaPlaybackRequiresUserGesture = false
        w.setBackgroundColor(BG)
        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showConnect("${error.errorCode} ${error.description}")
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame) showConnect("HTTP ${errorResponse.statusCode}")
            }
        }
        SdkBackends.create(this)?.let { backend ->
            val b = PleosBridge(w, backend)
            w.addJavascriptInterface(b, "PleosBridge")
            bridge = b
        }
        root.addView(w, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = w
        loadServer()
    }

    private fun serverBase(): String = prefs.getString(KEY_SERVER, null) ?: BuildConfig.SERVER_BASE_URL

    private fun loadServer() {
        offline = false
        hideOverlay()
        val url = serverBase().trimEnd('/') + "/car/"
        Log.i(TAG, "open $url (SDK 브리지 ${if (bridge != null) "켜짐" else "없음"})")
        web?.loadUrl(url)
    }

    private fun loadOffline() {
        offline = true
        hideOverlay()
        // 앱에 넣은 차량 화면 + 브라우저 안 서버. 판매자 폰 없이도 자동 수락 매물로 흐름을 볼 수 있다.
        web?.loadUrl("https://appassets.androidplatform.net/assets/car/index.html?local")
    }

    private fun showConnect(reason: String) {
        val hint =
            if (offline) "앱 안에 차량 화면이 없어요. 저장소에서 npm run build:web 을 한 뒤 앱을 다시 빌드하세요. ($reason)"
            else "PC에서 npm start 로 서버를 켠 뒤 다시 연결하세요. 에뮬레이터에서 PC 주소는 10.0.2.2 예요. ($reason)"
        val box = panel()
        box.addView(label("서버에 연결하지 못했어요", 30f, INK))
        box.addView(label(hint, 18f, MUTED))
        val input = EditText(this)
        input.setText(serverBase())
        input.setTextColor(INK)
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        input.setSingleLine(true)
        box.addView(input)
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.addView(button("다시 연결") {
            prefs.edit().putString(KEY_SERVER, input.text.toString().trim()).apply()
            loadServer()
        })
        row.addView(button("서버 없이 체험") { loadOffline() })
        box.addView(row)
        showOverlay(box)
    }

    private fun showMessage(title: String, body: String) {
        val box = panel()
        box.addView(label(title, 30f, INK))
        box.addView(label(body, 18f, MUTED))
        showOverlay(box)
    }

    private fun panel(): LinearLayout {
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.gravity = Gravity.CENTER_VERTICAL
        box.setPadding(dp(48), dp(36), dp(48), dp(36))
        box.setBackgroundColor(PANEL)
        return box
    }

    private fun label(text: String, sp: Float, color: Int): TextView {
        val t = TextView(this)
        t.text = text
        t.setTextColor(color)
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        t.setPadding(0, dp(6), 0, dp(10))
        return t
    }

    private fun button(text: String, onClick: () -> Unit): Button {
        val b = Button(this)
        b.text = text
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        b.setOnClickListener { onClick() }
        return b
    }

    private fun showOverlay(v: View) {
        hideOverlay()
        root.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlay = v
    }

    private fun hideOverlay() {
        overlay?.let { root.removeView(it) }
        overlay = null
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        bridge?.release()
        web?.destroy()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "JhgoCar"
        private const val KEY_SERVER = "serverBase"
        private val BG = Color.parseColor("#18202b")
        private val PANEL = Color.parseColor("#141b25")
        private val INK = Color.parseColor("#e8edf3")
        private val MUTED = Color.parseColor("#9fb0c3")
    }
}
