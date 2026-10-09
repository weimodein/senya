package ph.senya.app.speech

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import ph.senya.app.R

/** The offline voice list shared by onboarding and Settings. */
object VoiceDialog {
    /** With no offline voice installed, this opens the system voice settings instead. [onChanged] runs after a pick. */
    fun show(context: Context, speaker: Speaker, openVoiceSettings: () -> Unit, onChanged: () -> Unit) {
        val choices = speaker.availableVoices()
        if (choices.isEmpty()) {
            openVoiceSettings()
            return
        }
        AlertDialog.Builder(context)
            .setTitle(R.string.onboarding_choose_voice)
            .setSingleChoiceItems(choices.map { it.label }.toTypedArray(),
                choices.indexOfFirst { it.name == speaker.selectedVoiceName }) { dialog, which ->
                if (!speaker.selectVoice(choices[which].name)) {
                    Toast.makeText(context, R.string.onboarding_voice_select_failed, Toast.LENGTH_SHORT).show()
                }
                onChanged()
                dialog.dismiss()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** Opens the system text-to-speech settings. False if this phone has no screen for it. */
    fun openTtsSettings(context: Context): Boolean = try {
        context.startActivity(Intent("com.android.settings.TTS_SETTINGS"))
        true
    } catch (_: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Settings.ACTION_SETTINGS))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
