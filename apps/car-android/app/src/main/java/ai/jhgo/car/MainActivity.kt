package ai.jhgo.car

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader

/**
 * 차량 앱 셸: 차량 화면은 웹(apps/car-web)이고, 이 액티비티는 WebView를 띄우고 SDK 브리지를 붙인다.
 *  - 처음 켜면 시작 화면: ① 자동 시연 보기(앱에 넣은 체험 페이지, 시뮬레이터 — 서버·설정 없이 7단계가 저절로)
 *    ② 실제 차 신호로 쓰기(앱에 넣은 차량 화면 + 페이지 안 서버, pleos 플레이버면 Pleos SDK 신호) ③ 서버에 연결(PC 서버의 /car/, 판매자 폰과 같은 서버).
 *  - 서버 주소를 한 번 정해 연결하면 다음부터는 바로 그 서버로 간다. 못 붙으면 시작 화면으로 돌아온다. 뒤로 가기도 시작 화면.
 */
class MainActivity : ComponentActivity() {
    private var web: WebView? = null
    private var bridge: PleosBridge? = null
    private var gleo: GleoBridge? = null
    /** 화면이 뜨기 전에 온 Gleo 호출(앱을 Gleo가 처음 띄운 경우) */
    private var pendingGleo: Intent? = null
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
        // Gleo AI 음성 기능 → 웹 화면(assets/schema.json). SDK 플레이버와 무관하게 붙는다
        val g = GleoBridge(this, w)
        w.addJavascriptInterface(g, "GleoBridge")
        gleo = g
        root.addView(w, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = w
        // 서버 주소를 정해 둔 적이 있으면 바로 연결, 아니면 시작 화면(심사·체험용 APK는 서버 없이 열린다)
        if (prefs.contains(KEY_SERVER)) loadServer() else showStart(null)
        (pendingGleo ?: intent)?.let { if (g.accepts(it)) web?.postDelayed({ g.handle(it) }, 2500) }
        pendingGleo = null
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val g = gleo
        if (g == null) {
            pendingGleo = intent
            return
        }
        if (g.accepts(intent)) g.handle(intent)
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

    /** 앱에 넣은 체험 페이지(판매자 폰 + 차 화면 + 가상 콘솔)를 시뮬레이터로 열고 자동 시연을 바로 시작한다. */
    private fun loadDemo() {
        offline = true
        hideOverlay()
        web?.loadUrl("https://appassets.androidplatform.net/assets/demo/index.html?auto&sim&stage")
    }

    private fun showConnect(reason: String) = showStart(reason)

    /** 시작 화면. reason이 있으면 방금 연결·열기에 실패한 것. */
    private fun showStart(reason: String?) {
        val box = panel()
        val brand = LinearLayout(this)
        brand.orientation = LinearLayout.HORIZONTAL
        brand.addView(label("주행중", 44f, INK, bold = true))
        brand.addView(label("GO!", 44f, KRAFT, bold = true))
        box.addView(brand)
        box.addView(label("가는 길에, 한 번에 하나씩 — 경로 가까이 올라온 중고 물건을 차가 골라 물어봐요", 20f, MUTED))
        if (reason != null) {
            val why = if (offline) "앱 안에 넣은 화면을 열지 못했어요. 저장소에서 build.bat으로 다시 빌드하세요. ($reason)"
            else "서버에 연결하지 못했어요. PC에서 npm start로 서버를 켰는지, 주소가 맞는지 확인하세요. ($reason)"
            box.addView(label(why, 18f, WARN))
        }
        box.addView(choice("자동 시연 보기", "판매자 폰과 차 화면이 함께 움직이며 7단계가 2분 동안 저절로 진행돼요. 서버도 설정도 필요 없어요", primary = true) { loadDemo() })
        val sdk = SdkBackends.permissions.isNotEmpty()
        box.addView(
            choice(
                if (sdk) "실제 차 신호로 쓰기" else "차 화면만 써 보기",
                if (sdk) "Pleos 내비와 차량 신호로 돌아요. 에뮬레이터 위치를 수원시청 근처에 두고 내비 목적지를 송파로 정하면 출발 전 브리핑이 열려요"
                else "차 화면과 가상 콘솔만 열어요. 판매자 폰 없이 바로 확정 매물로 흐름을 볼 수 있어요",
                primary = false,
            ) { loadOffline() },
        )
        // 서버에 연결: 판매자 폰(실제 폰)과 함께 시연할 때
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        row.setPadding(0, dp(18), 0, 0)
        val input = EditText(this)
        input.setText(serverBase())
        input.setTextColor(INK)
        input.setHintTextColor(MUTED)
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        input.setSingleLine(true)
        input.background = rounded(FIELD, 14)
        input.setPadding(dp(18), dp(14), dp(18), dp(14))
        row.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val connect = Button(this)
        connect.text = "서버에 연결"
        connect.isAllCaps = false
        connect.setTextColor(INK)
        connect.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        connect.background = rounded(RAISED, 14)
        connect.minHeight = dp(64)
        connect.setPadding(dp(24), 0, dp(24), 0)
        connect.setOnClickListener {
            prefs.edit().putString(KEY_SERVER, input.text.toString().trim()).apply()
            loadServer()
        }
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.leftMargin = dp(12)
        row.addView(connect, lp)
        box.addView(row)
        box.addView(label("서버에 연결: PC에서 npm start(8787) — 판매자 폰과 같은 서버를 쓸 때. 에뮬레이터에서 PC 주소는 10.0.2.2예요", 16f, MUTED))
        val scroll = ScrollView(this)
        scroll.setBackgroundColor(PANEL)
        scroll.isFillViewport = true
        scroll.addView(box)
        showOverlay(scroll)
    }

    /** 큰 선택 버튼: 제목 + 한 줄 설명. 주행 화면이 아니라 정차 중 첫 화면이지만 차 화면이라 크게(높이 96dp 이상). */
    private fun choice(title: String, desc: String, primary: Boolean, onClick: () -> Unit): View {
        val v = LinearLayout(this)
        v.orientation = LinearLayout.VERTICAL
        v.background = rounded(if (primary) KRAFT else RAISED, 20)
        v.setPadding(dp(26), dp(18), dp(26), dp(18))
        v.minimumHeight = dp(96)
        v.isClickable = true
        v.isFocusable = true
        v.contentDescription = title
        v.addView(label(title, 28f, if (primary) KRAFT_INK else INK, bold = true))
        v.addView(label(desc, 18f, if (primary) KRAFT_INK else MUTED))
        v.setOnClickListener { onClick() }
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(14)
        v.layoutParams = lp
        return v
    }

    private fun rounded(color: Int, radiusDp: Int): GradientDrawable {
        val d = GradientDrawable()
        d.setColor(color)
        d.cornerRadius = dp(radiusDp).toFloat()
        return d
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

    private fun label(text: String, sp: Float, color: Int, bold: Boolean = false): TextView {
        val t = TextView(this)
        t.text = text
        t.setTextColor(color)
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (bold) t.setTypeface(t.typeface, Typeface.BOLD)
        t.setPadding(0, dp(4), 0, dp(6))
        return t
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

    /** 뒤로 가기: 화면을 보던 중이면 시작 화면으로, 시작 화면에서는 앱을 닫는다. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (overlay == null && web != null) {
            web?.loadUrl("about:blank")   // 돌던 시연·음성을 멈춘다
            showStart(null)
        } else super.onBackPressed()
    }

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
        private val RAISED = Color.parseColor("#243042")
        private val FIELD = Color.parseColor("#1d2634")
        private val KRAFT = Color.parseColor("#d8ae74")
        private val KRAFT_INK = Color.parseColor("#2a1c0c")
        private val WARN = Color.parseColor("#f2a65a")
    }
}
