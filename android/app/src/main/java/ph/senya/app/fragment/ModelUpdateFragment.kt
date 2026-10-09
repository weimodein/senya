package ph.senya.app.fragment

import android.content.res.ColorStateList
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.core.view.isVisible
import androidx.core.widget.ImageViewCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import ph.senya.app.R
import ph.senya.app.data.ModelUpdater.Part
import ph.senya.app.data.UpdateScreenState
import ph.senya.app.databinding.FragmentModelUpdateBinding
import ph.senya.app.ml.ModelInfo

/** M3 mockup: checking, downloading, verifying, and every outcome of a model update. */
class ModelUpdateFragment : Fragment() {
    private var _binding: FragmentModelUpdateBinding? = null
    private val binding get() = _binding!!
    private val viewModel: ModelUpdateViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentModelUpdateBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.toolbar.toolbarTitle.setText(R.string.model_update)
        binding.toolbar.toolbarBack.setOnClickListener { leave() }
        viewModel.state.observe(viewLifecycleOwner) { render(it) }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    /** Back and Cancel stop a running check; the installed model stays (spec §5.2). System Back clears the ViewModel, which cancels too. */
    private fun leave() {
        viewModel.cancel()
        findNavController().popBackStack()
    }

    /** The camera screen reloads the installed model when its view is re-created. */
    private fun toCamera() {
        findNavController().popBackStack(R.id.camera_fragment, false)
    }

    private fun render(state: UpdateScreenState) {
        val b = binding
        val busy = state is UpdateScreenState.Checking || state is UpdateScreenState.Downloading ||
            state is UpdateScreenState.Verifying
        b.updateSpinner.isVisible = busy
        b.updateIcon.isVisible = !busy
        b.updateProgress.isVisible = state is UpdateScreenState.Downloading
        b.updateVerify.isVisible = state is UpdateScreenState.Verifying || state is UpdateScreenState.Updated ||
            state is UpdateScreenState.StaticOnly
        b.updateInfo.isVisible = true
        b.updateSecondary.isVisible = false
        showCurrent(state.current, staticOnly = state is UpdateScreenState.StaticOnly)
        when (state) {
            is UpdateScreenState.Checking -> {
                text(R.string.update_checking_title, getString(R.string.update_checking_body))
                info(getString(R.string.update_info_kept))
                primary(R.string.cancel) { leave() }
            }
            is UpdateScreenState.Downloading -> {
                b.updateTitle.text = getString(R.string.update_downloading_title, state.version)
                b.updateSubtitle.setText(R.string.update_downloading_body)
                b.updateStaticPercent.text = getString(R.string.percent, state.staticPercent)
                b.updateStaticBar.setProgressCompat(state.staticPercent, true)
                b.updateMotionGroup.isVisible = state.motionPercent != null
                state.motionPercent?.let {
                    b.updateMotionPercent.text = getString(R.string.percent, it)
                    b.updateMotionBar.setProgressCompat(it, true)
                }
                info(getString(R.string.update_info_downloading))
                primary(R.string.cancel) { leave() }
            }
            is UpdateScreenState.Verifying -> {
                text(R.string.update_verifying_title, getString(R.string.update_verifying_body))
                parts(state.static, state.motion, done = false)
                info(getString(R.string.update_info_verifying))
                primary(R.string.cancel) { leave() }
            }
            is UpdateScreenState.Updated -> {
                icon(R.drawable.ic_check_circle, R.color.senya_blue)
                text(R.string.update_updated_title, getString(R.string.update_updated_body, state.from, state.to))
                parts(Part.OK, if (state.current.hasMotion) Part.OK else null, done = true)
                b.updateInfo.isVisible = false
                primary(R.string.onboarding_start_signing) { toCamera() }
            }
            is UpdateScreenState.StaticOnly -> {
                icon(R.drawable.ic_warning, R.color.senya_warning)
                text(R.string.update_static_only_title, getString(R.string.update_static_only_body))
                parts(Part.OK, Part.FAILED, done = false)
                info(getString(R.string.update_info_static_only))
                primary(R.string.update_retry_motion) { viewModel.start(force = true) }
                secondary(R.string.update_continue_static_only) { toCamera() }
            }
            is UpdateScreenState.RolledBack -> {
                icon(R.drawable.ic_history, R.color.senya_blue)
                text(R.string.update_rolled_back_title, getString(R.string.update_rolled_back_body, state.from, state.to))
                info(getString(R.string.update_info_available, state.current.typeText))
                primary(R.string.update_continue_signing) { toCamera() }
            }
            is UpdateScreenState.UpToDate -> {
                icon(R.drawable.ic_check_circle, R.color.senya_blue)
                text(R.string.update_up_to_date_title, getString(R.string.update_up_to_date_body))
                b.updateInfo.isVisible = false
                primary(R.string.update_continue_signing) { toCamera() }
            }
            is UpdateScreenState.NoModelPublished -> {
                icon(R.drawable.ic_deployed_code, R.color.senya_muted)
                text(R.string.update_no_model_title, getString(R.string.update_no_model_body))
                info(getString(R.string.update_info_no_model))
                primary(R.string.update_check_again) { viewModel.start() }
                secondary(R.string.update_back_to_settings) { findNavController().popBackStack() }
            }
            is UpdateScreenState.Failed -> {
                icon(R.drawable.ic_error, R.color.senya_error)
                val reason = state.reason.replaceFirstChar { it.uppercase() }
                text(R.string.update_failed_title, getString(R.string.update_failed_body, reason))
                info(getString(R.string.update_info_kept))
                primary(R.string.update_try_again) { viewModel.start() }
                secondary(R.string.update_continue_signing) { toCamera() }
            }
            is UpdateScreenState.Cancelled -> Unit // the screen is already closing
        }
    }

    private fun text(@StringRes title: Int, subtitle: String) {
        binding.updateTitle.setText(title)
        binding.updateSubtitle.text = subtitle
    }

    private fun icon(@DrawableRes icon: Int, @ColorRes tint: Int) {
        binding.updateIcon.setImageResource(icon)
        ImageViewCompat.setImageTintList(binding.updateIcon, ColorStateList.valueOf(requireContext().getColor(tint)))
    }

    private fun info(text: String) {
        binding.updateInfoText.text = text
    }

    private fun primary(@StringRes label: Int, action: () -> Unit) {
        binding.updatePrimary.setText(label)
        binding.updatePrimary.setOnClickListener { action() }
    }

    private fun secondary(@StringRes label: Int, action: () -> Unit) {
        binding.updateSecondary.isVisible = true
        binding.updateSecondary.setText(label)
        binding.updateSecondary.setOnClickListener { action() }
    }

    private fun parts(static: Part, motion: Part?, done: Boolean) {
        val b = binding
        part(b.updateStaticIcon, b.updateStaticSpinner, b.updateStaticText, R.string.static_model, static, done)
        b.updateMotionRow.isVisible = motion != null
        if (motion != null) part(b.updateMotionIcon, b.updateMotionSpinner, b.updateMotionText, R.string.motion_model, motion, done)
    }

    private fun part(icon: ImageView, spinner: View, text: TextView, @StringRes name: Int, part: Part, done: Boolean) {
        val working = part == Part.PENDING || part == Part.CHECKING
        spinner.isVisible = working
        icon.isVisible = !working
        if (part == Part.OK) {
            icon.setImageResource(R.drawable.ic_check_circle)
            ImageViewCompat.setImageTintList(icon, ColorStateList.valueOf(requireContext().getColor(R.color.senya_blue)))
        } else if (part == Part.FAILED) {
            icon.setImageResource(R.drawable.ic_error)
            ImageViewCompat.setImageTintList(icon, ColorStateList.valueOf(requireContext().getColor(R.color.senya_warning)))
        }
        val status = when (part) {
            Part.PENDING -> R.string.part_waiting
            Part.CHECKING -> R.string.part_checking
            Part.OK -> if (done) R.string.part_ready else R.string.part_verified
            Part.FAILED -> R.string.part_unavailable
        }
        text.text = getString(R.string.part_status, getString(name), getString(status))
    }

    private fun showCurrent(info: ModelInfo?, staticOnly: Boolean) {
        binding.updateCurrentVersion.text = when {
            info == null -> getString(R.string.model_none)
            staticOnly -> getString(R.string.model_version_static_only, info.version)
            else -> getString(R.string.model_version, info.version)
        }
        binding.updateCurrentType.text = info?.typeText ?: getString(R.string.model_type_none)
    }
}
