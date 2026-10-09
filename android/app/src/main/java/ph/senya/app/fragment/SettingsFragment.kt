package ph.senya.app.fragment

import android.content.res.ColorStateList
import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.core.widget.ImageViewCompat
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import ph.senya.app.BuildConfig
import ph.senya.app.R
import ph.senya.app.data.ModelRepository
import ph.senya.app.databinding.FragmentSettingsBinding
import ph.senya.app.speech.Speaker
import ph.senya.app.speech.VoiceDialog

/** M4 mockup: voice, model version and updates, and (debug builds only) the server override. */
class SettingsFragment : Fragment() {
    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!
    private lateinit var repository: ModelRepository
    private var speaker: Speaker? = null
    private var voiceError: String? = null
    private var voiceChecked = false
    private var voiceSettingsOpened = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        repository = ModelRepository(requireContext())
        binding.toolbar.toolbarTitle.setText(R.string.settings)
        binding.toolbar.toolbarBack.setOnClickListener { findNavController().popBackStack() }
        binding.settingsVoiceRow.setOnClickListener { chooseVoice() }
        binding.settingsVoiceStatusRow.setOnClickListener { if (speaker?.isReady != true) openVoiceSettings() }
        binding.settingsTestVoice.setOnClickListener { speaker?.speak(getString(R.string.onboarding_test_phrase)) }
        binding.settingsSpeakOnSpace.isChecked = repository.speakOnSpace
        binding.settingsSpeakOnSpace.setOnCheckedChangeListener { _, on -> repository.speakOnSpace = on }
        binding.settingsCheckUpdate.setOnClickListener {
            findNavController().navigate(R.id.action_settings_to_model_update)
        }
        setUpAdvanced()
        createSpeaker()
    }

    override fun onResume() {
        super.onResume()
        renderModel()
        if (voiceSettingsOpened) {
            voiceSettingsOpened = false
            speaker?.shutdown()
            createSpeaker()
        }
    }

    override fun onDestroyView() {
        speaker?.shutdown()
        speaker = null
        _binding = null
        super.onDestroyView()
    }

    private fun renderModel() {
        val info = repository.currentInfo()
        binding.settingsModelVersion.text =
            if (info == null) getString(R.string.model_none) else getString(R.string.model_version, info.version)
        binding.settingsModelType.text = info?.typeText ?: getString(R.string.model_type_none)
        val last = repository.lastCheckMs
        binding.settingsLastChecked.text = if (last == 0L) getString(R.string.settings_not_checked)
            else getString(R.string.settings_last_checked, DateUtils.getRelativeTimeSpanString(last))
    }

    private fun createSpeaker() {
        voiceError = null
        voiceChecked = false
        speaker = Speaker(requireContext(), { message ->
            activity?.runOnUiThread {
                voiceError = message
                renderVoice()
            }
        }, {
            activity?.runOnUiThread {
                voiceChecked = true
                renderVoice()
            }
        })
        renderVoice()
    }

    private fun renderVoice() {
        val b = _binding ?: return
        val current = speaker
        val voice = current?.availableVoices()?.firstOrNull { it.name == current.selectedVoiceName }
        b.settingsVoiceValue.text = voice?.label ?: getString(if (voiceChecked)
            R.string.onboarding_voice_missing else R.string.onboarding_voice_loading)
        val ready = current?.isReady == true
        b.settingsVoiceStatus.text = when {
            ready -> getString(R.string.onboarding_voice_available)
            !voiceChecked -> getString(R.string.onboarding_voice_loading)
            else -> voiceError ?: getString(R.string.settings_voice_missing)
        }
        b.settingsVoiceStatusIcon.setImageResource(if (ready) R.drawable.ic_check_circle else R.drawable.ic_warning)
        ImageViewCompat.setImageTintList(b.settingsVoiceStatusIcon, ColorStateList.valueOf(
            requireContext().getColor(if (ready) R.color.senya_blue else R.color.senya_warning)))
        b.settingsTestVoice.isEnabled = ready
        b.settingsTestVoice.alpha = if (ready) 1f else 0.5f
    }

    private fun chooseVoice() {
        val current = speaker ?: return
        VoiceDialog.show(requireContext(), current, ::openVoiceSettings, ::renderVoice)
    }

    private fun openVoiceSettings() {
        voiceSettingsOpened = VoiceDialog.openTtsSettings(requireContext())
        if (!voiceSettingsOpened) {
            voiceError = getString(R.string.onboarding_voice_settings_unavailable)
            renderVoice()
        }
    }

    /** Release builds always use the deployed server; only debug builds can point elsewhere. */
    private fun setUpAdvanced() {
        val b = binding
        b.settingsAdvanced.isVisible = BuildConfig.DEBUG
        if (!BuildConfig.DEBUG) return
        b.settingsServerOverride.setText(repository.serverOverride)
        b.settingsServerOverride.hint = BuildConfig.SERVER_URL
        b.settingsAdvancedHeader.setOnClickListener {
            val open = !b.settingsAdvancedBody.isVisible
            b.settingsAdvancedBody.isVisible = open
            b.settingsAdvancedChevron.setImageResource(if (open) R.drawable.ic_expand_less else R.drawable.ic_expand_more)
        }
        b.settingsResetServer.setOnClickListener {
            repository.serverOverride = ""
            b.settingsServerOverride.setText("")
            Toast.makeText(requireContext(), R.string.settings_server_reset, Toast.LENGTH_SHORT).show()
        }
        b.settingsSaveServer.setOnClickListener {
            repository.serverOverride = b.settingsServerOverride.text.toString()
            Toast.makeText(requireContext(), R.string.settings_saved, Toast.LENGTH_SHORT).show()
        }
    }
}
