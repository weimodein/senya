package ph.senya.app.speech

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import ph.senya.app.core.VoicePicker

/** Offline text-to-speech. [onStatus] reports problems the user can fix (missing voice). */
class Speaker(context: Context, private val onStatus: (String) -> Unit) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(context.applicationContext, this)
    @Volatile private var ready = false

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            onStatus("Text-to-speech is unavailable")
            return
        }
        val voices = tts.voices.orEmpty().toList()
        val chosen = VoicePicker.pick(voices.map { it.toOption() })
        if (chosen == null) {
            onStatus("No offline voice installed. Download one in Settings → Text-to-speech.")
            return
        }
        tts.voice = voices.first { it.name == chosen.name }
        ready = true
    }

    fun speak(text: String) {
        if (ready && text.isNotBlank()) tts.speak(text.trim(), TextToSpeech.QUEUE_FLUSH, null, "senya")
    }

    fun shutdown() = tts.shutdown()

    private fun Voice.toOption() = VoicePicker.Option(
        name = name,
        language = locale.language,
        country = locale.country,
        needsNetwork = isNetworkConnectionRequired,
        installed = TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in features.orEmpty(),
    )
}
