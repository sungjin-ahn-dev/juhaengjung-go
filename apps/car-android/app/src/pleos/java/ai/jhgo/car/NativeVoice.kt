package ai.jhgo.car

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.Locale

// ---- Pleos TextToSpeech SDK 3.3.1 (공식 문서 시그니처 — 멀미예보 docs/API_MATRIX.md 1-b) ----
import ai.pleos.playground.tts.TextToSpeech as PleosTts
import ai.pleos.playground.tts.constant.ErrorType as TtsErrorType
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.EventListener
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInitListener

// ---- Pleos SpeechToText SDK 3.3.1 (공식 문서 2026-11-04 — docs/API_MATRIX.md 'SpeechToText SDK') ----
import ai.pleos.playground.stt.SpeechToText as PleosStt
import ai.pleos.playground.stt.constant.ErrorType as SttErrorType
import ai.pleos.playground.stt.constant.Mode as SttMode
import ai.pleos.playground.stt.listener.OnInitializeListener as SttInitListener
import ai.pleos.playground.stt.listener.ResultListener

/**
 * 음성.
 *   말하기: Pleos TextToSpeech(ON_DEVICE, 앱 등록 불필요) → 안 되면 안드로이드 TextToSpeech.
 *   듣기:   Pleos SpeechToText(ON_DEVICE, ko-KR, 앱 등록 불필요 — 차량 마이크를 SDK가 직접 켠다) → 안 되면 안드로이드 SpeechRecognizer(↪).
 *          정해진 단어("응·아니"·품목 이름)만 받거나, words가 비어 있으면 들은 문장 그대로(대화로 고르기).
 * 모든 public 메서드는 메인 스레드에서 불린다(브리지 코루틴이 Dispatchers.Main). SDK 콜백 스레드는 문서에 없어 Deferred로만 넘긴다.
 */
class NativeVoice(private val context: Context) {
    private var pleos: PleosTts? = null
    private var pleosDone: CompletableDeferred<Unit>? = null
    private var platformTts: TextToSpeech? = null
    private var platformDone: CompletableDeferred<Unit>? = null
    private var pleosStt: PleosStt? = null
    private var sttListener: ResultListener? = null
    private var sttListening: SttSession? = null
    /** 이 환경에서 Pleos STT를 못 쓰는 오류(NOT_SUPPORTED_API·PERMISSION_DENIED·UNAVAILABLE_LANGUAGE)가 나면 true → 안드로이드로 */
    @Volatile private var sttBroken = false
    private var recognizer: SpeechRecognizer? = null
    private var initialized = false

    /** 한 번의 듣기. 콜백이 어느 스레드에서 와도 되도록 Deferred에만 쓴다 */
    private class SttSession(val words: List<String>) {
        val done = CompletableDeferred<String?>()
        @Volatile var partial: String = ""
    }

    private suspend fun init() {
        if (initialized) return
        initialized = true
        initPleosTts()
        if (pleos == null) initPlatformTts()
        initPleosStt()
    }

    private suspend fun initPleosTts() {
        try {
            val t = PleosTts(context, TtsMode.ON_DEVICE)
            val ok = CompletableDeferred<Boolean>()
            t.initialize(object : TtsInitListener {
                override fun onSuccess() {
                    ok.complete(true)
                }

                override fun onFailure(errorType: TtsErrorType) {
                    Log.w(TAG, "Pleos TTS 초기화 실패: ${errorType.name}")
                    ok.complete(false)
                }
            })
            if (withTimeoutOrNull(4000L) { ok.await() } == true) {
                runCatching { t.setLocale(Locale.KOREA) }
                t.addEventListener(object : EventListener {
                    override fun onReady() = Unit
                    override fun onStart() = Unit
                    override fun onUpdatedRms(rms: Double) = Unit
                    override fun onDone() {
                        pleosDone?.complete(Unit)
                    }

                    override fun onStop() {
                        pleosDone?.complete(Unit)
                    }

                    override fun onError(errorType: TtsErrorType) {
                        Log.w(TAG, "Pleos TTS 오류: ${errorType.name}")
                        pleosDone?.complete(Unit)
                    }
                })
                pleos = t
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Pleos TTS 없음: ${e.javaClass.simpleName}")
        }
    }

    private suspend fun initPlatformTts() {
        val ok = CompletableDeferred<Boolean>()
        val t = TextToSpeech(context) { status -> ok.complete(status == TextToSpeech.SUCCESS) }
        if (withTimeoutOrNull(4000L) { ok.await() } == true) {
            t.setLanguage(Locale.KOREAN)
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) {
                    platformDone?.complete(Unit)
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    platformDone?.complete(Unit)
                }
            })
            platformTts = t
        } else {
            t.shutdown()
        }
    }

    /**
     * Pleos SpeechToText: 인스턴스 → initialize(onSuccess 뒤에만 사용) → setLocale(Locale.KOREA) → addListener.
     * ON_DEVICE는 Pleos Playground 앱 등록이 없어도 된다(문서). 초기화에 실패하면 안드로이드 SpeechRecognizer로 간다.
     */
    private suspend fun initPleosStt() {
        try {
            val s = PleosStt(context, SttMode.ON_DEVICE)
            val ok = CompletableDeferred<Boolean>()
            s.initialize(object : SttInitListener {
                override fun onSuccess() {
                    ok.complete(true)
                }

                override fun onFailure(errorType: SttErrorType) {
                    Log.w(TAG, "Pleos STT 초기화 실패: ${errorType.name}")
                    ok.complete(false)
                }
            })
            if (withTimeoutOrNull(4000L) { ok.await() } != true) {
                runCatching { s.release() }
                return
            }
            runCatching { s.setLocale(Locale.KOREA) }
            val listener = object : ResultListener {
                override fun onReady() = Unit
                override fun onStartedRecognition() = Unit

                /** 인식 글이 갱신될 때마다. completed=true가 최종 */
                override fun onUpdated(stt: String, completed: Boolean) {
                    val ses = sttListening ?: return
                    if (stt.isNotBlank()) ses.partial = stt
                    if (completed) ses.done.complete(match(listOf(stt), ses.words))
                }

                override fun onUpdatedEpdData(on: Long, off: Long) = Unit
                override fun onUpdatedRms(rms: Double) = Unit

                /** 끝났는데 최종 결과가 안 왔으면(stop·무음) 마지막 부분 결과로 맞춰 본다 */
                override fun onEndedRecognition() {
                    val ses = sttListening ?: return
                    if (!ses.done.isCompleted) ses.done.complete(match(listOf(ses.partial), ses.words))
                }

                override fun onError(errorType: SttErrorType) {
                    Log.w(TAG, "Pleos STT 오류: ${errorType.name}")
                    val ses = sttListening
                    // 이 환경에서 못 쓰는 오류면 다음부터 안드로이드 SpeechRecognizer로
                    if (errorType == SttErrorType.NOT_SUPPORTED_API || errorType == SttErrorType.PERMISSION_DENIED || errorType == SttErrorType.UNAVAILABLE_LANGUAGE) sttBroken = true
                    ses?.done?.complete(null)
                }
            }
            s.addListener(listener) // request() 전에 등록해야 이벤트를 놓치지 않는다(문서)
            sttListener = listener
            pleosStt = s
        } catch (e: Throwable) {
            Log.w(TAG, "Pleos STT 없음: ${e.javaClass.simpleName}")
        }
    }

    suspend fun capabilities(): JSONObject {
        init()
        return JSONObject()
            .put("tts", pleos != null || platformTts != null)
            .put("stt", pleosSttUsable() || platformSttAvailable())
            .put("ttsEngine", if (pleos != null) "pleos" else if (platformTts != null) "android" else "none")
            .put("sttEngine", if (pleosSttUsable()) "pleos" else if (platformSttAvailable()) "android" else "none")
    }

    /** 말이 끝날 때까지(또는 길이로 잡은 시간까지) 기다린다 */
    suspend fun speak(text: String) {
        init()
        val p = pleos
        if (p != null) {
            val d = CompletableDeferred<Unit>()
            pleosDone = d
            p.speak(text)
            withTimeoutOrNull(estimateMs(text)) { d.await() }
            return
        }
        val a = platformTts ?: throw IllegalStateException("말하기를 쓸 수 없어요")
        val d = CompletableDeferred<Unit>()
        platformDone = d
        a.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jhgo-${System.currentTimeMillis()}")
        withTimeoutOrNull(estimateMs(text)) { d.await() }
    }

    fun stop() {
        runCatching { pleos?.stop() }
        runCatching { platformTts?.stop() }
        runCatching { pleosStt?.stop() }
        runCatching { recognizer?.cancel() }
    }

    private fun pleosSttUsable(): Boolean = pleosStt != null && !sttBroken

    private fun platformSttAvailable(): Boolean =
        runCatching { SpeechRecognizer.isRecognitionAvailable(context) }.getOrDefault(false) &&
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** 정해진 단어 중 하나를 듣는다(words가 비어 있으면 들은 문장 그대로). 못 알아들으면 null */
    suspend fun listen(words: List<String>, timeoutMs: Long): String? {
        init()
        if (pleosSttUsable()) {
            val r = listenPleos(words, timeoutMs)
            if (r != null || !sttBroken) return r
            // 방금 오류로 못 쓰게 됐으면 같은 요청을 안드로이드로 한 번 더
        }
        return listenPlatform(words, timeoutMs)
    }

    /** Pleos STT: request()로 차량 마이크를 켜고 onUpdated(completed=true)까지. 시간이 지나면 stop() → onEndedRecognition에서 부분 결과 */
    private suspend fun listenPleos(words: List<String>, timeoutMs: Long): String? {
        val s = pleosStt ?: return null
        val ses = SttSession(words)
        sttListening = ses
        try {
            s.request()
        } catch (e: Throwable) {
            Log.w(TAG, "Pleos STT request 실패: ${e.javaClass.simpleName}")
            sttListening = null
            return null
        }
        val w = withTimeoutOrNull(timeoutMs) { ses.done.await() }
        if (w == null && !ses.done.isCompleted) {
            runCatching { s.stop() }
            // stop() 뒤 onEndedRecognition이 부분 결과를 넣어 줄 짧은 틈
            val late = withTimeoutOrNull(700L) { ses.done.await() }
            sttListening = null
            return late
        }
        sttListening = null
        return w
    }

    private suspend fun listenPlatform(words: List<String>, timeoutMs: Long): String? {
        if (!platformSttAvailable()) return null
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        val d = CompletableDeferred<String?>()
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                d.complete(match(heard, words))
            }

            override fun onError(error: Int) {
                d.complete(null)
            }

            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        r.startListening(intent)
        val w = withTimeoutOrNull(timeoutMs) { d.await() }
        if (w == null) runCatching { r.cancel() }
        return w
    }

    fun release() {
        runCatching { pleos?.stop() }
        runCatching { pleos?.release() }
        runCatching { platformTts?.shutdown() }
        runCatching { pleosStt?.stop() }
        sttListener?.let { l -> runCatching { pleosStt?.removeListener(l) } } // 등록한 그 인스턴스를 release 전에 뺀다(문서)
        runCatching { pleosStt?.release() }
        runCatching { recognizer?.destroy() }
        pleos = null
        platformTts = null
        pleosStt = null
        sttListener = null
        recognizer = null
    }

    private fun estimateMs(text: String): Long = (2500L + text.length * 180L).coerceAtMost(25000L)

    companion object {
        private const val TAG = "NativeVoice"

        /** 들은 문장 안에 정해진 단어가 있으면 그 단어(띄어쓰기 무시). words가 비어 있으면 들은 문장 그대로(대화로 고르기) */
        fun match(heard: List<String>, words: List<String>): String? {
            if (words.isEmpty()) return heard.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
            for (h in heard) {
                val hn = h.replace(" ", "")
                for (w in words) if (hn.contains(w.replace(" ", ""))) return w
            }
            return null
        }
    }
}
