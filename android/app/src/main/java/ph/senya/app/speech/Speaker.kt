package ph.senya.app.speech

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import ph.senya.app.core.VoicePicker
import java.util.Locale

/** Offline text-to-speech. [onStatus] reports problems the user can fix (missing voice). */
class Speaker(
    context: Context,
    private val onStatus: (String) -> Unit,
    private val onReady: (() -> Unit)? = null,
) : TextToSpeech.OnInitListener {
    data class VoiceChoice(val name: String, val label: String)

    private val prefs = context.applicationContext.getSharedPreferences("senya", Context.MODE_PRIVATE)
    private val tts = TextToSpeech(context.applicationContext, this)
    @Volatile private var ready = false
    @Volatile private var closed = false
    private var offlineVoices = emptyList<Voice>()
    private var selectedVoice: Voice? = null

    val isReady: Boolean get() = ready
    val selectedVoiceName: String? get() = selectedVoice?.name

    fun availableVoices(): List<VoiceChoice> = offlineVoices.map { voice ->
        VoiceChoice(voice.name, "${voice.locale.getDisplayName(Locale.getDefault())} · ${voice.name}")
    }

    override fun onInit(status: Int) {
        if (closed) return
        if (status != TextToSpeech.SUCCESS) {
            onStatus("Text-to-speech is unavailable")
            onReady?.invoke()
            return
        }
        offlineVoices = tts.voices.orEmpty().filter { voice ->
            !voice.isNetworkConnectionRequired &&
                TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in voice.features.orEmpty() &&
                voice.locale.language in setOf("fil", "tl", "en")
        }
        val preferred = prefs.getString("voice_name", null)
        val chosen = offlineVoices.firstOrNull { it.name == preferred }
            ?: VoicePicker.pick(offlineVoices.map { it.toOption() })?.let { option ->
                offlineVoices.firstOrNull { it.name == option.name }
            }
        if (chosen == null) {
            onStatus("No offline voice installed. Download one in Settings → Text-to-speech.")
            onReady?.invoke()
            return
        }
        tts.voice = chosen
        selectedVoice = chosen
        ready = tts.voice?.name == chosen.name
        if (!ready) onStatus("This offline voice could not be selected")
        onReady?.invoke()
    }

    fun selectVoice(name: String): Boolean {
        val voice = offlineVoices.firstOrNull { it.name == name } ?: return false
        tts.voice = voice
        ready = tts.voice?.name == voice.name
        if (ready) {
            selectedVoice = voice
            prefs.edit().putString("voice_name", name).apply()
        }
        return ready
    }

    fun speak(text: String) {
        if (ready && text.isNotBlank()) tts.speak(text.trim(), TextToSpeech.QUEUE_FLUSH, null, "senya")
    }

    fun shutdown() {
        closed = true
        tts.shutdown()
    }

    private fun Voice.toOption() = VoicePicker.Option(
        name = name,
        language = locale.language,
        country = locale.country,
        needsNetwork = isNetworkConnectionRequired,
        installed = TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in features.orEmpty(),
    )
}
