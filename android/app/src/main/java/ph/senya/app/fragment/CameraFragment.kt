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

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.navigation.Navigation
import com.google.mediapipe.tasks.vision.core.RunningMode
import ph.senya.app.HandLandmarkerHelper
import ph.senya.app.R
import ph.senya.app.core.EngineModels
import ph.senya.app.core.FpsCounter
import ph.senya.app.core.Prediction
import ph.senya.app.core.StabilizerEvent
import ph.senya.app.core.Transcript
import ph.senya.app.core.TranslatorEngine
import ph.senya.app.data.ModelRepository
import ph.senya.app.data.ModelUpdater
import ph.senya.app.databinding.DialogSettingsBinding
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

class CameraFragment : Fragment(), HandLandmarkerHelper.LandmarkerListener {

    companion object {
        private const val TAG = "Senya"
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
    @Volatile private var modelLabel = ""
    /** While now < this, the chip keeps showing the motion letter just committed. */
    private var motionShownUntilMs = 0L
    private var speaker: Speaker? = null
    private lateinit var repository: ModelRepository
    private val trail = ArrayDeque<Pair<Float, Float>>()
    private var lastMovingMs = 0L

    override fun onResume() {
        super.onResume()
        // Make sure that all permissions are still present, since the
        // user could have removed them while the app was in paused state.
        if (!PermissionsFragment.hasPermissions(requireContext())) {
            Navigation.findNavController(requireActivity(), R.id.fragment_container)
                .navigate(R.id.action_camera_to_permissions)
        }
        // Start the HandLandmarkerHelper again when users come back to the foreground.
        backgroundExecutor.execute {
            if (handLandmarkerHelper.isClose()) handLandmarkerHelper.setupHandLandmarker()
        }
    }

    override fun onPause() {
        super.onPause()
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
        binding.viewFinder.post { setUpCamera() }
        backgroundExecutor.execute {
            handLandmarkerHelper = HandLandmarkerHelper(
                context = requireContext(),
                runningMode = RunningMode.LIVE_STREAM,
                maxNumHands = 1,
                currentDelegate = HandLandmarkerHelper.DELEGATE_CPU,
                handLandmarkerHelperListener = this
            )
        }
        binding.backspaceButton.setOnClickListener { transcript.backspace(); afterEdit() }
        binding.clearButton.setOnClickListener { transcript.clear(); afterEdit() }
        renderTranscript()
        showModelLabel(getString(R.string.no_model))
        repository = ModelRepository(requireContext())
        binding.settingsButton.setOnClickListener { showSettings() }
        binding.flipCameraButton.setOnClickListener { flipCamera() }
        modelExecutor.execute {
            loadCurrentModel()
            checkForUpdate(manual = false)
        }
        speaker = Speaker(requireContext()) { message -> toast(message) }
        binding.speakButton.isEnabled = true
        binding.speakButton.setOnClickListener { speaker?.speak(transcript.text) }
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

        imageAnalyzer = ImageAnalysis.Builder().setTargetAspectRatio(AspectRatio.RATIO_4_3)
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

    private fun detectHand(imageProxy: ImageProxy) {
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
            binding.handHint.visibility = if (landmarks == null) View.VISIBLE else View.GONE
            val now = result.timestampMs()
            if (out.motionGuess != null && out.events.isNotEmpty()) {
                motionShownUntilMs = now + 1000
                showGuess(out.motionGuess)
            } else if (now >= motionShownUntilMs) {
                showGuess(out.staticGuess)
            }
            if (out.events.isNotEmpty()) {
                out.events.forEach { transcript.apply(it) }
                renderTranscript()
                if (out.events.any { it is StabilizerEvent.Space } && repository.speakOnSpace) {
                    speaker?.speak(transcript.lastWord())
                }
            }
            binding.modelVersion.text = "$modelLabel · $currentFps fps"
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
    private fun checkForUpdate(manual: Boolean) {
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
            }
            is ModelUpdater.Result.UpToDate -> if (manual) toast("Model is up to date")
            is ModelUpdater.Result.NoModelPublished -> if (manual) toast("The server has no published model yet")
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

    private fun showSettings() {
        val dialogBinding = DialogSettingsBinding.inflate(layoutInflater)
        dialogBinding.serverUrl.setText(repository.serverUrl)
        dialogBinding.speakOnSpace.isChecked = repository.speakOnSpace
        fun save() {
            repository.serverUrl = dialogBinding.serverUrl.text.toString()
            repository.speakOnSpace = dialogBinding.speakOnSpace.isChecked
        }
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.settings)
            .setView(dialogBinding.root)
            .setPositiveButton(R.string.save) { _, _ -> save() }
            .setNeutralButton(R.string.check_for_update) { _, _ ->
                save()
                modelExecutor.execute { checkForUpdate(manual = true) }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** Swaps the models the engine uses. Runs on [modelExecutor]. */
    private fun applyBundle(newBundle: ModelBundle) {
        engine.setModels(EngineModels(newBundle.static, newBundle.motion, newBundle.motionConfig))
        bundle?.close()
        bundle = newBundle
        val kind = if (newBundle.motion == null) " · static only" else ""
        showModelLabel("Model v${newBundle.version}$kind")
        newBundle.warning?.let { toast(it) }
    }

    private fun showModelLabel(text: String) {
        modelLabel = text
        activity?.runOnUiThread { _binding?.modelVersion?.text = text }
    }

    private fun showGuess(guess: Prediction?) {
        binding.guessLabel.text = guess?.label ?: getString(R.string.no_guess)
        binding.guessConfidence.progress = ((guess?.confidence ?: 0f) * 100).toInt()
    }

    private fun afterEdit() {
        engine.onTranscriptEdited(transcript.isEmpty || transcript.endsWithSpace)
        renderTranscript()
    }

    private fun renderTranscript() {
        binding.transcript.text = transcript.text.ifEmpty { getString(R.string.transcript_placeholder) }
    }

    private fun toast(message: String) {
        activity?.runOnUiThread { context?.let { Toast.makeText(it, message, Toast.LENGTH_SHORT).show() } }
    }

    override fun onError(error: String, errorCode: Int) = toast(error)
}
