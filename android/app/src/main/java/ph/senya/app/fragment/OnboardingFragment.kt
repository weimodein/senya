package ph.senya.app.fragment

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import ph.senya.app.R
import ph.senya.app.data.ModelRepository
import ph.senya.app.data.ModelUpdater
import ph.senya.app.databinding.FragmentOnboardingBinding
import ph.senya.app.ml.ModelBundle
import ph.senya.app.speech.Speaker
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class OnboardingFragment : Fragment() {
    private var _binding: FragmentOnboardingBinding? = null
    private val binding get() = _binding!!
    private var step = 0
    private var deniedOnce = false
    private var cameraSettingsOpened = false
    private var voiceSettingsOpened = false
    private var voiceError: String? = null
    private var voiceChecked = false
    private var modelLoaded = false
    private var modelChecked = false
    private var speaker: Speaker? = null
    private var modelExecutor: ExecutorService? = null
    private val prefs by lazy { requireContext().getSharedPreferences("senya", Context.MODE_PRIVATE) }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            if (step == 1) showStep(2) else finishOnboarding()
        } else {
            deniedOnce = true
            showCameraError()
        }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentOnboardingBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        if (prefs.getBoolean("onboarding_complete", false)) {
            view.visibility = View.INVISIBLE
            view.post {
                if (!isAdded) return@post
                val destination = if (PermissionsFragment.hasPermissions(requireContext()))
                    R.id.action_onboarding_to_camera else R.id.action_onboarding_to_permissions
                findNavController().navigate(destination)
            }
            return
        }

        step = savedInstanceState?.getInt("onboarding_step") ?: 0
        binding.onboardingBack.setOnClickListener { if (step > 0) showStep(step - 1) }
        binding.onboardingPrimary.setOnClickListener { primaryAction() }
        binding.onboardingSecondary.setOnClickListener { showStep(2) }
        binding.onboardingVoicePicker.setOnClickListener { chooseVoice() }
        binding.onboardingTestVoice.setOnClickListener { speaker?.speak(getString(R.string.onboarding_test_phrase)) }
        binding.onboardingVoiceSettings.setOnClickListener { openVoiceSettings() }
        showStep(step)
        createSpeaker()
        loadModel()
    }

    override fun onResume() {
        super.onResume()
        if (voiceSettingsOpened) {
            voiceSettingsOpened = false
            speaker?.shutdown()
            createSpeaker()
        }
        if (cameraSettingsOpened) {
            cameraSettingsOpened = false
            if (PermissionsFragment.hasPermissions(requireContext())) {
                if (step == 1) showStep(2) else finishOnboarding()
            } else {
                showCameraError()
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("onboarding_step", step)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroyView() {
        speaker?.shutdown()
        speaker = null
        modelExecutor?.shutdownNow()
        modelExecutor = null
        _binding = null
        super.onDestroyView()
    }

    private fun primaryAction() {
        when (step) {
            0 -> showStep(1)
            1 -> if (PermissionsFragment.hasPermissions(requireContext())) showStep(2) else requestCamera()
            2 -> showStep(3)
            3 -> if (PermissionsFragment.hasPermissions(requireContext())) finishOnboarding() else requestCamera()
        }
    }

    private fun showStep(next: Int) {
        step = next
        val pages = listOf(binding.onboardingWelcome, binding.onboardingCamera, binding.onboardingVoice, binding.onboardingReady)
        pages.forEachIndexed { index, page -> page.visibility = if (index == next) View.VISIBLE else View.GONE }
        binding.onboardingHeader.text = getString(listOf(
            R.string.app_name, R.string.onboarding_camera, R.string.onboarding_voice, R.string.onboarding_ready,
        )[next]).let { if (next == 0) it.uppercase() else it }
        binding.onboardingBack.visibility = if (next == 0) View.GONE else View.VISIBLE
        binding.onboardingSecondary.visibility = if (next == 1 && !PermissionsFragment.hasPermissions(requireContext()))
            View.VISIBLE else View.GONE
        binding.onboardingPrimary.setText(when (next) {
            0 -> R.string.onboarding_get_started
            1 -> if (PermissionsFragment.hasPermissions(requireContext())) R.string.onboarding_continue else R.string.allow_camera
            2 -> R.string.onboarding_continue
            else -> R.string.onboarding_start_signing
        })
        binding.onboardingDots.removeAllViews()
        repeat(4) { index ->
            val dot = View(requireContext())
            val size = (8 * resources.displayMetrics.density).toInt()
            val margin = (5 * resources.displayMetrics.density).toInt()
            dot.layoutParams = ViewGroup.MarginLayoutParams(size, size).apply { setMargins(margin, 0, margin, 0) }
            dot.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(if (index == next) 0xFF287DF2.toInt() else 0xFFD8DFEA.toInt())
            }
            binding.onboardingDots.addView(dot)
        }
        binding.onboardingScroll.scrollTo(0, 0)
        updateVoiceStatus()
    }

    private fun requestCamera() {
        if (deniedOnce && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            cameraSettingsOpened = true
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", requireContext().packageName, null)))
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun showCameraError() {
        val error = if (step == 1) binding.onboardingCameraError else binding.onboardingReadyError
        error.setText(R.string.onboarding_camera_required)
        error.visibility = View.VISIBLE
    }

    private fun createSpeaker() {
        voiceError = null
        voiceChecked = false
        speaker = Speaker(requireContext(), { message ->
            activity?.runOnUiThread {
                voiceError = message
                if (_binding != null) updateVoiceStatus()
            }
        }, {
            activity?.runOnUiThread {
                voiceChecked = true
                if (_binding != null) updateVoiceStatus()
            }
        })
        updateVoiceStatus()
    }

    private fun updateVoiceStatus() {
        val view = _binding ?: return
        val voice = speaker?.availableVoices()?.firstOrNull { it.name == speaker?.selectedVoiceName }
        view.onboardingVoicePicker.text = voice?.label ?: getString(if (voiceChecked)
            R.string.onboarding_voice_missing else R.string.onboarding_voice_loading)
        val ready = speaker?.isReady == true
        view.onboardingVoiceStatus.text = if (ready) getString(R.string.onboarding_voice_available)
            else voiceError ?: getString(if (voiceChecked) R.string.onboarding_voice_unavailable else R.string.onboarding_voice_loading)
        view.onboardingTestVoice.isEnabled = ready
        view.onboardingTestVoice.alpha = if (ready) 1f else 0.5f
        view.onboardingReadyVoiceStatus.text = getString(when {
            !voiceChecked -> R.string.onboarding_voice_checking
            ready -> R.string.onboarding_voice_ready
            else -> R.string.onboarding_voice_not_ready
        })
        updateReadyBody()
    }

    private fun chooseVoice() {
        val choices = speaker?.availableVoices().orEmpty()
        if (choices.isEmpty()) {
            openVoiceSettings()
            return
        }
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.onboarding_choose_voice)
            .setSingleChoiceItems(choices.map { it.label }.toTypedArray(),
                choices.indexOfFirst { it.name == speaker?.selectedVoiceName }) { dialog, which ->
                if (speaker?.selectVoice(choices[which].name) != true) {
                    Toast.makeText(requireContext(), R.string.onboarding_voice_select_failed, Toast.LENGTH_SHORT).show()
                }
                updateVoiceStatus()
                dialog.dismiss()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun openVoiceSettings() {
        voiceSettingsOpened = true
        try {
            startActivity(Intent("com.android.settings.TTS_SETTINGS"))
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            } catch (_: ActivityNotFoundException) {
                voiceSettingsOpened = false
                voiceError = getString(R.string.onboarding_voice_settings_unavailable)
                updateVoiceStatus()
            }
        }
    }

    private fun loadModel() {
        val repository = ModelRepository(requireContext().applicationContext)
        modelExecutor = Executors.newSingleThreadExecutor()
        modelExecutor?.execute {
            showModel(runCatching { repository.loadCurrent().bundle.use { it.summary() } })
            // A fresh install only has the demo model; fetch the published one now if we're online
            val update = runCatching { repository.checkForUpdate() }.getOrNull()
            if (update is ModelUpdater.Result.Updated) showModel(Result.success(update.bundle.use { it.summary() }))
        }
    }

    private data class ModelSummary(val version: Int, val letters: String)

    private fun ModelBundle.summary() =
        ModelSummary(version, (static.labels + motion?.labels.orEmpty()).joinToString(" "))

    private fun showModel(model: Result<ModelSummary>) {
        activity?.runOnUiThread {
            val view = _binding ?: return@runOnUiThread
            val summary = model.getOrNull()
            modelChecked = true
            modelLoaded = summary != null
            view.onboardingModelStatus.text = when {
                summary == null -> getString(R.string.onboarding_model_missing)
                summary.version == 0 -> getString(R.string.onboarding_model_demo)
                else -> getString(R.string.onboarding_model_loaded, summary.version, summary.letters)
            }
            view.onboardingDemoNote.visibility = if (summary?.version == 0) View.VISIBLE else View.GONE
            updateReadyBody()
        }
    }

    private fun updateReadyBody() {
        val view = _binding ?: return
        view.onboardingReadyTitle.setText(when {
            !modelChecked || !voiceChecked -> R.string.onboarding_ready_checking_title
            !modelLoaded -> R.string.onboarding_ready_no_model_title
            speaker?.isReady != true -> R.string.onboarding_ready_no_voice_title
            else -> R.string.onboarding_ready_title
        })
        view.onboardingReadyBody.setText(when {
            !modelChecked || !voiceChecked -> R.string.onboarding_ready_checking_body
            modelChecked && !modelLoaded -> R.string.onboarding_ready_no_model_body
            speaker?.isReady != true -> R.string.onboarding_ready_no_voice_body
            else -> R.string.onboarding_ready_body
        })
        if (step == 3) view.onboardingPrimary.setText(if (modelChecked && !modelLoaded)
            R.string.onboarding_open_camera else R.string.onboarding_start_signing)
    }

    private fun finishOnboarding() {
        prefs.edit().putBoolean("onboarding_complete", true).apply()
        findNavController().navigate(R.id.action_onboarding_to_camera)
    }
}
