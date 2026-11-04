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
import ai.pleos.playground.tts.constant.ErrorType
import ai.pleos.playground.tts.constant.Mode
import ai.pleos.playground.tts.listener.EventListener
import ai.pleos.playground.tts.listener.OnInitializeListener

/**
 * 음성: 말하기는 Pleos TextToSpeech(ON_DEVICE, 앱 등록 불필요) → 안 되면 안드로이드 TextToSpeech.
 * 듣기는 안드로이드 SpeechRecognizer로 정해진 단어("응·아니"·품목 이름)만 받는다. Pleos SpeechToText는 사용 신청 준비 중.
 * 모든 메서드는 메인 스레드에서 불린다(브리지 코루틴이 Dispatchers.Main).
 */
class NativeVoice(private val context: Context) {
    private var pleos: PleosTts? = null
    private var pleosDone: CompletableDeferred<Unit>? = null
    private var platformTts: TextToSpeech? = null
    private var platformDone: CompletableDeferred<Unit>? = null
    private var recognizer: SpeechRecognizer? = null
    private var initialized = false

    private suspend fun init() {
        if (initialized) return
        initialized = true
        try {
            val t = PleosTts(context, Mode.ON_DEVICE)
            val ok = CompletableDeferred<Boolean>()
            t.initialize(object : OnInitializeListener {
                override fun onSuccess() {
                    ok.complete(true)
                }

                override fun onFailure(errorType: ErrorType) {
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

                    override fun onError(errorType: ErrorType) {
                        Log.w(TAG, "Pleos TTS 오류: ${errorType.name}")
                        pleosDone?.complete(Unit)
                    }
                })
                pleos = t
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Pleos TTS 없음: ${e.javaClass.simpleName}")
        }
        if (pleos == null) {
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
    }

    suspend fun capabilities(): JSONObject {
        init()
        return JSONObject()
            .put("tts", pleos != null || platformTts != null)
            .put("stt", sttAvailable())
            .put("ttsEngine", if (pleos != null) "pleos" else if (platformTts != null) "android" else "none")
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
        runCatching { recognizer?.cancel() }
    }

    private fun sttAvailable(): Boolean =
        runCatching { SpeechRecognizer.isRecognitionAvailable(context) }.getOrDefault(false) &&
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** 정해진 단어 중 하나를 듣는다(words가 비어 있으면 들은 문장 그대로). 못 알아들으면 null */
    suspend fun listen(words: List<String>, timeoutMs: Long): String? {
        if (!sttAvailable()) return null
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
        runCatching { recognizer?.destroy() }
        pleos = null
        platformTts = null
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
