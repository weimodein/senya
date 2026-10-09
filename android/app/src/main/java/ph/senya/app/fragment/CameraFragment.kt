/*
 * Copyright 2022 The TensorFlow Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *             http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package ph.senya.app.fragment

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.util.Size
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.camera.core.AspectRatio
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.core.widget.ImageViewCompat
import androidx.fragment.app.Fragment
import androidx.navigation.Navigation
import com.google.mediapipe.tasks.vision.core.RunningMode
import ph.senya.app.HandLandmarkerHelper
import ph.senya.app.R
import ph.senya.app.core.EngineModels
import ph.senya.app.core.FpsCounter
import ph.senya.app.core.StabilizerEvent
import ph.senya.app.core.StatusTracker
import ph.senya.app.core.Transcript
import ph.senya.app.core.TranslatorEngine
import ph.senya.app.core.TranslatorStatus
import ph.senya.app.core.WordSuggester
import ph.senya.app.data.ModelRepository
import ph.senya.app.data.ModelUpdater
import ph.senya.app.databinding.FragmentCameraBinding
import ph.senya.app.ml.AssetModelSource
import ph.senya.app.ml.Landmarks
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.TfliteModel
import ph.senya.app.speech.Speaker
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

class CameraFragment : Fragment(), HandLandmarkerHelper.LandmarkerListener {

    companion object {
        private const val TAG = "Senya"

        /** The automatic update check runs once per app start, not every time this screen's view is re-created. */
        private var autoUpdateChecked = false
    }

    private var _binding: FragmentCameraBinding? = null
    private val binding get() = _binding!!

    private lateinit var handLandmarkerHelper: HandLandmarkerHelper
    private var preview: Preview? = null
    private var imageAnalyzer: ImageAnalysis? = null
    private var camera: Camera? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var cameraFacing = CameraSelector.LENS_FACING_FRONT

    /** Blocking ML operations are performed using this executor */
    private lateinit var backgroundExecutor: ExecutorService

    /** Loads and swaps models, so model work never blocks camera frames. */
    private lateinit var modelExecutor: ExecutorService
    private val engine = TranslatorEngine(EngineModels(static = null))
    private val transcript = Transcript()
    /** Only touched on [modelExecutor]. */
    private var bundle: ModelBundle? = null
    private val fps = FpsCounter()
    private var speaker: Speaker? = null
    private lateinit var repository: ModelRepository
    private val trail = ArrayDeque<Pair<Float, Float>>()
    private var lastMovingMs = 0L
    private val statusTracker = StatusTracker()
    private lateinit var suggester: WordSuggester
    private var suggestions = emptyList<String>()
    private var cameraStarted = false
    private var deniedOnce = false
    private var caretOn = true

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else {
            deniedOnce = true
            showPermissionDenied()
        }
    }

    /** Blinks the transcript caret, as in the M2 mockup. */
    private val caretBlink = object : Runnable {
        override fun run() {
            caretOn = !caretOn
            renderTranscript()
            _binding?.transcript?.postDelayed(this, 530)
        }
    }

    override fun onResume() {
        super.onResume()
        // Back from the system settings screen with the permission granted
        if (!cameraStarted && CameraPermission.granted(requireContext())) startCamera()
        binding.transcript.removeCallbacks(caretBlink)
        binding.transcript.post(caretBlink)
        // Start the HandLandmarkerHelper again when users come back to the foreground.
        backgroundExecutor.execute {
            if (handLandmarkerHelper.isClose()) handLandmarkerHelper.setupHandLandmarker()
        }
    }

    override fun onPause() {
        super.onPause()
        _binding?.transcript?.removeCallbacks(caretBlink)
        if (this::handLandmarkerHelper.isInitialized) {
            backgroundExecutor.execute { handLandmarkerHelper.clearHandLandmarker() }
        }
    }

    override fun onDestroyView() {
        engine.setModels(EngineModels(static = null))
        modelExecutor.execute { bundle?.close(); bundle = null }
        modelExecutor.shutdown()
        speaker?.shutdown()
        speaker = null
        _binding = null
        super.onDestroyView()
        backgroundExecutor.shutdown()
        backgroundExecutor.awaitTermination(Long.MAX_VALUE, TimeUnit.NANOSECONDS)
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentCameraBinding.inflate(inflater, container, false)
        return binding.root
    }

    @SuppressLint("MissingPermission")
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        backgroundExecutor = Executors.newSingleThreadExecutor()
        modelExecutor = Executors.newSingleThreadExecutor()
        repository = ModelRepository(requireContext())
        if (CameraPermission.granted(requireContext())) startCamera() else showPermissionDenied()
        binding.grantPermission.setOnClickListener { requestCamera() }
        backgroundExecutor.execute {
            handLandmarkerHelper = HandLandmarkerHelper(
                context = requireContext(),
                runningMode = RunningMode.LIVE_STREAM,
                maxNumHands = 1,
                currentDelegate = HandLandmarkerHelper.DELEGATE_CPU,
                handLandmarkerHelperListener = this
            )
        }
        suggester = WordSuggester(requireContext().assets.open("words.txt").bufferedReader().use { it.readLines() })
        binding.backspaceButton.setOnClickListener { transcript.backspace(); afterEdit() }
        binding.clearButton.setOnClickListener { transcript.clear(); afterEdit() }
        listOf(binding.suggestion1, binding.suggestion2, binding.suggestion3).forEachIndexed { i, chip ->
            chip.setOnClickListener {
                val word = suggestions.getOrNull(i) ?: return@setOnClickListener
                transcript.completeWord(word)
                afterEdit()
                if (repository.speakOnSpace) speaker?.speak(word)
            }
        }
        onTranscriptChanged()
        renderStatus(TranslatorStatus.NoHand)
        showModelLabel(getString(R.string.no_model))
        binding.settingsButton.setOnClickListener {
            Navigation.findNavController(requireActivity(), R.id.fragment_container).navigate(R.id.action_camera_to_settings)
        }
        binding.flipCameraButton.setOnClickListener { flipCamera() }
        val autoCheck = !autoUpdateChecked
        autoUpdateChecked = true
        modelExecutor.execute {
            loadCurrentModel()
            if (autoCheck) checkForUpdate()
        }
        speaker = Speaker(requireContext(), onStatus = { message -> toast(message) })
        binding.speakButton.isEnabled = true
        binding.speakButton.setOnClickListener { speaker?.speak(transcript.text) }
    }

    private fun startCamera() {
        cameraStarted = true
        binding.permissionDenied.isVisible = false
        binding.flipCameraButton.isVisible = true
        binding.statusRow.isVisible = true
        binding.viewFinder.post { setUpCamera() }
    }

    /** Spec 5.4 and the M2 mockup: explain inline and offer to ask again. */
    private fun showPermissionDenied() {
        binding.permissionDenied.isVisible = true
        binding.flipCameraButton.isVisible = false
        binding.guessCard.isVisible = false
        binding.statusRow.isVisible = false
    }

    private fun requestCamera() {
        if (deniedOnce && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            // "Don't ask again": only the system settings screen can grant it now
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", requireContext().packageName, null)))
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    // Initialize CameraX, and prepare to bind the camera use cases
    private fun setUpCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(requireContext())
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            bindCameraUseCases()
        }, ContextCompat.getMainExecutor(requireContext()))
    }

    // Declare and bind preview and analysis use cases
    @SuppressLint("UnsafeOptInUsageError")
    private fun bindCameraUseCases() {
        val cameraProvider = cameraProvider ?: throw IllegalStateException("Camera initialization failed.")
        val cameraSelector = CameraSelector.Builder().requireLensFacing(cameraFacing).build()

        preview = Preview.Builder().setTargetAspectRatio(AspectRatio.RATIO_4_3)
            .setTargetRotation(binding.viewFinder.display.rotation)
            .build()

        // Small frames: MediaPipe resizes to ~200 px internally, and bigger frames only cost bitmap copies (speed target, spec 5.5)
        val analysisResolution = ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(ResolutionStrategy(Size(320, 240), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build()
        imageAnalyzer = ImageAnalysis.Builder().setResolutionSelector(analysisResolution)
            .setTargetRotation(binding.viewFinder.display.rotation)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
            .also { it.setAnalyzer(backgroundExecutor) { image -> detectHand(image) } }

        cameraProvider.unbindAll()
        try {
            camera = cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageAnalyzer)
            preview?.setSurfaceProvider(binding.viewFinder.surfaceProvider)
        } catch (exc: Exception) {
            Log.e(TAG, "Use case binding failed", exc)
        }
    }

    private var loggedSize = false

    private fun detectHand(imageProxy: ImageProxy) {
        if (!loggedSize) {
            loggedSize = true
            Log.d(TAG, "perf analysis frame ${imageProxy.width}x${imageProxy.height} rotation=${imageProxy.imageInfo.rotationDegrees}")
        }
        handLandmarkerHelper.detectLiveStream(
            imageProxy = imageProxy,
            isFrontCamera = cameraFacing == CameraSelector.LENS_FACING_FRONT
        )
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        imageAnalyzer?.targetRotation = binding.viewFinder.display.rotation
    }

    override fun onResults(resultBundle: HandLandmarkerHelper.ResultBundle) {
        val result = resultBundle.results.first()
        val landmarks = Landmarks.fromResult(result)
        val out = engine.onFrame(result.timestampMs(), landmarks)
        val currentFps = fps.tick(result.timestampMs())
        Log.d(TAG, "perf mediapipe=${resultBundle.inferenceTime}ms fps=$currentFps")
        activity?.runOnUiThread {
            if (_binding == null) return@runOnUiThread
            binding.overlay.setResults(
                result, resultBundle.inputImageHeight, resultBundle.inputImageWidth, RunningMode.LIVE_STREAM
            )
            if (out.moving && landmarks != null) {
                trail.addLast(landmarks[8 * 3] to landmarks[8 * 3 + 1]) // index fingertip
                while (trail.size > 60) trail.removeFirst()
                lastMovingMs = result.timestampMs()
            } else if (!out.moving && result.timestampMs() - lastMovingMs > 700) {
                trail.clear()
            }
            binding.overlay.setTrail(trail.toList())
            binding.overlay.invalidate()
            renderStatus(statusTracker.onFrame(result.timestampMs(), landmarks != null, out))
            if (out.events.isNotEmpty()) {
                out.events.forEach { transcript.apply(it) }
                onTranscriptChanged()
                if (out.events.any { it is StabilizerEvent.Space } && repository.speakOnSpace) {
                    speaker?.speak(transcript.lastWord())
                }
            }
        }
    }

    /** Downloaded model, else bundled (spec §5.4). Runs on [modelExecutor]. */
    private fun loadCurrentModel() {
        try {
            val loaded = repository.loadCurrent()
            applyBundle(loaded.bundle)
            loaded.message?.let { toast(it) }
        } catch (e: ModelLoadException) {
            Log.e(TAG, "Bundled model failed to load", e)
            toast("Bundled model failed: ${e.message}")
        } catch (e: Exception) {
            // Last line of defence: an uncaught exception on this thread would kill the app
            Log.e(TAG, "Model load crashed", e)
            toast("Model failed to load: ${e.message}")
        }
    }

    /** Runs on [modelExecutor]; on any failure the current model stays (spec §5.2). */
    private fun checkForUpdate() {
        val result = try {
            repository.checkForUpdate()
        } catch (e: Exception) {
            Log.e(TAG, "Update check crashed", e)
            toast("Update failed: ${e.message}. Keeping the current model.")
            return
        }
        when (result) {
            is ModelUpdater.Result.Updated -> {
                applyBundle(result.bundle)
                toast("Updated to model v${result.bundle.version}")
                result.motionError?.let { toast("J and Z are unavailable: $it") }
            }
            is ModelUpdater.Result.UpToDate -> {
                // Onboarding's check may have installed a newer version after this screen loaded the old one
                if (bundle?.version != repository.installedVersion) loadCurrentModel()
            }
            is ModelUpdater.Result.NoModelPublished -> {}
            is ModelUpdater.Result.Cancelled -> {}
            is ModelUpdater.Result.Failed -> toast("Update failed: ${result.message}. Keeping the current model.")
        }
    }

    /** Front camera for signing to yourself, back camera for pointing the phone at a signer. */
    private fun flipCamera() {
        val next = if (cameraFacing == CameraSelector.LENS_FACING_FRONT) CameraSelector.LENS_FACING_BACK
                   else CameraSelector.LENS_FACING_FRONT
        val provider = cameraProvider ?: return
        if (!provider.hasCamera(CameraSelector.Builder().requireLensFacing(next).build())) {
            toast("This phone has only one camera")
            return
        }
        cameraFacing = next
        trail.clear()
        bindCameraUseCases()
    }

    /** Swaps the models the engine uses. Runs on [modelExecutor]. */
    private fun applyBundle(newBundle: ModelBundle) {
        engine.setModels(EngineModels(newBundle.static, newBundle.motion, newBundle.motionConfig))
        bundle?.close()
        bundle = newBundle
        showModelLabel(getString(
            if (newBundle.motion == null) R.string.model_version_static_only else R.string.model_version,
            newBundle.version))
        newBundle.warning?.let { toast(it) }
    }

    private fun showModelLabel(text: String) {
        activity?.runOnUiThread { _binding?.modelVersion?.text = text }
    }

    private fun afterEdit() {
        engine.onTranscriptEdited(transcript.isEmpty || transcript.endsWithSpace)
        onTranscriptChanged()
    }

    private fun onTranscriptChanged() {
        renderTranscript()
        suggestions = suggester.suggest(transcript.text)
        listOf(binding.suggestion1, binding.suggestion2, binding.suggestion3).forEachIndexed { i, chip ->
            val word = suggestions.getOrNull(i)
            chip.visibility = if (word == null) View.INVISIBLE else View.VISIBLE
            chip.text = word
            chip.isSelected = i == 0
        }
    }

    /** The text plus a blinking caret; empty shows the hint instead. */
    private fun renderTranscript() {
        val b = _binding ?: return
        val text = transcript.text
        if (text.isEmpty()) {
            b.transcript.text = ""
            return
        }
        val caretColor = if (caretOn) requireContext().getColor(R.color.senya_blue) else Color.TRANSPARENT
        b.transcript.text = SpannableStringBuilder(text).apply {
            val start = length
            append("|")
            setSpan(ForegroundColorSpan(caretColor), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    private fun renderStatus(status: TranslatorStatus) {
        val b = binding
        val recording = status is TranslatorStatus.Recording
        b.guessCard.isVisible = status !is TranslatorStatus.NoHand
        b.guessSpinner.isVisible = recording
        b.guessLabel.isVisible = !recording
        b.guessPercent.isVisible = !recording
        b.guessConfidence.isVisible = !recording
        b.statusSpinner.isVisible = recording
        b.statusIcon.isVisible = !recording
        when (status) {
            is TranslatorStatus.NoHand -> hint(R.drawable.ic_back_hand, R.color.senya_ink, getString(R.string.hand_hint))
            is TranslatorStatus.Holding -> {
                guess(status.label, status.confidence, R.string.guess_hold)
                hint(R.drawable.ic_back_hand, R.color.senya_ink, getString(R.string.status_hold_steady))
            }
            is TranslatorStatus.Unsure -> {
                guess("?", status.confidence, R.string.guess_not_added)
                hint(R.drawable.ic_warning, R.color.senya_warning, getString(R.string.status_not_sure))
            }
            is TranslatorStatus.Recording -> {
                b.guessCaption.setText(R.string.guess_recording)
                b.handHint.setText(R.string.status_finish_movement)
            }
            is TranslatorStatus.AddedMotion -> {
                guess(status.label, status.confidence, R.string.guess_added)
                hint(R.drawable.ic_check_circle, R.color.senya_blue, getString(R.string.status_added, status.label))
            }
        }
    }

    private fun guess(label: String, confidence: Float, caption: Int) {
        val percent = (confidence * 100).roundToInt().coerceIn(0, 100)
        binding.guessLabel.text = label
        binding.guessPercent.text = getString(R.string.percent, percent)
        binding.guessConfidence.progress = percent
        binding.guessCaption.setText(caption)
    }

    private fun hint(@DrawableRes icon: Int, @ColorRes tint: Int, text: String) {
        binding.statusIcon.setImageResource(icon)
        ImageViewCompat.setImageTintList(binding.statusIcon, ColorStateList.valueOf(requireContext().getColor(tint)))
        binding.handHint.text = text
    }

    private fun toast(message: String) {
        activity?.runOnUiThread { context?.let { Toast.makeText(it, message, Toast.LENGTH_SHORT).show() } }
    }

    override fun onError(error: String, errorCode: Int) = toast(error)
}
