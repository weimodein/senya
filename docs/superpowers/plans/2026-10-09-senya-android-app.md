# Senya Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Person A's half of Senya: an Android app that turns FSL fingerspelling (static letters plus the motion letters J and Z) into text and speech, fully offline, and picks up new models from the platform.

**Architecture:** Each camera frame goes through MediaPipe and is flattened to 63 raw floats. A pure-Kotlin `TranslatorEngine` runs it through the static classifier and the `MotionSegmenter`. When a segment ends, the motion classifier runs once, and the `PredictionStabilizer` decides what gets committed to the `Transcript`. Everything that holds logic (stabilizer, segmenter, engine, model loading, model updater, voice choice) is plain Kotlin/JVM and unit-tested with fakes. The Android layer (fragment, TFLite, TTS, SharedPreferences) stays thin.

**Tech Stack:** Kotlin 1.7.10, AGP (as in the sample), Gradle 8.14.3, CameraX 1.4.2, MediaPipe Tasks Vision (`com.google.mediapipe:tasks-vision:1.0.0`, LIVE_STREAM, 1 hand), TensorFlow Lite Interpreter, Android `TextToSpeech`, `org.json`, JUnit 4.

**Spec:** `docs/2026-10-09-senya-design.md` (§3 contract, §5 Android app, §6 testing, §7.2 Person A column). The A↔B contract is `CONTRACT.md`.

## Global Constraints

- Person A edits only `android/` and `README.md` (spec §2.1). Never edit `platform/`, `fixtures/`, `CONTRACT.md`, or `docs/2026-10-09-senya-design.md`.
- minSdk 24. MediaPipe Hand Landmarker in LIVE_STREAM mode, 1 hand, **normalized image landmarks**.
- Landmarks: 21 points × (x, y, z), flattened in point order to **63 raw floats** `[x0, y0, z0, x1, y1, z1, …]`. No normalization in Kotlin; it's inside the models.
- Static model: `model.tflite`, input `float32[1, 63]`, output `float32[1, N]`; `labels.json` index `i` = output `i`.
- Motion model: `motion.tflite`, input `float32[1, 32, 63]`, output `float32[1, M]`; `motion_labels.json`; label `_none` is never committed.
- `motion_config.json` defaults: `{"T": 32, "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200, "pad_ms": 150, "min_ms": 300, "max_ms": 2500, "max_missing": 0.25, "min_confidence": 0.7, "replace_window_ms": 1000, "start_shapes": {"J": ["I"], "Z": []}}`.
- Stabilizer: ignore confidence < **0.7**; commit when top label in **8 of the last 10** frames; same label again only after a different commit or no hand; **space after ~1 s** with no hand, once per gap, never first, never after another space.
- Model files: bundled model in `assets/model/` is **version 0**; downloads go to `filesDir/models/v{n}/`; the version is saved in SharedPreferences; `GET /api/model/latest` decides; sha256 is checked; on any failure keep the current model and show a toast.
- TTS: prefer `fil-PH`, fall back to English; only voices with `isNetworkConnectionRequired == false`.
- `network_security_config` allows cleartext HTTP.
- Performance: ≥ 15 fps end-to-end on the demo phone.
- Keep the Apache license header at the top of every file that came from the MediaPipe sample. New files don't need one.
- Kotlin 1.7.10: don't use `data object`, `entries`, or `List.removeLast()`/`removeFirst()` on `MutableList` (use `removeAt`). `ArrayDeque.removeFirst()` from `kotlin.collections` is fine.
- Commands run from `android/` in Git Bash with `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`. `adb` is at `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb"`.
- Commit at the end of every task, then `git pull --rebase && git push` (spec §2.1). Commits made by Claude end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Contract clarifications to raise with Person B in hour 0

`CONTRACT.md` §3 item 7 leaves a few details open. This plan implements the answers below; agree them with B (B edits `CONTRACT.md`) so the Python and Kotlin segmenters match:

1. **Speed:** a frame has a speed only if it has a hand **and** the immediately previous frame had a hand, the time step is > 0, and the hand size is > 0. **Smoothed speed** = mean of the last up-to-3 speed values; the history is cleared on every no-hand frame.
2. **Start time** = timestamp of the first frame whose smoothed speed > `start_speed`.
3. **End time:**
   - Normally, the timestamp of the first frame in a run of frames below `stop_speed`, once that run has lasted ≥ `stop_hold_ms`. Frames with no speed value neither extend nor break the run.
   - If no hand is seen for more than `stop_hold_ms`, the timestamp of the last frame with a hand.
4. **Segment:**
   - Frames: all frames with `start − pad_ms ≤ t ≤ end`.
   - Length: `end − (start − pad_ms)`.
   - Missing fraction: no-hand frames ÷ all frames in the range.
   - Resampling uses `t_k = (start − pad_ms) + k·(end − (start − pad_ms))/31` and clamps to the first or last hand frame at the edges.
5. **`fixtures/segmenter_case.json` shape:** `{"config": {…motion_config keys…}, "stream": [{"t_ms": int, "landmarks": [63] | null}], "expected_segments": [{"start_ms": int, "end_ms": int, "frames": [[63] × 32]}]}`, where `start_ms = start − pad_ms`.
6. **Golden files** are fetched from the same folder as `model_url` / `motion.model_url`, because `latest` has no golden URLs.
7. **Versions** published by the platform start at 1. Version 0 is the app's bundled model.
8. **Front camera mirroring:** the app mirrors front-camera frames before MediaPipe (sample behavior), so keep mirror augmentation on for both models.

## Review Focus

1. **Model swap while frames are flowing:** an update or rollback can land mid-sign. Expect no crash, no letter committed from half-old and half-new state, and the stabilizer and segmenter start fresh. (Test: Task 4 `swappingModelsResetsState`.)
2. **A broken published version** (label count ≠ outputs, missing or failing golden file, motion files present but broken) is rejected with a readable message and the current model keeps running. A broken motion part degrades to static-only. (Tests: Task 2 `ModelBundleTest`, Task 9 `rejectsVersionThatFailsGolden`.)
3. **Server unreachable, wrong URL, 404, checksum mismatch, or failed download:** keep the current model, show a toast, and leave no temp folders behind. (Tests: Task 9 `ModelUpdaterTest`.)
4. **Hand leaves the frame mid-motion, or tracking drops frames:** the segment ends cleanly, or is discarded when too many frames are missing. Never crash on odd timestamps. (Tests: Task 6 `handLostEndsSegmentAtLastHandFrame`, `tooManyMissingFramesDiscarded`, `nonIncreasingTimestampsDoNotCrash`.)
5. **Backspace or Clear between commits:** no leading space after Clear, and the same letter can be signed again right after Backspace. (Tests: Task 3 `syncAfterClearPreventsLeadingSpaceAndAllowsSameLetter`, Task 4 `transcriptEditResetsStabilizer`.)

## Schedule mapping (spec §7.2, Person A column)

| Spec slot | Tasks |
|---|---|
| 0:30–1:30 | Task 1 |
| 1:30–2:30 | Task 2 (+ bundle dummy model when `fixtures/mock_server/` lands at ~1:00) |
| 3:00–4:00 | Tasks 3, 4, 5 |
| 4:00–5:00 | Task 6, start of Task 7 |
| 5:00–6:00 | Task 7, Task 8, bundle v2 (Task 11 Step 1) |
| 6:00–7:00 | Task 9, Task 10 |
| 7:45–8:00 | Task 11 |

Handoff from B that this plan does **not** wait for: `fixtures/mock_server/` (Task 2 Step 8, Task 9 Step 9), `fixtures/segmenter_case.json` (Task 6 fixture test skips until it exists), real v1/v2 (Task 11 Step 1).

## File map (all under `android/app/src/`)

| File | Responsibility |
|---|---|
| `main/java/ph/senya/app/MainActivity.kt` | Hosts the nav graph (from sample, trimmed) |
| `main/java/ph/senya/app/HandLandmarkerHelper.kt` | MediaPipe wrapper (from sample, unchanged except package) |
| `main/java/ph/senya/app/OverlayView.kt` | Landmark overlay + fingertip trail |
| `main/java/ph/senya/app/fragment/PermissionsFragment.kt` | Camera permission, explanation + retry |
| `main/java/ph/senya/app/fragment/CameraFragment.kt` | The single translator screen: camera, engine wiring, UI, settings |
| `main/java/ph/senya/app/core/Hand.kt` | Shape constants (21, 63, 32) |
| `main/java/ph/senya/app/core/Prediction.kt` | `Prediction`, classifier interfaces, `predictionOf` |
| `main/java/ph/senya/app/core/MotionConfig.kt` | `motion_config.json` values |
| `main/java/ph/senya/app/core/StabilizerEvent.kt` | `Letter` / `Space` / `ReplaceLast` |
| `main/java/ph/senya/app/core/Transcript.kt` | Committed tokens, backspace, clear |
| `main/java/ph/senya/app/core/PredictionStabilizer.kt` | Static + motion commit rules |
| `main/java/ph/senya/app/core/MotionSegmenter.kt` | Contract §3 item 7 segmentation + resampling |
| `main/java/ph/senya/app/core/TranslatorEngine.kt` | Per-frame pipeline, model swapping |
| `main/java/ph/senya/app/core/FpsCounter.kt` | Frames per second for the status line |
| `main/java/ph/senya/app/core/VoicePicker.kt` | Chooses the offline TTS voice |
| `main/java/ph/senya/app/ml/Landmarks.kt` | `HandLandmarkerResult` → 63 floats |
| `main/java/ph/senya/app/ml/ProbabilityModel.kt` | Model interface + `TfliteModel` |
| `main/java/ph/senya/app/ml/ModelSource.kt` | File names, `DirModelSource`, `AssetModelSource` |
| `main/java/ph/senya/app/ml/ModelJson.kt` | Parse labels, golden files, motion config |
| `main/java/ph/senya/app/ml/Classifiers.kt` | `SignClassifier`, `MotionClassifier` |
| `main/java/ph/senya/app/ml/ModelBundle.kt` | Load + golden-check a model folder |
| `main/java/ph/senya/app/data/LatestModel.kt` | Parse `GET /api/model/latest` |
| `main/java/ph/senya/app/data/ModelUpdater.kt` | Download, verify, install (pure JVM) |
| `main/java/ph/senya/app/data/ModelRepository.kt` | SharedPreferences + updater + bundled fallback |
| `main/java/ph/senya/app/speech/Speaker.kt` | Android `TextToSpeech` |
| `test/java/ph/senya/app/...` | JVM unit tests and `testutil/` fakes |
| `android/tools/fetch_bundled_model.py` | Copies the current published model into `assets/model/` |

---

### Task 1: Clean slate, package rename, landmark readout

Turns the MediaPipe sample into a Senya skeleton: one camera screen with the landmark overlay that logs the 63 floats and timestamp per frame.

**Files:**
- Move: `main/java/com/google/mediapipe/examples/handlandmarker/**` → `main/java/ph/senya/app/**`
- Delete: `androidTest/`, `GalleryFragment.kt`, `MainViewModel.kt`, `res/layout/fragment_gallery.xml`, `res/layout/info_bottom_sheet.xml`, `res/menu/`, `res/color/`, unused drawables
- Modify: `android/app/build.gradle`, `res/layout/activity_main.xml`, `res/layout/fragment_camera.xml`, `res/navigation/nav_graph.xml`, `MainActivity.kt`, `fragment/CameraFragment.kt`
- Create: `main/java/ph/senya/app/core/Hand.kt`, `main/java/ph/senya/app/ml/Landmarks.kt`, `test/java/ph/senya/app/core/HandTest.kt`

**Interfaces:**
- Produces: package `ph.senya.app`; `Hand.POINTS = 21`, `Hand.FLOATS = 63`, `Hand.FRAMES = 32`; `Landmarks.fromResult(result: HandLandmarkerResult): FloatArray?`; `CameraFragment.onResults` has `result.timestampMs()` and the 63 floats available; `fragment_camera.xml` ids `view_finder`, `overlay`.

- [ ] **Step 1: Move the sources to the Senya package**

```bash
mkdir -p app/src/main/java/ph/senya
git mv app/src/main/java/com/google/mediapipe/examples/handlandmarker app/src/main/java/ph/senya/app
find app/src/main/java/com -type d -empty -delete
grep -rl 'com.google.mediapipe.examples.handlandmarker' app/src | xargs sed -i 's/com\.google\.mediapipe\.examples\.handlandmarker/ph.senya.app/g'
grep -rn 'examples.handlandmarker' app/ || echo "no old package references left"
```

- [ ] **Step 2: Delete the sample UI that Senya doesn't use**

```bash
git rm -rq app/src/androidTest \
  app/src/main/java/ph/senya/app/fragment/GalleryFragment.kt \
  app/src/main/java/ph/senya/app/MainViewModel.kt \
  app/src/main/res/layout/fragment_gallery.xml \
  app/src/main/res/layout/info_bottom_sheet.xml \
  app/src/main/res/menu app/src/main/res/color \
  app/src/main/res/drawable/media_pipe_banner.xml \
  app/src/main/res/drawable/ic_baseline_add_24.xml \
  app/src/main/res/drawable/ic_baseline_photo_library_24.xml \
  app/src/main/res/drawable/ic_minus.xml app/src/main/res/drawable/ic_plus.xml \
  app/src/main/res/drawable/icn_chevron_up.png
```

- [ ] **Step 3: Update `app/build.gradle`**

Change `namespace 'com.google.mediapipe.examples.handlandmarker'` to:

```groovy
    namespace 'ph.senya.app'
```

Inside `android { … }`, after `buildFeatures { viewBinding true }`, add:

```groovy
    testOptions {
        unitTests.all {
            // Shared fixtures from Person B (spec §2.1); tests skip when a file isn't there yet
            systemProperty 'senya.fixtures', rootProject.file('../fixtures').absolutePath
        }
    }
```

In `dependencies { … }`, after `implementation 'com.google.mediapipe:tasks-vision:1.0.0'`, add:

```groovy
    // TensorFlow Lite for Senya's own classifiers
    implementation 'org.tensorflow:tensorflow-lite:2.16.1'

    // Real org.json for JVM unit tests (android.jar only has stubs)
    testImplementation 'org.json:json:20240303'
```

- [ ] **Step 4: Replace `res/layout/activity_main.xml`** (keep the license comment block at the top)

```xml
<androidx.fragment.app.FragmentContainerView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:id="@+id/fragment_container"
    android:name="androidx.navigation.fragment.NavHostFragment"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:keepScreenOn="true"
    app:defaultNavHost="true"
    app:navGraph="@navigation/nav_graph"
    tools:context=".MainActivity" />
```

- [ ] **Step 5: Replace the body of `MainActivity.kt`** (keep the license header)

```kotlin
package ph.senya.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import ph.senya.app.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(ActivityMainBinding.inflate(layoutInflater).root)
    }
}
```

- [ ] **Step 6: Remove the gallery destination from `res/navigation/nav_graph.xml`**

Delete this block:

```xml
    <fragment
        android:id="@+id/gallery_fragment"
        android:name="ph.senya.app.fragment.GalleryFragment"
        android:label="GalleryFragment" />
```

- [ ] **Step 7: Replace `res/layout/fragment_camera.xml`** (keep the license comment; Task 5 replaces this again with the full screen)

```xml
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/camera_container"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@android:color/black">

    <androidx.camera.view.PreviewView
        android:id="@+id/view_finder"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        app:scaleType="fillStart" />

    <ph.senya.app.OverlayView
        android:id="@+id/overlay"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
</FrameLayout>
```

- [ ] **Step 8: Write the failing test for the shape constants**

`test/java/ph/senya/app/core/HandTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class HandTest {
    @Test
    fun shapesMatchContract() {
        assertEquals(21, Hand.POINTS)
        assertEquals(63, Hand.FLOATS)
        assertEquals(32, Hand.FRAMES)
    }
}
```

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.HandTest"`
Expected: FAIL to compile (`Unresolved reference: Hand`). Compilation also fails on `CameraFragment` until Step 10, which is fine.

- [ ] **Step 9: Create `core/Hand.kt` and `ml/Landmarks.kt`**

`main/java/ph/senya/app/core/Hand.kt`:

```kotlin
package ph.senya.app.core

/** Tensor shapes from the A↔B contract (CONTRACT.md §3). */
object Hand {
    const val POINTS = 21
    const val FLOATS = POINTS * 3
    const val FRAMES = 32
}
```

`main/java/ph/senya/app/ml/Landmarks.kt`:

```kotlin
package ph.senya.app.ml

import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import ph.senya.app.core.Hand

object Landmarks {
    /** Flattens the first hand to [x0, y0, z0, x1, …] (contract §3 item 1), or null when no hand is seen. */
    fun fromResult(result: HandLandmarkerResult): FloatArray? {
        val hand = result.landmarks().firstOrNull() ?: return null
        if (hand.size != Hand.POINTS) return null
        val out = FloatArray(Hand.FLOATS)
        hand.forEachIndexed { i, p ->
            out[i * 3] = p.x()
            out[i * 3 + 1] = p.y()
            out[i * 3 + 2] = p.z()
        }
        return out
    }
}
```

- [ ] **Step 10: Replace the body of `fragment/CameraFragment.kt`** (keep the license header)

```kotlin
package ph.senya.app.fragment

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
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
import ph.senya.app.databinding.FragmentCameraBinding
import ph.senya.app.ml.Landmarks
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
        Log.d(TAG, "frame t=${result.timestampMs()} hand=${landmarks != null} " +
            (landmarks?.take(6)?.joinToString(",") ?: ""))
        activity?.runOnUiThread {
            if (_binding == null) return@runOnUiThread
            binding.overlay.setResults(
                result, resultBundle.inputImageHeight, resultBundle.inputImageWidth, RunningMode.LIVE_STREAM
            )
            binding.overlay.invalidate()
        }
    }

    override fun onError(error: String, errorCode: Int) {
        activity?.runOnUiThread { Toast.makeText(requireContext(), error, Toast.LENGTH_SHORT).show() }
    }
}
```

- [ ] **Step 11: Build and run the unit test**

Run: `./gradlew assembleDebug testDebugUnitTest --tests "ph.senya.app.core.HandTest"`
Expected: `BUILD SUCCESSFUL`, `HandTest` passes.
If the build fails with duplicate `org.tensorflow.lite` classes, replace the TFLite line with `implementation 'com.google.ai.edge.litert:litert:1.0.1'` (same `org.tensorflow.lite.Interpreter` API) and rebuild.

- [ ] **Step 12: Check on the phone**

Run: `./gradlew installDebug`, open Senya, grant the camera, and show a hand. Then:
`"$LOCALAPPDATA/Android/Sdk/platform-tools/adb" logcat -s Senya`
Expected: the camera preview with landmarks drawn; log lines like `frame t=123456 hand=true 0.41,0.62,-0.0,…` with increasing `t`, and `hand=false` when the hand is out of view.

- [ ] **Step 13: Commit**

```bash
git add -A app/
git commit -m "Android: strip sample UI, rename to ph.senya.app, read out landmarks"
git pull --rebase && git push
```

---

### Task 2: Model loading, classifiers, golden check

Loads a model folder (bundled assets or a download) in the contract's file layout. It checks label counts and tensor shapes, runs the golden files, and exposes `SignClassifier` / `MotionClassifier`. All of it is tested on the JVM with fake models.

**Files:**
- Create: `main/java/ph/senya/app/core/Prediction.kt`, `core/MotionConfig.kt`, `ml/ProbabilityModel.kt`, `ml/ModelSource.kt`, `ml/ModelJson.kt`, `ml/Classifiers.kt`, `ml/ModelBundle.kt`
- Create: `test/java/ph/senya/app/testutil/TestModels.kt`, `test/java/ph/senya/app/ml/ModelBundleTest.kt`
- Create: `android/tools/fetch_bundled_model.py`

**Interfaces:**
- Consumes: `Hand.FLOATS`, `Hand.FRAMES` (Task 1).
- Produces:
  - `data class Prediction(val label: String, val confidence: Float)`
  - `fun predictionOf(probabilities: FloatArray, labels: List<String>): Prediction`
  - `fun interface StaticClassifier { fun classify(landmarks: FloatArray): Prediction }`
  - `fun interface SequenceClassifier { fun classify(frames: Array<FloatArray>): Prediction }`
  - `const val NONE_LABEL = "_none"`
  - `data class MotionConfig(t, startSpeed, stopSpeed, stopHoldMs, padMs, minMs, maxMs, maxMissing, minConfidence, replaceWindowMs, startShapes)` with the contract defaults
  - `interface ProbabilityModel : Closeable { val inputShape: IntArray; val outputSize: Int; fun predict(input: Any): FloatArray }`
  - `class TfliteModel` with `TfliteModel.fromBytes(bytes: ByteArray): ProbabilityModel`
  - `interface ModelSource { fun read(name: String): ByteArray? }`; `DirModelSource(dir: File)`; `AssetModelSource(assets, folder = "model")`
  - `object ModelFiles { MODEL, LABELS, GOLDEN, MOTION_MODEL, MOTION_LABELS, MOTION_CONFIG, MOTION_GOLDEN }`
  - `class SignClassifier(model, labels) : StaticClassifier, Closeable`; `class MotionClassifier(model, labels) : SequenceClassifier, Closeable`
  - `class ModelBundle { version: Int; static: SignClassifier; motion: MotionClassifier?; motionConfig: MotionConfig; warning: String?; close() }`
  - `ModelBundle.load(version: Int, source: ModelSource, modelFactory: (ByteArray) -> ProbabilityModel): ModelBundle`, which throws `ModelLoadException(message)`
  - `ModelJson.parseMotionConfig(bytes: ByteArray): MotionConfig` (used by Task 6's fixture test)

- [ ] **Step 1: Write the test helpers**

`test/java/ph/senya/app/testutil/TestModels.kt`:

```kotlin
package ph.senya.app.testutil

import org.json.JSONArray
import org.json.JSONObject
import ph.senya.app.core.Hand
import ph.senya.app.ml.ModelFiles
import ph.senya.app.ml.ProbabilityModel
import java.io.File

/** A model whose output is computed by [fn]; records whether it was closed. */
class FakeModel(
    override val inputShape: IntArray,
    override val outputSize: Int,
    private val fn: (Any) -> FloatArray,
) : ProbabilityModel {
    var closed = false
    override fun predict(input: Any): FloatArray = fn(input)
    override fun close() { closed = true }
}

object TestModels {
    /** Static fake over ["A", "B"]: predicts B (0.9) when landmarks[0] > 0.5, else A (0.8). */
    fun staticAB() = FakeModel(intArrayOf(1, Hand.FLOATS), 2) { input ->
        @Suppress("UNCHECKED_CAST")
        val x = (input as Array<FloatArray>)[0][0]
        if (x > 0.5f) floatArrayOf(0.1f, 0.9f) else floatArrayOf(0.8f, 0.2f)
    }

    /** Motion fake over ["_none", "J", "Z"]: J (0.9) when x0 grows from first to last frame, else _none. */
    fun motionNoneJZ() = FakeModel(intArrayOf(1, Hand.FRAMES, Hand.FLOATS), 3) { input ->
        @Suppress("UNCHECKED_CAST")
        val frames = (input as Array<Array<FloatArray>>)[0]
        if (frames.last()[0] > frames.first()[0]) floatArrayOf(0.05f, 0.9f, 0.05f)
        else floatArrayOf(0.9f, 0.05f, 0.05f)
    }

    /** Model factory that picks a fake by the model file's text: "static" or "motion". */
    val factory: (ByteArray) -> ProbabilityModel = { bytes ->
        when (String(bytes)) {
            "static" -> staticAB()
            "motion" -> motionNoneJZ()
            else -> throw IllegalArgumentException("not a model")
        }
    }

    fun landmarks(x0: Float) = FloatArray(Hand.FLOATS).also { it[0] = x0 }

    fun frames(fromX: Float, toX: Float) =
        Array(Hand.FRAMES) { k -> FloatArray(Hand.FLOATS).also { it[0] = fromX + (toX - fromX) * k / (Hand.FRAMES - 1) } }

    fun staticGolden(samples: List<Pair<Float, String>> = listOf(0.1f to "A", 0.9f to "B")): String =
        JSONArray(samples.map { (x, label) ->
            JSONObject().put("landmarks", floats(landmarks(x))).put("label", label)
        }).toString()

    fun motionGolden(samples: List<Pair<Array<FloatArray>, String>> =
                         listOf(frames(0.2f, 0.8f) to "J", frames(0.5f, 0.5f) to "_none")): String =
        JSONArray(samples.map { (f, label) ->
            JSONObject().put("frames", JSONArray(f.map { floats(it) })).put("label", label)
        }).toString()

    const val MOTION_CONFIG = """{"T": 32, "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200,
        "pad_ms": 150, "min_ms": 300, "max_ms": 2500, "max_missing": 0.25, "min_confidence": 0.7,
        "replace_window_ms": 1000, "start_shapes": {"J": ["I"], "Z": []}}"""

    /** Writes a model folder with the contract's file names and returns it. */
    fun writeFolder(
        dir: File,
        withMotion: Boolean = true,
        labels: String = """["A","B"]""",
        golden: String = staticGolden(),
        motionLabels: String = """["_none","J","Z"]""",
        motionGolden: String = motionGolden(),
        motionConfig: String = MOTION_CONFIG,
    ): File {
        dir.mkdirs()
        File(dir, ModelFiles.MODEL).writeText("static")
        File(dir, ModelFiles.LABELS).writeText(labels)
        File(dir, ModelFiles.GOLDEN).writeText(golden)
        if (withMotion) {
            File(dir, ModelFiles.MOTION_MODEL).writeText("motion")
            File(dir, ModelFiles.MOTION_LABELS).writeText(motionLabels)
            File(dir, ModelFiles.MOTION_GOLDEN).writeText(motionGolden)
            File(dir, ModelFiles.MOTION_CONFIG).writeText(motionConfig)
        }
        return dir
    }

    private fun floats(values: FloatArray) = JSONArray(values.map { it.toDouble() })
}
```

- [ ] **Step 2: Write the failing tests**

`test/java/ph/senya/app/ml/ModelBundleTest.kt`:

```kotlin
package ph.senya.app.ml

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.core.Prediction
import ph.senya.app.testutil.TestModels
import java.io.File

class ModelBundleTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun load(dir: File, version: Int = 1) = ModelBundle.load(version, DirModelSource(dir), TestModels.factory)

    private fun assertRejected(dir: File, messagePart: String) {
        try {
            load(dir)
            fail("expected ModelLoadException")
        } catch (e: ModelLoadException) {
            assertTrue("message was: ${e.message}", e.message!!.contains(messagePart))
        }
    }

    @Test
    fun loadsStaticAndMotion() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder()), version = 3)
        assertEquals(3, bundle.version)
        assertEquals(Prediction("B", 0.9f), bundle.static.classify(TestModels.landmarks(0.9f)))
        assertEquals("J", bundle.motion!!.classify(TestModels.frames(0.1f, 0.7f)).label)
        assertEquals(listOf("I"), bundle.motionConfig.startShapes["J"])
        assertNull(bundle.warning)
    }

    @Test
    fun staticOnlyWhenNoMotionFiles() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), withMotion = false))
        assertNull(bundle.motion)
        assertNull(bundle.warning)
    }

    @Test
    fun rejectsMissingModel() {
        val dir = TestModels.writeFolder(tmp.newFolder())
        File(dir, ModelFiles.MODEL).delete()
        assertRejected(dir, "model.tflite")
    }

    @Test
    fun rejectsLabelCountMismatch() {
        assertRejected(TestModels.writeFolder(tmp.newFolder(), labels = """["A","B","C"]"""), "labels")
    }

    @Test
    fun rejectsFailingGolden() {
        val dir = TestModels.writeFolder(tmp.newFolder(), golden = TestModels.staticGolden(listOf(0.9f to "A")))
        assertRejected(dir, "golden.json")
    }

    @Test
    fun rejectsMissingGolden() {
        val dir = TestModels.writeFolder(tmp.newFolder())
        File(dir, ModelFiles.GOLDEN).delete()
        assertRejected(dir, "golden.json")
    }

    @Test
    fun rejectsBrokenLabelsJson() {
        assertRejected(TestModels.writeFolder(tmp.newFolder(), labels = "not json"), "labels.json")
    }

    @Test
    fun brokenMotionFallsBackToStaticOnly() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), motionLabels = """["_none","J"]"""))
        assertNull(bundle.motion)
        assertNotNull(bundle.warning)
        assertEquals(Prediction("A", 0.8f), bundle.static.classify(TestModels.landmarks(0.1f)))
    }

    @Test
    fun failingMotionGoldenFallsBackToStaticOnly() {
        val bad = TestModels.motionGolden(listOf(TestModels.frames(0.2f, 0.8f) to "Z"))
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), motionGolden = bad))
        assertNull(bundle.motion)
        assertTrue(bundle.warning!!.contains("motion_golden.json"))
    }

    @Test
    fun motionConfigUsesDefaultsForMissingKeys() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), motionConfig = """{"start_speed": 2.5}"""))
        assertEquals(2.5f, bundle.motionConfig.startSpeed, 1e-6f)
        assertEquals(200L, bundle.motionConfig.stopHoldMs)
    }

    @Test
    fun predictionOfPicksHighest() {
        assertEquals(Prediction("B", 0.7f), ph.senya.app.core.predictionOf(floatArrayOf(0.2f, 0.7f, 0.1f), listOf("A", "B", "C")))
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.ml.ModelBundleTest"`
Expected: FAIL to compile (`Unresolved reference: ModelBundle`, `DirModelSource`, …).

- [ ] **Step 4: Create the core types**

`main/java/ph/senya/app/core/Prediction.kt`:

```kotlin
package ph.senya.app.core

data class Prediction(val label: String, val confidence: Float)

/** Contract §3 item 5: this motion label means "not a sign" and is never committed. */
const val NONE_LABEL = "_none"

fun interface StaticClassifier {
    fun classify(landmarks: FloatArray): Prediction
}

fun interface SequenceClassifier {
    fun classify(frames: Array<FloatArray>): Prediction
}

fun predictionOf(probabilities: FloatArray, labels: List<String>): Prediction {
    var best = 0
    for (i in probabilities.indices) if (probabilities[i] > probabilities[best]) best = i
    return Prediction(labels[best], probabilities[best])
}
```

`main/java/ph/senya/app/core/MotionConfig.kt`:

```kotlin
package ph.senya.app.core

/** Values from motion_config.json (contract §3 item 8). Defaults are the contract's starting values. */
data class MotionConfig(
    val t: Int = Hand.FRAMES,
    val startSpeed: Float = 1.0f,
    val stopSpeed: Float = 0.5f,
    val stopHoldMs: Long = 200,
    val padMs: Long = 150,
    val minMs: Long = 300,
    val maxMs: Long = 2500,
    val maxMissing: Float = 0.25f,
    val minConfidence: Float = 0.7f,
    val replaceWindowMs: Long = 1000,
    val startShapes: Map<String, List<String>> = mapOf("J" to listOf("I"), "Z" to emptyList()),
)
```

- [ ] **Step 5: Create the model interface and file sources**

`main/java/ph/senya/app/ml/ProbabilityModel.kt`:

```kotlin
package ph.senya.app.ml

import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A softmax classifier. [predict] takes a batch of one ([1, 63] or [1, 32, 63]) and returns the N probabilities. */
interface ProbabilityModel : Closeable {
    val inputShape: IntArray
    val outputSize: Int
    fun predict(input: Any): FloatArray
}

class TfliteModel private constructor(buffer: ByteBuffer) : ProbabilityModel {
    private val interpreter = Interpreter(buffer, Interpreter.Options().setNumThreads(2))
    override val inputShape: IntArray = interpreter.getInputTensor(0).shape()
    override val outputSize: Int = interpreter.getOutputTensor(0).shape().last()

    override fun predict(input: Any): FloatArray {
        val output = arrayOf(FloatArray(outputSize))
        interpreter.run(input, output)
        return output[0]
    }

    override fun close() = interpreter.close()

    companion object {
        fun fromBytes(bytes: ByteArray): ProbabilityModel {
            val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
            buffer.put(bytes).rewind()
            return TfliteModel(buffer)
        }
    }
}
```

`main/java/ph/senya/app/ml/ModelSource.kt`:

```kotlin
package ph.senya.app.ml

import android.content.res.AssetManager
import java.io.File
import java.io.IOException

/** File names inside a model folder (contract §3 items 3–10). */
object ModelFiles {
    const val MODEL = "model.tflite"
    const val LABELS = "labels.json"
    const val GOLDEN = "golden.json"
    const val MOTION_MODEL = "motion.tflite"
    const val MOTION_LABELS = "motion_labels.json"
    const val MOTION_CONFIG = "motion_config.json"
    const val MOTION_GOLDEN = "motion_golden.json"
}

interface ModelSource {
    /** The file's bytes, or null if it doesn't exist. */
    fun read(name: String): ByteArray?
}

class DirModelSource(private val dir: File) : ModelSource {
    override fun read(name: String): ByteArray? = File(dir, name).takeIf { it.isFile }?.readBytes()
}

class AssetModelSource(private val assets: AssetManager, private val folder: String = "model") : ModelSource {
    override fun read(name: String): ByteArray? = try {
        assets.open("$folder/$name").use { it.readBytes() }
    } catch (e: IOException) {
        null
    }
}
```

- [ ] **Step 6: Create the JSON parsing, classifiers, and bundle**

`main/java/ph/senya/app/ml/ModelJson.kt`:

```kotlin
package ph.senya.app.ml

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import ph.senya.app.core.MotionConfig

class ModelLoadException(message: String, cause: Throwable? = null) : Exception(message, cause)

object ModelJson {
    fun parseLabels(bytes: ByteArray, file: String): List<String> = parse(file, bytes) { text ->
        val a = JSONArray(text)
        List(a.length()) { a.getString(it) }
    }

    fun parseStaticGolden(bytes: ByteArray): List<Pair<FloatArray, String>> = parse(ModelFiles.GOLDEN, bytes) { text ->
        val a = JSONArray(text)
        List(a.length()) { i ->
            val o = a.getJSONObject(i)
            floats(o.getJSONArray("landmarks")) to o.getString("label")
        }
    }

    fun parseMotionGolden(bytes: ByteArray): List<Pair<Array<FloatArray>, String>> = parse(ModelFiles.MOTION_GOLDEN, bytes) { text ->
        val a = JSONArray(text)
        List(a.length()) { i ->
            val o = a.getJSONObject(i)
            val frames = o.getJSONArray("frames")
            Array(frames.length()) { floats(frames.getJSONArray(it)) } to o.getString("label")
        }
    }

    fun parseMotionConfig(bytes: ByteArray): MotionConfig = parse(ModelFiles.MOTION_CONFIG, bytes) { text ->
        val o = JSONObject(text)
        val d = MotionConfig()
        MotionConfig(
            t = o.optInt("T", d.t),
            startSpeed = o.optDouble("start_speed", d.startSpeed.toDouble()).toFloat(),
            stopSpeed = o.optDouble("stop_speed", d.stopSpeed.toDouble()).toFloat(),
            stopHoldMs = o.optLong("stop_hold_ms", d.stopHoldMs),
            padMs = o.optLong("pad_ms", d.padMs),
            minMs = o.optLong("min_ms", d.minMs),
            maxMs = o.optLong("max_ms", d.maxMs),
            maxMissing = o.optDouble("max_missing", d.maxMissing.toDouble()).toFloat(),
            minConfidence = o.optDouble("min_confidence", d.minConfidence.toDouble()).toFloat(),
            replaceWindowMs = o.optLong("replace_window_ms", d.replaceWindowMs),
            startShapes = o.optJSONObject("start_shapes")?.let { shapes ->
                shapes.keys().asSequence().associateWith { key ->
                    val arr = shapes.getJSONArray(key)
                    List(arr.length()) { arr.getString(it) }
                }
            } ?: d.startShapes,
        )
    }

    private fun floats(a: JSONArray) = FloatArray(a.length()) { a.getDouble(it).toFloat() }

    private inline fun <T> parse(file: String, bytes: ByteArray, block: (String) -> T): T = try {
        block(String(bytes, Charsets.UTF_8))
    } catch (e: JSONException) {
        throw ModelLoadException("bad $file: ${e.message}", e)
    }
}
```

`main/java/ph/senya/app/ml/Classifiers.kt`:

```kotlin
package ph.senya.app.ml

import ph.senya.app.core.Hand
import ph.senya.app.core.Prediction
import ph.senya.app.core.SequenceClassifier
import ph.senya.app.core.StaticClassifier
import ph.senya.app.core.predictionOf
import java.io.Closeable

class SignClassifier(private val model: ProbabilityModel, val labels: List<String>) : StaticClassifier, Closeable {
    init {
        require(model.inputShape.contentEquals(intArrayOf(1, Hand.FLOATS))) {
            "model.tflite input is ${model.inputShape.contentToString()}, expected [1, ${Hand.FLOATS}]"
        }
        require(model.outputSize == labels.size) {
            "model.tflite has ${model.outputSize} outputs but labels.json has ${labels.size} labels"
        }
    }

    override fun classify(landmarks: FloatArray): Prediction = predictionOf(model.predict(arrayOf(landmarks)), labels)

    override fun close() = model.close()
}

class MotionClassifier(private val model: ProbabilityModel, val labels: List<String>) : SequenceClassifier, Closeable {
    init {
        require(model.inputShape.contentEquals(intArrayOf(1, Hand.FRAMES, Hand.FLOATS))) {
            "motion.tflite input is ${model.inputShape.contentToString()}, expected [1, ${Hand.FRAMES}, ${Hand.FLOATS}]"
        }
        require(model.outputSize == labels.size) {
            "motion.tflite has ${model.outputSize} outputs but motion_labels.json has ${labels.size} labels"
        }
    }

    override fun classify(frames: Array<FloatArray>): Prediction = predictionOf(model.predict(arrayOf(frames)), labels)

    override fun close() = model.close()
}
```

`main/java/ph/senya/app/ml/ModelBundle.kt`:

```kotlin
package ph.senya.app.ml

import ph.senya.app.core.Hand
import ph.senya.app.core.MotionConfig
import java.io.Closeable

/** One model version, loaded and golden-checked (contract §3 item 10). */
class ModelBundle private constructor(
    val version: Int,
    val static: SignClassifier,
    /** Null means static-only: no motion files, or they were broken (see [warning]). */
    val motion: MotionClassifier?,
    val motionConfig: MotionConfig,
    val warning: String?,
) : Closeable {

    override fun close() {
        static.close()
        motion?.close()
    }

    companion object {
        /** Throws [ModelLoadException] if the static model can't be used. A broken motion part only sets [warning]. */
        fun load(version: Int, source: ModelSource, modelFactory: (ByteArray) -> ProbabilityModel): ModelBundle {
            val static = loadStatic(source, modelFactory)
            if (source.read(ModelFiles.MOTION_MODEL) == null) {
                return ModelBundle(version, static, null, MotionConfig(), null)
            }
            return try {
                val config = ModelJson.parseMotionConfig(source.require(ModelFiles.MOTION_CONFIG))
                if (config.t != Hand.FRAMES) throw ModelLoadException("motion_config.json has T=${config.t}, expected ${Hand.FRAMES}")
                ModelBundle(version, static, loadMotion(source, modelFactory), config, null)
            } catch (e: ModelLoadException) {
                ModelBundle(version, static, null, MotionConfig(), "Motion model skipped: ${e.message}")
            }
        }

        private fun loadStatic(source: ModelSource, factory: (ByteArray) -> ProbabilityModel): SignClassifier {
            val labels = ModelJson.parseLabels(source.require(ModelFiles.LABELS), ModelFiles.LABELS)
            val classifier = build(source.require(ModelFiles.MODEL), factory) { SignClassifier(it, labels) }
            try {
                val golden = ModelJson.parseStaticGolden(source.require(ModelFiles.GOLDEN))
                checkGolden(ModelFiles.GOLDEN, golden.map { (landmarks, want) -> classifier.classify(landmarks).label to want })
            } catch (e: ModelLoadException) {
                classifier.close()
                throw e
            }
            return classifier
        }

        private fun loadMotion(source: ModelSource, factory: (ByteArray) -> ProbabilityModel): MotionClassifier {
            val labels = ModelJson.parseLabels(source.require(ModelFiles.MOTION_LABELS), ModelFiles.MOTION_LABELS)
            val classifier = build(source.require(ModelFiles.MOTION_MODEL), factory) { MotionClassifier(it, labels) }
            try {
                val golden = ModelJson.parseMotionGolden(source.require(ModelFiles.MOTION_GOLDEN))
                checkGolden(ModelFiles.MOTION_GOLDEN, golden.map { (frames, want) -> classifier.classify(frames).label to want })
            } catch (e: ModelLoadException) {
                classifier.close()
                throw e
            }
            return classifier
        }

        private fun ModelSource.require(name: String): ByteArray = read(name) ?: throw ModelLoadException("missing $name")

        private fun <T> build(bytes: ByteArray, factory: (ByteArray) -> ProbabilityModel, wrap: (ProbabilityModel) -> T): T {
            val model = try {
                factory(bytes)
            } catch (e: Exception) {
                throw ModelLoadException("can't open model: ${e.message}", e)
            }
            return try {
                wrap(model)
            } catch (e: IllegalArgumentException) {
                model.close()
                throw ModelLoadException(e.message ?: "model doesn't match its labels", e)
            }
        }

        /** [results] holds (predicted, expected) pairs. */
        private fun checkGolden(file: String, results: List<Pair<String, String>>) {
            val wrong = results.filter { (got, want) -> got != want }
            if (wrong.isNotEmpty()) {
                val (got, want) = wrong.first()
                throw ModelLoadException("$file: ${wrong.size} of ${results.size} wrong (expected $want, got $got)")
            }
        }
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.ml.ModelBundleTest"`
Expected: PASS (11 tests).

- [ ] **Step 8: Write the bundling script and bundle the dummy model**

`android/tools/fetch_bundled_model.py`:

```python
#!/usr/bin/env python3
"""Copy the currently published model into the app's bundled assets (spec §5.2: the bundled model is version 0).

Usage: python android/tools/fetch_bundled_model.py http://<server>:8000
Works against the real platform or fixtures/mock_server (python -m http.server 8000).
"""
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "assets" / "model"


def get(base: str, path: str) -> bytes:
    with urllib.request.urlopen(urllib.parse.urljoin(base + "/", path), timeout=10) as response:
        return response.read()


def sibling(url: str, name: str) -> str:
    return url.rsplit("/", 1)[0] + "/" + name


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = sys.argv[1].rstrip("/")
    latest = json.loads(get(base, "/api/model/latest"))
    files = {
        "model.tflite": latest["model_url"],
        "labels.json": latest["labels_url"],
        "golden.json": sibling(latest["model_url"], "golden.json"),
    }
    checksums = {"model.tflite": latest["sha256"]}
    motion = latest.get("motion")
    if motion:
        files.update({
            "motion.tflite": motion["model_url"],
            "motion_labels.json": motion["labels_url"],
            "motion_config.json": motion["config_url"],
            "motion_golden.json": sibling(motion["model_url"], "motion_golden.json"),
        })
        checksums["motion.tflite"] = motion["sha256"]

    data = {name: get(base, url) for name, url in files.items()}
    for name, expected in checksums.items():
        if hashlib.sha256(data[name]).hexdigest().lower() != expected.lower():
            sys.exit(f"sha256 mismatch for {name}")

    ASSETS.mkdir(parents=True, exist_ok=True)
    for old in ASSETS.iterdir():
        old.unlink()
    for name, content in data.items():
        (ASSETS / name).write_bytes(content)
    kind = "static + motion" if motion else "static only"
    print(f"Bundled server version {latest['version']} ({kind}) into {ASSETS}")


if __name__ == "__main__":
    main()
```

When `fixtures/mock_server/` exists (B pushes it by ~1:00; run `git pull --rebase` first), run in a second terminal from the repo root: `cd fixtures/mock_server && python -m http.server 8000`. Then from the repo root:

Run: `python android/tools/fetch_bundled_model.py http://127.0.0.1:8000`
Expected: `Bundled server version 0 (static + motion) into …/assets/model`.

If the mock server isn't pushed yet, skip this step for now and come back to it. Nothing else in Tasks 3–8 waits for it. Until then the app shows "No model loaded".

- [ ] **Step 9: Commit**

```bash
git add -A app/src tools
git commit -m "Android: model loading, classifiers, golden-file check"
git pull --rebase && git push
```

---

### Task 3: Transcript and PredictionStabilizer (static rules)

**Files:**
- Create: `main/java/ph/senya/app/core/StabilizerEvent.kt`, `core/Transcript.kt`, `core/PredictionStabilizer.kt`
- Test: `test/java/ph/senya/app/core/TranscriptTest.kt`, `test/java/ph/senya/app/core/PredictionStabilizerTest.kt`

**Interfaces:**
- Consumes: `Prediction` (Task 2).
- Produces:
  - `sealed class StabilizerEvent { data class Letter(label); object Space; data class ReplaceLast(label) }`
  - `class Transcript { text; isEmpty; endsWithSpace; apply(event); backspace(); clear(); lastWord() }`
  - `class PredictionStabilizer(minConfidence = 0.7f, windowSize = 10, votesToCommit = 8, spaceAfterMs = 1000L)`
  - `fun onFrame(tMs: Long, guess: Prediction?, handPresent: Boolean, moving: Boolean): StabilizerEvent?`
  - `fun syncWithTranscript(emptyOrEndsWithSpace: Boolean)`

- [ ] **Step 1: Write the failing Transcript test**

`test/java/ph/senya/app/core/TranscriptTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptTest {
    @Test
    fun appliesEventsAndEdits() {
        val t = Transcript()
        assertTrue(t.isEmpty)
        t.apply(StabilizerEvent.Letter("H"))
        t.apply(StabilizerEvent.Letter("I"))
        t.apply(StabilizerEvent.ReplaceLast("J"))
        t.apply(StabilizerEvent.Space)
        assertEquals("HJ ", t.text)
        assertTrue(t.endsWithSpace)
        assertEquals("HJ", t.lastWord())
        t.backspace()
        assertEquals("HJ", t.text)
        t.clear()
        assertTrue(t.isEmpty)
        t.backspace() // no crash on empty
    }

    @Test
    fun multiCharacterLabelIsOneToken() {
        val t = Transcript()
        t.apply(StabilizerEvent.Letter("NG"))
        t.apply(StabilizerEvent.Letter("A"))
        t.backspace()
        assertEquals("NG", t.text)
        t.backspace()
        assertEquals("", t.text)
    }

    @Test
    fun lastWordAfterSeveralWords() {
        val t = Transcript()
        listOf("A", "B").forEach { t.apply(StabilizerEvent.Letter(it)) }
        t.apply(StabilizerEvent.Space)
        listOf("C", "D").forEach { t.apply(StabilizerEvent.Letter(it)) }
        t.apply(StabilizerEvent.Space)
        assertEquals("CD", t.lastWord())
    }
}
```

- [ ] **Step 2: Write the failing stabilizer test**

`test/java/ph/senya/app/core/PredictionStabilizerTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PredictionStabilizerTest {
    private var t = 0L
    private val step = 33L

    /** Feeds [n] frames of [label] and returns the non-null events. */
    private fun PredictionStabilizer.hand(label: String?, n: Int, conf: Float = 0.9f, moving: Boolean = false): List<StabilizerEvent> =
        (1..n).mapNotNull {
            t += step
            onFrame(t, label?.let { Prediction(it, conf) }, handPresent = true, moving = moving)
        }

    private fun PredictionStabilizer.noHand(ms: Long): List<StabilizerEvent> {
        val out = mutableListOf<StabilizerEvent>()
        val end = t + ms
        while (t < end) {
            t += step
            onFrame(t, null, handPresent = false, moving = false)?.let { out += it }
        }
        return out
    }

    @Test
    fun commitsOnEighthAgreeingFrame() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 1))
    }

    @Test
    fun sevenOfTenDoesNotCommit() {
        val s = PredictionStabilizer()
        val events = listOf("A", "A", "B", "A", "A", "B", "A", "A", "B", "A").flatMap { s.hand(it, 1) }
        assertEquals(emptyList<StabilizerEvent>(), events)
    }

    @Test
    fun lowConfidenceFramesDoNotVote() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 10, conf = 0.6f))
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 1))
    }

    @Test
    fun movingFramesResetTheWindow() {
        val s = PredictionStabilizer()
        s.hand("A", 7)
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 1, moving = true))
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 1))
    }

    @Test
    fun sameLetterNeedsNoHandOrOtherLetterBetween() {
        val s = PredictionStabilizer()
        assertEquals(1, s.hand("A", 30).size)
        s.noHand(100)
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 8))
        assertEquals(listOf(StabilizerEvent.Letter("B")), s.hand("B", 8))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 8))
    }

    @Test
    fun spaceOnceAfterOneSecondWithoutHand() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        val events = s.noHand(3000)
        assertEquals(listOf(StabilizerEvent.Space), events)
    }

    @Test
    fun spaceNotBeforeOneSecond() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(900))
    }

    @Test
    fun noSpaceAsFirstOutput() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(3000))
    }

    @Test
    fun noSpaceRightAfterSpace() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        assertEquals(listOf(StabilizerEvent.Space), s.noHand(1500))
        s.hand("B", 3) // hand back briefly, nothing committed
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(1500))
    }

    @Test
    fun nullGuessWithHandDoesNotVote() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.hand(null, 20))
    }

    @Test
    fun syncAfterClearPreventsLeadingSpaceAndAllowsSameLetter() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        s.syncWithTranscript(emptyOrEndsWithSpace = true) // user tapped Clear
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 8))
        s.syncWithTranscript(emptyOrEndsWithSpace = true)
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(2000))
    }

    @Test
    fun windowNeedsFreshVotesAfterCommit() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        // B needs its own 8 votes; leftover A votes don't count toward it
        assertNull(s.hand("B", 7).firstOrNull())
        assertEquals(listOf(StabilizerEvent.Letter("B")), s.hand("B", 1))
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.TranscriptTest" --tests "ph.senya.app.core.PredictionStabilizerTest"`
Expected: FAIL to compile (`Unresolved reference: Transcript`, `PredictionStabilizer`, `StabilizerEvent`).

- [ ] **Step 4: Implement**

`main/java/ph/senya/app/core/StabilizerEvent.kt`:

```kotlin
package ph.senya.app.core

sealed class StabilizerEvent {
    data class Letter(val label: String) : StabilizerEvent()
    object Space : StabilizerEvent() {
        override fun toString() = "Space"
    }
    /** A motion letter replaces the start-shape letter just committed (e.g. I → J). */
    data class ReplaceLast(val label: String) : StabilizerEvent()
}
```

`main/java/ph/senya/app/core/Transcript.kt`:

```kotlin
package ph.senya.app.core

/** The committed text as tokens, so Backspace removes a whole label such as "NG". */
class Transcript {
    private val tokens = mutableListOf<String>()

    val text: String get() = tokens.joinToString("")
    val isEmpty: Boolean get() = tokens.isEmpty()
    val endsWithSpace: Boolean get() = tokens.lastOrNull() == " "

    fun apply(event: StabilizerEvent) {
        when (event) {
            is StabilizerEvent.Letter -> tokens += event.label
            is StabilizerEvent.Space -> tokens += " "
            is StabilizerEvent.ReplaceLast -> {
                if (tokens.isNotEmpty()) tokens.removeAt(tokens.lastIndex)
                tokens += event.label
            }
        }
    }

    fun backspace() {
        if (tokens.isNotEmpty()) tokens.removeAt(tokens.lastIndex)
    }

    fun clear() = tokens.clear()

    /** The last finished word, for speaking a word when its space is committed. */
    fun lastWord(): String = text.trimEnd().substringAfterLast(' ')
}
```

`main/java/ph/senya/app/core/PredictionStabilizer.kt`:

```kotlin
package ph.senya.app.core

/** Turns noisy per-frame guesses into committed letters and spaces (spec §5.2). No Android imports. */
class PredictionStabilizer(
    private val minConfidence: Float = 0.7f,
    private val windowSize: Int = 10,
    private val votesToCommit: Int = 8,
    private val spaceAfterMs: Long = 1000,
) {
    private val window = ArrayDeque<String?>()
    /** The last static letter; it can't be committed again until another commit or a no-hand frame. */
    private var lastStatic: String? = null
    private var noHandSinceMs: Long? = null
    private var spaceEmittedThisGap = false
    /** True at the start and right after a space: a space must not be emitted then. */
    private var outputEmptyOrSpace = true

    fun onFrame(tMs: Long, guess: Prediction?, handPresent: Boolean, moving: Boolean): StabilizerEvent? {
        if (!handPresent) return onNoHand(tMs)
        noHandSinceMs = null
        spaceEmittedThisGap = false
        if (moving) {
            window.clear()
            return null
        }
        window.addLast(guess?.takeIf { it.confidence >= minConfidence }?.label)
        while (window.size > windowSize) window.removeFirst()

        val top = window.filterNotNull().groupingBy { it }.eachCount().maxByOrNull { it.value } ?: return null
        if (top.value < votesToCommit || top.key == lastStatic) return null
        window.clear()
        lastStatic = top.key
        return emit(StabilizerEvent.Letter(top.key))
    }

    /** Call after the user edits the transcript (Backspace / Clear). */
    fun syncWithTranscript(emptyOrEndsWithSpace: Boolean) {
        outputEmptyOrSpace = emptyOrEndsWithSpace
        lastStatic = null
        window.clear()
    }

    private fun onNoHand(tMs: Long): StabilizerEvent? {
        window.clear()
        lastStatic = null
        val since = noHandSinceMs ?: tMs.also { noHandSinceMs = it }
        if (spaceEmittedThisGap || outputEmptyOrSpace || tMs - since < spaceAfterMs) return null
        spaceEmittedThisGap = true
        return emit(StabilizerEvent.Space)
    }

    private fun emit(event: StabilizerEvent): StabilizerEvent {
        outputEmptyOrSpace = event is StabilizerEvent.Space
        return event
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.TranscriptTest" --tests "ph.senya.app.core.PredictionStabilizerTest"`
Expected: PASS (3 + 12 tests).

- [ ] **Step 6: Commit**

```bash
git add -A app/src
git commit -m "Android: transcript and prediction stabilizer (static rules)"
git pull --rebase && git push
```

---

### Task 4: TranslatorEngine (static path) and FpsCounter

**Files:**
- Create: `main/java/ph/senya/app/core/TranslatorEngine.kt`, `core/FpsCounter.kt`
- Test: `test/java/ph/senya/app/core/TranslatorEngineTest.kt`, `test/java/ph/senya/app/core/FpsCounterTest.kt`

**Interfaces:**
- Consumes: `StaticClassifier`, `SequenceClassifier`, `MotionConfig`, `Prediction` (Task 2); `PredictionStabilizer`, `StabilizerEvent` (Task 3).
- Produces:
  - `data class EngineModels(val static: StaticClassifier?, val motion: SequenceClassifier? = null, val config: MotionConfig = MotionConfig())`
  - `data class FrameOutput(val staticGuess: Prediction?, val moving: Boolean, val motionGuess: Prediction?, val events: List<StabilizerEvent>)`
  - `class TranslatorEngine(models: EngineModels)` with `onFrame(tMs: Long, landmarks: FloatArray?): FrameOutput`, `setModels(models: EngineModels)`, `onTranscriptEdited(emptyOrEndsWithSpace: Boolean)`. All are thread-safe.
  - `class FpsCounter { fun tick(tMs: Long): Int }`

- [ ] **Step 1: Write the failing tests**

`test/java/ph/senya/app/core/TranslatorEngineTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TranslatorEngineTest {
    private var t = 0L
    private val hand = FloatArray(Hand.FLOATS)

    private fun TranslatorEngine.frames(n: Int, landmarks: FloatArray? = hand): List<StabilizerEvent> =
        (1..n).flatMap { t += 33; onFrame(t, landmarks).events }

    private fun always(label: String) = StaticClassifier { Prediction(label, 0.9f) }

    @Test
    fun commitsStaticLetter() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        assertEquals(listOf(StabilizerEvent.Letter("A")), engine.frames(8))
    }

    @Test
    fun reportsGuessAndHandAbsence() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        t += 33
        assertEquals(Prediction("A", 0.9f), engine.onFrame(t, hand).staticGuess)
        t += 33
        assertNull(engine.onFrame(t, null).staticGuess)
    }

    @Test
    fun noModelMeansNoGuesses() {
        val engine = TranslatorEngine(EngineModels(static = null))
        assertEquals(emptyList<StabilizerEvent>(), engine.frames(20))
    }

    @Test
    fun swappingModelsResetsState() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        engine.frames(7)
        engine.setModels(EngineModels(always("A")))
        assertEquals(emptyList<StabilizerEvent>(), engine.frames(7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), engine.frames(1))
    }

    @Test
    fun transcriptEditResetsStabilizer() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        engine.frames(8)
        engine.onTranscriptEdited(emptyOrEndsWithSpace = true) // Backspace removed the A
        assertEquals(listOf(StabilizerEvent.Letter("A")), engine.frames(8))
    }
}
```

`test/java/ph/senya/app/core/FpsCounterTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class FpsCounterTest {
    @Test
    fun countsFramesInLastSecond() {
        val fps = FpsCounter()
        var last = 0
        for (i in 0 until 90) last = fps.tick(i * 33L) // 30 fps for ~3 s
        assertEquals(31, last) // frames with t in [now - 1000, now]
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.TranslatorEngineTest" --tests "ph.senya.app.core.FpsCounterTest"`
Expected: FAIL to compile (`Unresolved reference: TranslatorEngine`, `FpsCounter`).

- [ ] **Step 3: Implement**

`main/java/ph/senya/app/core/TranslatorEngine.kt`:

```kotlin
package ph.senya.app.core

data class EngineModels(
    val static: StaticClassifier?,
    val motion: SequenceClassifier? = null,
    val config: MotionConfig = MotionConfig(),
)

data class FrameOutput(
    val staticGuess: Prediction?,
    val moving: Boolean,
    val motionGuess: Prediction?,
    val events: List<StabilizerEvent>,
)

/** The per-frame pipeline (spec §5.1). Thread-safe: frames, model swaps, and edits may come from different threads. */
class TranslatorEngine(models: EngineModels) {
    private val lock = Any()
    private var models = models
    private var stabilizer = PredictionStabilizer()

    fun onFrame(tMs: Long, landmarks: FloatArray?): FrameOutput = synchronized(lock) {
        val guess = landmarks?.let { models.static?.classify(it) }
        val event = stabilizer.onFrame(tMs, guess, handPresent = landmarks != null, moving = false)
        FrameOutput(guess, moving = false, motionGuess = null, events = listOfNotNull(event))
    }

    /** Swaps models and starts fresh. When this returns, no frame is still using the old models. */
    fun setModels(models: EngineModels) = synchronized(lock) {
        this.models = models
        stabilizer = PredictionStabilizer()
    }

    fun onTranscriptEdited(emptyOrEndsWithSpace: Boolean) = synchronized(lock) {
        stabilizer.syncWithTranscript(emptyOrEndsWithSpace)
    }
}
```

`main/java/ph/senya/app/core/FpsCounter.kt`:

```kotlin
package ph.senya.app.core

/** Frames seen in the last second, for the status line (spec §5.5 target: ≥ 15 fps). */
class FpsCounter(private val windowMs: Long = 1000) {
    private val times = ArrayDeque<Long>()

    fun tick(tMs: Long): Int {
        times.addLast(tMs)
        while (tMs - times.first() > windowMs) times.removeFirst()
        return times.size
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.TranslatorEngineTest" --tests "ph.senya.app.core.FpsCounterTest"`
Expected: PASS (5 + 1 tests).

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "Android: translator engine (static path) and fps counter"
git pull --rebase && git push
```

---

### Task 5: Translator screen (guess chip, transcript, buttons, hint, status line)

Builds the single screen from spec §5.3 and wires it to the engine and the bundled model. No unit tests (it's view code); verify on the phone.

**Files:**
- Modify: `main/res/layout/fragment_camera.xml`, `main/res/values/strings.xml`, `main/res/values/styles.xml`, `fragment/CameraFragment.kt`
- Create: `main/res/drawable/bg_pill.xml`

**Interfaces:**
- Consumes: `TranslatorEngine`, `EngineModels`, `FrameOutput`, `FpsCounter` (Task 4); `Transcript`, `StabilizerEvent` (Task 3); `ModelBundle`, `AssetModelSource`, `TfliteModel`, `ModelLoadException` (Task 2); `Landmarks` (Task 1).
- Produces:
  - View ids: `model_version`, `offline_badge`, `top_bar`, `guess_label`, `guess_confidence`, `hand_hint`, `transcript`, `speak_button`, `backspace_button`, `clear_button`
  - In `CameraFragment`: `modelExecutor`, `applyBundle(ModelBundle)`, `toast(String)`, `showModelLabel(String)`, `afterEdit()`, `renderTranscript()`, `showGuess(Prediction?)`

- [ ] **Step 1: Add strings to `res/values/strings.xml`** (inside `<resources>`)

```xml
    <string name="offline_badge">Offline · on-device</string>
    <string name="hand_hint">Show your hand to the camera</string>
    <string name="transcript_placeholder">Fingerspell to start…</string>
    <string name="speak">Speak</string>
    <string name="backspace">⌫</string>
    <string name="backspace_description">Backspace</string>
    <string name="clear">Clear</string>
    <string name="no_model">No model loaded</string>
    <string name="no_guess">—</string>
```

- [ ] **Step 2: Add the pill style and background**

`res/drawable/bg_pill.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#99000000" />
    <corners android:radius="16dp" />
</shape>
```

In `res/values/styles.xml`, inside `<resources>`, add:

```xml
    <style name="SenyaPill">
        <item name="android:layout_width">wrap_content</item>
        <item name="android:layout_height">wrap_content</item>
        <item name="android:background">@drawable/bg_pill</item>
        <item name="android:paddingStart">12dp</item>
        <item name="android:paddingEnd">12dp</item>
        <item name="android:paddingTop">6dp</item>
        <item name="android:paddingBottom">6dp</item>
        <item name="android:textColor">@android:color/white</item>
        <item name="android:textSize">13sp</item>
    </style>
```

- [ ] **Step 3: Replace `res/layout/fragment_camera.xml`** (keep the license comment)

```xml
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/camera_container"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@android:color/black">

    <androidx.camera.view.PreviewView
        android:id="@+id/view_finder"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        app:scaleType="fillStart" />

    <ph.senya.app.OverlayView
        android:id="@+id/overlay"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="top"
        android:orientation="vertical"
        android:padding="12dp">

        <LinearLayout
            android:id="@+id/top_bar"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:gravity="center_vertical"
            android:orientation="horizontal">

            <TextView
                android:id="@+id/offline_badge"
                style="@style/SenyaPill"
                android:text="@string/offline_badge" />

            <TextView
                android:id="@+id/model_version"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_marginStart="8dp"
                android:layout_weight="1"
                android:shadowColor="@android:color/black"
                android:shadowRadius="4"
                android:textColor="@android:color/white"
                android:textSize="13sp" />
        </LinearLayout>

        <LinearLayout
            android:id="@+id/guess_chip"
            style="@style/SenyaPill"
            android:layout_marginTop="8dp"
            android:gravity="center_vertical"
            android:orientation="horizontal">

            <TextView
                android:id="@+id/guess_label"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:minWidth="40dp"
                android:text="@string/no_guess"
                android:textColor="@android:color/white"
                android:textSize="22sp"
                android:textStyle="bold" />

            <ProgressBar
                android:id="@+id/guess_confidence"
                style="?android:attr/progressBarStyleHorizontal"
                android:layout_width="96dp"
                android:layout_height="wrap_content"
                android:layout_marginStart="8dp"
                android:max="100" />
        </LinearLayout>

        <TextView
            android:id="@+id/hand_hint"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:shadowColor="@android:color/black"
            android:shadowRadius="4"
            android:text="@string/hand_hint"
            android:textColor="@android:color/white"
            android:textSize="16sp" />
    </LinearLayout>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom"
        android:background="#CC000000"
        android:orientation="vertical"
        android:padding="16dp">

        <TextView
            android:id="@+id/transcript"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:minLines="2"
            android:textColor="@android:color/white"
            android:textSize="28sp" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:orientation="horizontal">

            <Button
                android:id="@+id/speak_button"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:enabled="false"
                android:text="@string/speak" />

            <Button
                android:id="@+id/backspace_button"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_marginStart="8dp"
                android:layout_weight="1"
                android:contentDescription="@string/backspace_description"
                android:text="@string/backspace" />

            <Button
                android:id="@+id/clear_button"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_marginStart="8dp"
                android:layout_weight="1"
                android:text="@string/clear" />
        </LinearLayout>
    </LinearLayout>
</FrameLayout>
```

- [ ] **Step 4: Wire the engine into `CameraFragment.kt`**

Add imports:

```kotlin
import ph.senya.app.core.EngineModels
import ph.senya.app.core.FpsCounter
import ph.senya.app.core.Prediction
import ph.senya.app.core.Transcript
import ph.senya.app.core.TranslatorEngine
import ph.senya.app.ml.AssetModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.TfliteModel
```

Add fields after `private lateinit var backgroundExecutor: ExecutorService`:

```kotlin
    /** Loads and swaps models, so model work never blocks camera frames. */
    private lateinit var modelExecutor: ExecutorService
    private val engine = TranslatorEngine(EngineModels(static = null))
    private val transcript = Transcript()
    /** Only touched on [modelExecutor]. */
    private var bundle: ModelBundle? = null
    private val fps = FpsCounter()
    @Volatile private var modelLabel = ""
```

In `onDestroyView()`, before `_binding = null`, add:

```kotlin
        engine.setModels(EngineModels(static = null))
        modelExecutor.execute { bundle?.close(); bundle = null }
        modelExecutor.shutdown()
```

In `onViewCreated(...)`, right after `backgroundExecutor = Executors.newSingleThreadExecutor()`, add:

```kotlin
        modelExecutor = Executors.newSingleThreadExecutor()
```

At the end of `onViewCreated(...)`, add:

```kotlin
        binding.backspaceButton.setOnClickListener { transcript.backspace(); afterEdit() }
        binding.clearButton.setOnClickListener { transcript.clear(); afterEdit() }
        renderTranscript()
        showModelLabel(getString(R.string.no_model))
        modelExecutor.execute { loadBundledModel() }
```

Replace `onResults(...)` with:

```kotlin
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
            binding.overlay.invalidate()
            binding.handHint.visibility = if (landmarks == null) View.VISIBLE else View.GONE
            showGuess(out.staticGuess)
            if (out.events.isNotEmpty()) {
                out.events.forEach { transcript.apply(it) }
                renderTranscript()
            }
            binding.modelVersion.text = "$modelLabel · $currentFps fps"
        }
    }
```

Add these methods before `onError(...)`:

```kotlin
    private fun loadBundledModel() {
        val ctx = context ?: return
        try {
            applyBundle(ModelBundle.load(0, AssetModelSource(ctx.assets), TfliteModel::fromBytes))
        } catch (e: ModelLoadException) {
            Log.e(TAG, "Bundled model failed to load", e)
            toast("Bundled model failed: ${e.message}")
        }
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
```

Replace `onError(...)` with:

```kotlin
    override fun onError(error: String, errorCode: Int) = toast(error)
```

- [ ] **Step 5: Build, run all unit tests, install**

Run: `./gradlew testDebugUnitTest installDebug`
Expected: `BUILD SUCCESSFUL`, all tests pass, app installed.

- [ ] **Step 6: Check on the phone**

With the dummy model bundled (Task 2 Step 8):
- Status line shows `Model v0 · NN fps`, with NN ≥ 15.
- The guess chip changes as you move your hand (random weights, so any label).
- "Show your hand to the camera" appears when no hand is in view.
- Holding still long enough commits letters into the transcript; hiding your hand for > 1 s adds a space.
- ⌫ and Clear edit the transcript.

Without the dummy model: the status line shows `No model loaded`, a toast says `Bundled model failed: missing labels.json` (or `model.tflite`), the chip shows `—`, and the app does not crash.

- [ ] **Step 7: Commit**

```bash
git add -A app/src
git commit -m "Android: translator screen with guess chip, transcript and buttons"
git pull --rebase && git push
```

---

### Task 6: MotionSegmenter

Implements contract §3 item 7, with the clarifications listed at the top of this plan, written from the rules, not from B's Python code.

**Files:**
- Create: `main/java/ph/senya/app/core/MotionSegmenter.kt`
- Test: `test/java/ph/senya/app/core/MotionSegmenterTest.kt`

**Interfaces:**
- Consumes: `MotionConfig`, `Hand` (Tasks 1–2); `ModelJson.parseMotionConfig` (Task 2, fixture test only).
- Produces:
  - `class MotionSegmenter(config: MotionConfig = MotionConfig())` with `onFrame(tMs: Long, landmarks: FloatArray?): MotionSegmenter.Output`
  - `class Segment(val startMs: Long, val endMs: Long, val frames: Array<FloatArray>)`, where `startMs` already includes `− pad_ms`
  - `data class Output(val moving: Boolean, val segment: Segment?)`
  - `MotionSegmenter.resample(frames: List<Pair<Long, FloatArray>>, fromMs: Long, toMs: Long, t: Int): Array<FloatArray>`

- [ ] **Step 1: Write the failing tests**

Stream used by most tests: 30 fps (`t = 33·n`), a hand whose points sit on a line `x_i = cx + 0.01·i` (hand size 0.2). "Moving" frames shift `cx` by 0.03 (≈ 4.5 hand sizes/s); "still" frames don't move.

`test/java/ph/senya/app/core/MotionSegmenterTest.kt`:

```kotlin
package ph.senya.app.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import ph.senya.app.ml.ModelJson
import java.io.File

class MotionSegmenterTest {
    private fun hand(cx: Float) = FloatArray(Hand.FLOATS).also {
        for (i in 0 until Hand.POINTS) {
            it[i * 3] = cx + 0.01f * i
            it[i * 3 + 1] = 0.5f
        }
    }

    /** Runs frames n = 0, 1, 2, … at t = 33·n; [cxAt] returns null for "no hand". */
    private fun run(seg: MotionSegmenter, count: Int, cxAt: (Int) -> Float?): List<Pair<Int, MotionSegmenter.Output>> =
        (0 until count).map { n -> n to seg.onFrame(33L * n, cxAt(n)?.let { hand(it) }) }

    private fun segments(outputs: List<Pair<Int, MotionSegmenter.Output>>) = outputs.mapNotNull { it.second.segment }

    /** still at 0.3 for n < 10, moving 0.03/frame for n in 10..29, still afterwards. */
    private fun oneMovement(n: Int): Float = 0.3f + 0.03f * (n.coerceIn(9, 29) - 9)

    @Test
    fun emitsOneSegmentForOneMovement() {
        val out = run(MotionSegmenter(), 45, ::oneMovement)
        val segs = segments(out)
        assertEquals(1, segs.size)
        val s = segs[0]
        assertEquals(180L, s.startMs)   // start 330 − pad 150
        assertEquals(1056L, s.endMs)    // first still frame below stop_speed (n = 32)
        assertEquals(Hand.FRAMES, s.frames.size)
        assertTrue(s.frames.all { it.size == Hand.FLOATS })
        assertEquals(0.3f, s.frames.first()[0], 1e-4f)
        assertEquals(0.9f, s.frames.last()[0], 1e-4f)
        for (k in 1 until Hand.FRAMES) assertTrue(s.frames[k][0] >= s.frames[k - 1][0] - 1e-6f)
        assertTrue(out[20].second.moving)
        assertFalse(out[44].second.moving)
        assertEquals(39, out.first { it.second.segment != null }.first)
    }

    @Test
    fun stillHandNeverMoves() {
        val out = run(MotionSegmenter(), 60) { 0.4f }
        assertTrue(out.none { it.second.moving })
        assertTrue(segments(out).isEmpty())
    }

    @Test
    fun tooShortMovementIgnored() {
        val seg = MotionSegmenter(MotionConfig(padMs = 0, minMs = 300))
        val out = run(seg, 40) { n -> 0.3f + 0.03f * (n.coerceIn(9, 12) - 9) }
        assertTrue(segments(out).isEmpty())
        assertFalse(out.last().second.moving)
    }

    @Test
    fun tooLongMovementIgnored() {
        val out = run(MotionSegmenter(), 140) { n -> 0.3f + 0.003f * (n.coerceIn(9, 109) - 9) * 10 }
        assertTrue(segments(out).isEmpty())
        assertFalse(out.last().second.moving)
    }

    @Test
    fun handLostEndsSegmentAtLastHandFrame() {
        val out = run(MotionSegmenter(), 46) { n -> if (n >= 30) null else oneMovement(n) }
        val segs = segments(out)
        assertEquals(1, segs.size)
        assertEquals(957L, segs[0].endMs)   // n = 29
        assertEquals(0.9f, segs[0].frames.last()[0], 1e-4f)
        assertEquals(36, out.first { it.second.segment != null }.first)
    }

    @Test
    fun tooManyMissingFramesDiscarded() {
        // During the movement every 3rd frame has no hand: 10 of 32 frames missing > 25 %
        val seg = MotionSegmenter(MotionConfig(padMs = 0))
        val out = run(seg, 60) { n ->
            when {
                n < 10 -> 0.3f
                n <= 39 -> if ((n - 10) % 3 == 2) null else 0.3f + 0.03f * (n - 9)
                else -> 0.3f + 0.03f * 30
            }
        }
        assertTrue(segments(out).isEmpty())
    }

    @Test
    fun someMissingFramesKept() {
        // Every 4th frame missing: 7 of 33 frames ≤ 25 %
        val seg = MotionSegmenter(MotionConfig(padMs = 0))
        val out = run(seg, 60) { n ->
            when {
                n < 10 -> 0.3f
                n <= 39 -> if ((n - 10) % 4 == 3) null else 0.3f + 0.03f * (n - 9)
                else -> 0.3f + 0.03f * 30
            }
        }
        assertEquals(1, segments(out).size)
    }

    @Test
    fun nonIncreasingTimestampsDoNotCrash() {
        val seg = MotionSegmenter()
        repeat(20) { seg.onFrame(1000L, hand(0.3f + 0.05f * it)) }
        repeat(20) { seg.onFrame(500L, hand(0.3f)) }
        repeat(5) { seg.onFrame(400L, null) }
    }

    @Test
    fun resampleInterpolatesAndClamps() {
        val frames = listOf(0L to FloatArray(Hand.FLOATS) { 0f }, 100L to FloatArray(Hand.FLOATS) { 10f })
        val out = MotionSegmenter.resample(frames, 0, 100, 3)
        assertArrayEquals(floatArrayOf(0f, 5f, 10f), floatArrayOf(out[0][0], out[1][0], out[2][62]), 1e-5f)
        val clamped = MotionSegmenter.resample(frames, -50, 150, 2)
        assertEquals(0f, clamped[0][0], 1e-5f)
        assertEquals(10f, clamped[1][0], 1e-5f)
    }

    /** Person B's fixture (CONTRACT.md §3 item 11). Skipped until B pushes it. */
    @Test
    fun matchesSharedFixture() {
        val file = File(System.getProperty("senya.fixtures") ?: "", "segmenter_case.json")
        assumeTrue("fixture not pushed yet: $file", file.isFile)
        val root = JSONObject(file.readText())
        val seg = MotionSegmenter(ModelJson.parseMotionConfig(root.getJSONObject("config").toString().toByteArray()))
        val stream = root.getJSONArray("stream")
        val got = (0 until stream.length()).mapNotNull { i ->
            val f = stream.getJSONObject(i)
            val lm = if (f.isNull("landmarks")) null else floats(f.getJSONArray("landmarks"))
            seg.onFrame(f.getLong("t_ms"), lm).segment
        }
        val expected = root.getJSONArray("expected_segments")
        assertEquals(expected.length(), got.size)
        for (i in got.indices) {
            val e = expected.getJSONObject(i)
            assertEquals(e.getLong("start_ms"), got[i].startMs)
            assertEquals(e.getLong("end_ms"), got[i].endMs)
            val frames = e.getJSONArray("frames")
            for (k in 0 until frames.length()) assertArrayEquals(floats(frames.getJSONArray(k)), got[i].frames[k], 1e-4f)
        }
    }

    private fun floats(a: JSONArray) = FloatArray(a.length()) { a.getDouble(it).toFloat() }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.MotionSegmenterTest"`
Expected: FAIL to compile (`Unresolved reference: MotionSegmenter`).

- [ ] **Step 3: Implement**

`main/java/ph/senya/app/core/MotionSegmenter.kt`:

```kotlin
package ph.senya.app.core

import kotlin.math.hypot

/** Finds hand movements and resamples each to 32 frames (contract §3 item 7). No Android imports. */
class MotionSegmenter(private val config: MotionConfig = MotionConfig()) {

    /** [startMs] is the movement start minus pad_ms; [frames] is T × 63, ready for the motion model. */
    class Segment(val startMs: Long, val endMs: Long, val frames: Array<FloatArray>)

    data class Output(val moving: Boolean, val segment: Segment?)

    private class Frame(val tMs: Long, val landmarks: FloatArray?)

    private val buffer = ArrayDeque<Frame>()
    private var prev: Frame? = null
    private val speeds = ArrayDeque<Float>()
    private var moving = false
    private var startMs = 0L
    private var belowSinceMs: Long? = null
    private var lastHandMs: Long? = null

    fun onFrame(tMs: Long, landmarks: FloatArray?): Output {
        val frame = Frame(tMs, landmarks)
        buffer.addLast(frame)
        while (tMs - buffer.first().tMs > config.maxMs + config.padMs + config.stopHoldMs) buffer.removeFirst()
        val smoothed = smoothedSpeed(frame)
        prev = frame
        if (landmarks != null) lastHandMs = tMs

        if (!moving) {
            if (smoothed != null && smoothed > config.startSpeed) {
                moving = true
                startMs = tMs
                belowSinceMs = null
            }
            return Output(moving, null)
        }

        val endMs: Long? = when {
            landmarks == null -> lastHandMs?.takeIf { tMs - it > config.stopHoldMs }
            smoothed == null -> null
            smoothed < config.stopSpeed -> {
                val since = belowSinceMs ?: tMs.also { belowSinceMs = it }
                since.takeIf { tMs - it >= config.stopHoldMs }
            }
            else -> {
                belowSinceMs = null
                null
            }
        }
        if (endMs == null) return Output(true, null)
        moving = false
        belowSinceMs = null
        return Output(false, buildSegment(startMs - config.padMs, endMs))
    }

    private fun smoothedSpeed(frame: Frame): Float? {
        val cur = frame.landmarks
        if (cur == null) {
            speeds.clear()
            return null
        }
        val before = prev?.landmarks ?: return null
        val dtSec = (frame.tMs - prev!!.tMs) / 1000f
        val size = handSize(cur)
        if (dtSec <= 0f || size <= 0f) return null
        var moved = 0f
        for (i in 0 until Hand.POINTS) moved += hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
        speeds.addLast(moved / Hand.POINTS / size / dtSec)
        while (speeds.size > 3) speeds.removeFirst()
        return speeds.sum() / speeds.size
    }

    private fun buildSegment(fromMs: Long, toMs: Long): Segment? {
        val duration = toMs - fromMs
        if (duration < config.minMs || duration > config.maxMs) return null
        val frames = buffer.filter { it.tMs in fromMs..toMs }
        if (frames.isEmpty()) return null
        val missing = frames.count { it.landmarks == null }.toFloat() / frames.size
        if (missing > config.maxMissing) return null
        val withHand = frames.mapNotNull { f -> f.landmarks?.let { f.tMs to it } }
        if (withHand.isEmpty()) return null
        return Segment(fromMs, toMs, resample(withHand, fromMs, toMs, config.t))
    }

    companion object {
        private fun handSize(p: FloatArray): Float {
            var max = 0f
            for (i in 1 until Hand.POINTS) max = maxOf(max, hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]))
            return max
        }

        /** Linear interpolation at T evenly spaced times; clamps to the first/last frame at the edges. */
        fun resample(frames: List<Pair<Long, FloatArray>>, fromMs: Long, toMs: Long, t: Int): Array<FloatArray> =
            Array(t) { k ->
                val tk = fromMs + k * (toMs - fromMs).toDouble() / (t - 1)
                val after = frames.indexOfFirst { it.first >= tk }
                when (after) {
                    -1 -> frames.last().second.copyOf()
                    0 -> frames.first().second.copyOf()
                    else -> {
                        val (ta, a) = frames[after - 1]
                        val (tb, b) = frames[after]
                        val w = if (tb == ta) 1f else ((tk - ta) / (tb - ta)).toFloat()
                        FloatArray(a.size) { i -> a[i] + (b[i] - a[i]) * w }
                    }
                }
            }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.MotionSegmenterTest"`
Expected: PASS. `matchesSharedFixture` is reported as skipped until `fixtures/segmenter_case.json` exists.
If an expected timestamp in `emitsOneSegmentForOneMovement` or `handLostEndsSegmentAtLastHandFrame` is off by one frame, re-derive it by hand from the rules at the top of this plan before touching the code. The test numbers encode those rules.

- [ ] **Step 5: When B pushes `fixtures/segmenter_case.json` (~2:30)**

Run: `git pull --rebase && ./gradlew testDebugUnitTest --tests "ph.senya.app.core.MotionSegmenterTest.matchesSharedFixture"`
Expected: PASS. If it fails, compare the first differing segment's `start_ms`/`end_ms` against the clarification list with B. Fix whichever side doesn't follow the agreed rule; don't change the rule silently.

- [ ] **Step 6: Commit**

```bash
git add -A app/src
git commit -m "Android: motion segmenter with shared-fixture test"
git pull --rebase && git push
```

---

### Task 7: Motion letters in the engine and stabilizer

**Files:**
- Modify: `main/java/ph/senya/app/core/PredictionStabilizer.kt`, `core/TranslatorEngine.kt`, `fragment/CameraFragment.kt`
- Test: `test/java/ph/senya/app/core/PredictionStabilizerMotionTest.kt`, modify `test/java/ph/senya/app/core/TranslatorEngineTest.kt`

**Interfaces:**
- Consumes: `MotionSegmenter` (Task 6); `EngineModels.motion`, `EngineModels.config` (Task 4); `NONE_LABEL` (Task 2).
- Produces:
  - `PredictionStabilizer(…, motionMinConfidence: Float = 0.7f, replaceWindowMs: Long = 1000, startShapes: Map<String, List<String>> = emptyMap())`
  - `fun onMotion(nowMs: Long, segmentStartMs: Long, guess: Prediction): StabilizerEvent?`
  - `FrameOutput.moving` and `FrameOutput.motionGuess` are now filled in.

- [ ] **Step 1: Write the failing stabilizer motion tests**

`test/java/ph/senya/app/core/PredictionStabilizerMotionTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PredictionStabilizerMotionTest {
    private var t = 0L

    private fun stabilizer() = PredictionStabilizer(startShapes = mapOf("J" to listOf("I"), "Z" to emptyList()))

    private fun PredictionStabilizer.hold(label: String, n: Int): List<StabilizerEvent> =
        (1..n).mapNotNull { t += 33; onFrame(t, Prediction(label, 0.9f), handPresent = true, moving = false) }

    @Test
    fun noneIsNeverCommitted() {
        assertNull(stabilizer().onMotion(1000, 500, Prediction(NONE_LABEL, 0.99f)))
    }

    @Test
    fun lowConfidenceMotionIgnored() {
        assertNull(stabilizer().onMotion(1000, 500, Prediction("J", 0.5f)))
    }

    @Test
    fun replacesStartShapeCommittedJustBefore() {
        val s = stabilizer()
        assertEquals(listOf(StabilizerEvent.Letter("I")), s.hold("I", 8)) // committed at t = 264
        assertEquals(StabilizerEvent.ReplaceLast("J"), s.onMotion(nowMs = 1500, segmentStartMs = 1000, guess = Prediction("J", 0.9f)))
    }

    @Test
    fun keepsStartShapeCommittedLongBefore() {
        val s = stabilizer()
        s.hold("I", 8) // t = 264
        assertEquals(StabilizerEvent.Letter("J"), s.onMotion(nowMs = 3000, segmentStartMs = 2000, guess = Prediction("J", 0.9f)))
    }

    @Test
    fun doesNotReplaceOtherLetters() {
        val s = stabilizer()
        s.hold("A", 8)
        assertEquals(StabilizerEvent.Letter("J"), s.onMotion(600, 400, Prediction("J", 0.9f)))
    }

    @Test
    fun twoSegmentsGiveTwoLetters() {
        val s = stabilizer()
        assertEquals(StabilizerEvent.Letter("Z"), s.onMotion(1000, 500, Prediction("Z", 0.9f)))
        assertEquals(StabilizerEvent.Letter("Z"), s.onMotion(2500, 2000, Prediction("Z", 0.9f)))
    }

    @Test
    fun startShapeHeldAfterMotionIsNotCommitted() {
        val s = stabilizer()
        t = 1000
        s.onMotion(t, 500, Prediction("J", 0.9f))
        assertEquals(emptyList<StabilizerEvent>(), s.hold("I", 20))
        t += 33
        s.onFrame(t, null, handPresent = false, moving = false)
        assertEquals(listOf(StabilizerEvent.Letter("I")), s.hold("I", 8))
    }

    @Test
    fun otherLetterAllowedRightAfterMotion() {
        val s = stabilizer()
        t = 1000
        s.onMotion(t, 500, Prediction("J", 0.9f))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hold("A", 8))
    }

    @Test
    fun noReplaceAcrossSpace() {
        val s = stabilizer()
        s.hold("I", 8)
        repeat(40) { t += 33; s.onFrame(t, null, handPresent = false, moving = false) } // space committed
        assertEquals(StabilizerEvent.Letter("J"), s.onMotion(t + 100, t, Prediction("J", 0.9f)))
    }
}
```

- [ ] **Step 2: Add the failing engine test**

Append inside `TranslatorEngineTest`:

```kotlin
    private fun line(cx: Float) = FloatArray(Hand.FLOATS).also {
        for (i in 0 until Hand.POINTS) { it[i * 3] = cx + 0.01f * i; it[i * 3 + 1] = 0.5f }
    }

    @Test
    fun motionReplacesStartShape() {
        val engine = TranslatorEngine(EngineModels(
            static = always("I"),
            motion = SequenceClassifier { Prediction("J", 0.9f) },
            config = MotionConfig(),
        ))
        val events = mutableListOf<StabilizerEvent>()
        var sawMoving = false
        for (n in 0 until 60) {
            val cx = 0.3f + 0.03f * (n.coerceIn(14, 34) - 14) // still 15 frames, moving 20, then still
            val out = engine.onFrame(33L * n, line(cx))
            sawMoving = sawMoving || out.moving
            events += out.events
        }
        assertEquals(true, sawMoving)
        assertEquals(listOf(StabilizerEvent.Letter("I"), StabilizerEvent.ReplaceLast("J")), events)
    }

    @Test
    fun staticOnlyModelsNeverReportMoving() {
        val engine = TranslatorEngine(EngineModels(always("I")))
        val moving = (0 until 60).map { n -> engine.onFrame(33L * n, line(0.3f + 0.03f * n)).moving }
        assertEquals(false, moving.any { it })
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.PredictionStabilizerMotionTest" --tests "ph.senya.app.core.TranslatorEngineTest"`
Expected: FAIL to compile (`Unresolved reference: onMotion`, no parameter `startShapes`).

- [ ] **Step 4: Add the motion rules to `PredictionStabilizer.kt`**

Replace the constructor with:

```kotlin
class PredictionStabilizer(
    private val minConfidence: Float = 0.7f,
    private val windowSize: Int = 10,
    private val votesToCommit: Int = 8,
    private val spaceAfterMs: Long = 1000,
    private val motionMinConfidence: Float = 0.7f,
    private val replaceWindowMs: Long = 1000,
    /** Static letters a motion letter starts from (motion_config.json "start_shapes"). */
    private val startShapes: Map<String, List<String>> = emptyMap(),
) {
```

Add fields after `private var outputEmptyOrSpace = true`:

```kotlin
    /** Start shapes of the last motion letter: not committed until another commit or a no-hand frame. */
    private var blocked: Set<String> = emptySet()
    /** The last letter committed, for the start-shape replacement rule; null after a space or an edit. */
    private var lastCommit: Committed? = null

    private class Committed(val label: String, val atMs: Long, val isStatic: Boolean)
```

In `onFrame`, change the commit check and commit:

```kotlin
        if (top.value < votesToCommit || top.key == lastStatic || top.key in blocked) return null
        window.clear()
        lastStatic = top.key
        blocked = emptySet()
        return emit(StabilizerEvent.Letter(top.key), tMs, isStatic = true)
```

Add the motion entry point after `onFrame`:

```kotlin
    /** Call when a motion segment ends and the motion model has classified it. */
    fun onMotion(nowMs: Long, segmentStartMs: Long, guess: Prediction): StabilizerEvent? {
        if (guess.label == NONE_LABEL || guess.confidence < motionMinConfidence) return null
        val shapes = startShapes[guess.label].orEmpty()
        val last = lastCommit
        val replace = last != null && last.isStatic && last.label in shapes &&
            last.atMs >= segmentStartMs - replaceWindowMs
        window.clear()
        lastStatic = null
        blocked = shapes.toSet()
        val event = if (replace) StabilizerEvent.ReplaceLast(guess.label) else StabilizerEvent.Letter(guess.label)
        return emit(event, nowMs, isStatic = false)
    }
```

In `syncWithTranscript`, add `blocked = emptySet()` and `lastCommit = null`.
In `onNoHand`, after `lastStatic = null`, add `blocked = emptySet()`, and change its emit to `return emit(StabilizerEvent.Space, tMs, isStatic = false)`.

Replace `emit` with:

```kotlin
    private fun emit(event: StabilizerEvent, tMs: Long, isStatic: Boolean): StabilizerEvent {
        outputEmptyOrSpace = event is StabilizerEvent.Space
        lastCommit = when (event) {
            is StabilizerEvent.Letter -> Committed(event.label, tMs, isStatic)
            is StabilizerEvent.ReplaceLast -> Committed(event.label, tMs, isStatic)
            is StabilizerEvent.Space -> null
        }
        return event
    }
```

- [ ] **Step 5: Add the segmenter to `TranslatorEngine.kt`**

Replace the class body with:

```kotlin
class TranslatorEngine(models: EngineModels) {
    private val lock = Any()
    private var models = models
    private var stabilizer = newStabilizer(models.config)
    private var segmenter = MotionSegmenter(models.config)

    fun onFrame(tMs: Long, landmarks: FloatArray?): FrameOutput = synchronized(lock) {
        val guess = landmarks?.let { models.static?.classify(it) }
        val motionModel = models.motion
        val seg = if (motionModel != null) segmenter.onFrame(tMs, landmarks) else MotionSegmenter.Output(false, null)
        val motionGuess = seg.segment?.let { motionModel?.classify(it.frames) }
        val events = mutableListOf<StabilizerEvent>()
        if (seg.segment != null && motionGuess != null) {
            stabilizer.onMotion(tMs, seg.segment.startMs, motionGuess)?.let { events += it }
        }
        stabilizer.onFrame(tMs, guess, handPresent = landmarks != null, moving = seg.moving)?.let { events += it }
        FrameOutput(guess, seg.moving, motionGuess, events)
    }

    /** Swaps models and starts fresh. When this returns, no frame is still using the old models. */
    fun setModels(models: EngineModels) = synchronized(lock) {
        this.models = models
        stabilizer = newStabilizer(models.config)
        segmenter = MotionSegmenter(models.config)
    }

    fun onTranscriptEdited(emptyOrEndsWithSpace: Boolean) = synchronized(lock) {
        stabilizer.syncWithTranscript(emptyOrEndsWithSpace)
    }

    private fun newStabilizer(config: MotionConfig) = PredictionStabilizer(
        motionMinConfidence = config.minConfidence,
        replaceWindowMs = config.replaceWindowMs,
        startShapes = config.startShapes,
    )
}
```

- [ ] **Step 6: Run all unit tests**

Run: `./gradlew testDebugUnitTest`
Expected: PASS, including the 9 motion stabilizer tests and both new engine tests; all earlier tests still pass.

- [ ] **Step 7: Show committed motion letters on the guess chip**

In `CameraFragment.kt`, add a field next to `modelLabel`:

```kotlin
    /** While now < this, the chip keeps showing the motion letter just committed. */
    private var motionShownUntilMs = 0L
```

In `onResults`, replace `showGuess(out.staticGuess)` with:

```kotlin
            val now = result.timestampMs()
            if (out.motionGuess != null && out.events.isNotEmpty()) {
                motionShownUntilMs = now + 1000
                showGuess(out.motionGuess)
            } else if (now >= motionShownUntilMs) {
                showGuess(out.staticGuess)
            }
```

- [ ] **Step 8: Check on the phone**

Run: `./gradlew installDebug`
Expected with the dummy model: status line `Model v0` (no "static only"); app runs at ≥ 15 fps; moving the hand quickly and stopping doesn't crash. Random dummy predictions may or may not commit motion letters. Real J/Z checks happen with v2 in Task 11.

- [ ] **Step 9: Commit**

```bash
git add -A app/src
git commit -m "Android: motion letters via segmenter, motion classifier and start-shape rule"
git pull --rebase && git push
```

---

### Task 8: Offline speech

**Files:**
- Create: `main/java/ph/senya/app/core/VoicePicker.kt`, `main/java/ph/senya/app/speech/Speaker.kt`
- Modify: `fragment/CameraFragment.kt`
- Test: `test/java/ph/senya/app/core/VoicePickerTest.kt`

**Interfaces:**
- Produces:
  - `VoicePicker.Option(name, language, country, needsNetwork, installed)`; `VoicePicker.pick(options: List<Option>): Option?`
  - `class Speaker(context: Context, onStatus: (String) -> Unit)` with `speak(text: String)` and `shutdown()`
  - `CameraFragment.speaker: Speaker?`

- [ ] **Step 1: Write the failing test**

`test/java/ph/senya/app/core/VoicePickerTest.kt`:

```kotlin
package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoicePickerTest {
    private fun v(name: String, lang: String, country: String, net: Boolean = false, installed: Boolean = true) =
        VoicePicker.Option(name, lang, country, net, installed)

    @Test
    fun prefersFilipinoPhilippines() {
        val pick = VoicePicker.pick(listOf(v("en-us", "en", "US"), v("fil", "fil", "PH"), v("tl", "tl", "")))
        assertEquals("fil", pick!!.name)
    }

    @Test
    fun acceptsLegacyTagalogCode() {
        assertEquals("tl", VoicePicker.pick(listOf(v("en-us", "en", "US"), v("tl", "tl", "PH")))!!.name)
    }

    @Test
    fun skipsNetworkAndNotInstalledVoices() {
        val pick = VoicePicker.pick(listOf(
            v("fil-net", "fil", "PH", net = true),
            v("fil-missing", "fil", "PH", installed = false),
            v("en-ph", "en", "PH"),
        ))
        assertEquals("en-ph", pick!!.name)
    }

    @Test
    fun englishPhilippinesBeforeOtherEnglish() {
        assertEquals("en-ph", VoicePicker.pick(listOf(v("en-us", "en", "US"), v("en-ph", "en", "PH")))!!.name)
    }

    @Test
    fun nullWhenNothingUsable() {
        assertNull(VoicePicker.pick(listOf(v("ja", "ja", "JP"), v("en-net", "en", "US", net = true))))
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.VoicePickerTest"`
Expected: FAIL to compile (`Unresolved reference: VoicePicker`).

- [ ] **Step 3: Implement**

`main/java/ph/senya/app/core/VoicePicker.kt`:

```kotlin
package ph.senya.app.core

/** Spec §5.2: prefer fil-PH, fall back to English; offline, installed voices only. */
object VoicePicker {
    data class Option(
        val name: String,
        val language: String,
        val country: String,
        val needsNetwork: Boolean,
        val installed: Boolean,
    )

    private val FILIPINO = setOf("fil", "tl")

    fun pick(options: List<Option>): Option? = options
        .filter { !it.needsNetwork && it.installed }
        .mapNotNull { option -> rank(option)?.let { option to it } }
        .minByOrNull { it.second }
        ?.first

    private fun rank(o: Option): Int? = when {
        o.language in FILIPINO && o.country == "PH" -> 0
        o.language in FILIPINO -> 1
        o.language == "en" && o.country == "PH" -> 2
        o.language == "en" -> 3
        else -> null
    }
}
```

`main/java/ph/senya/app/speech/Speaker.kt`:

```kotlin
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.core.VoicePickerTest"`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the Speak button**

In `CameraFragment.kt`, add the import `ph.senya.app.speech.Speaker` and a field:

```kotlin
    private var speaker: Speaker? = null
```

At the end of `onViewCreated(...)`, add:

```kotlin
        speaker = Speaker(requireContext()) { message -> toast(message) }
        binding.speakButton.isEnabled = true
        binding.speakButton.setOnClickListener { speaker?.speak(transcript.text) }
```

In `onDestroyView()`, before `_binding = null`, add:

```kotlin
        speaker?.shutdown()
        speaker = null
```

- [ ] **Step 6: Check on the phone (airplane mode)**

On the phone, download the offline voice in Android Settings → Text-to-speech (Filipino if offered, plus English). Then turn on airplane mode.
Run: `./gradlew installDebug` (over USB; airplane mode doesn't block USB).
Expected: commit a few letters; Speak reads the transcript aloud with airplane mode on. With no offline voice installed, a toast explains how to download one.

- [ ] **Step 7: Commit**

```bash
git add -A app/src
git commit -m "Android: offline text-to-speech with Filipino voice preference"
git pull --rebase && git push
```

---

### Task 9: Model updates, settings, cleartext HTTP

**Files:**
- Create: `main/java/ph/senya/app/data/LatestModel.kt`, `data/ModelUpdater.kt`, `data/ModelRepository.kt`, `main/res/xml/network_security_config.xml`, `main/res/layout/dialog_settings.xml`
- Modify: `main/AndroidManifest.xml`, `main/res/values/strings.xml`, `main/res/layout/fragment_camera.xml`, `fragment/CameraFragment.kt`
- Test: `test/java/ph/senya/app/testutil/TestServer.kt`, `test/java/ph/senya/app/data/ModelUpdaterTest.kt`

**Interfaces:**
- Consumes: `ModelBundle.load`, `DirModelSource`, `AssetModelSource`, `ModelFiles`, `ModelLoadException`, `TfliteModel.fromBytes` (Task 2); `TestModels` (Task 2); `CameraFragment.applyBundle`, `toast`, `modelExecutor` (Task 5); `speaker`, `transcript.lastWord()` (Tasks 3, 8).
- Produces:
  - `LatestModel.parse(json: String): LatestModel`
  - `ModelUpdater(modelsDir: File, modelFactory: (ByteArray) -> ProbabilityModel, fetch: (URL) -> ByteArray = ::httpGet)`
  - `ModelUpdater.check(baseUrl: String, localVersion: Int): ModelUpdater.Result` (`Updated(bundle)` / `UpToDate` / `NoModelPublished` / `Failed(message)`)
  - `ModelUpdater.installedDir(version: Int): File`
  - `fun sha256Hex(bytes: ByteArray): String`
  - `ModelRepository(context)` with `serverUrl`, `speakOnSpace`, `installedVersion`, `loadCurrent(): ModelRepository.Loaded`, `checkForUpdate(): ModelUpdater.Result`

- [ ] **Step 1: Write the test server helper**

`test/java/ph/senya/app/testutil/TestServer.kt`:

```kotlin
package ph.senya.app.testutil

import com.sun.net.httpserver.HttpServer
import java.io.Closeable
import java.io.File
import java.net.InetSocketAddress

/** Serves files under [root] like `python -m http.server`; 404 for anything missing. */
class TestServer(private val root: File) : Closeable {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            val file = File(root, exchange.requestURI.path.trimStart('/'))
            if (file.isFile) {
                val bytes = file.readBytes()
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            } else {
                exchange.sendResponseHeaders(404, -1)
                exchange.close()
            }
        }
        start()
    }

    val baseUrl: String = "http://127.0.0.1:${server.address.port}"
    private var closed = false

    override fun close() {
        if (!closed) server.stop(0)
        closed = true
    }
}
```

- [ ] **Step 2: Write the failing updater tests**

`test/java/ph/senya/app/data/ModelUpdaterTest.kt`:

```kotlin
package ph.senya.app.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.ml.ModelFiles
import ph.senya.app.testutil.TestModels
import ph.senya.app.testutil.TestServer
import java.io.File

class ModelUpdaterTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var root: File
    private lateinit var modelsDir: File
    private lateinit var server: TestServer
    private lateinit var updater: ModelUpdater

    @Before
    fun setUp() {
        root = tmp.newFolder("server")
        modelsDir = tmp.newFolder("models")
        server = TestServer(root)
        updater = ModelUpdater(modelsDir, TestModels.factory)
    }

    @After
    fun tearDown() = server.close()

    /** Publishes version [v] like the platform does (contract §3 item 9). */
    private fun publish(v: Int, withMotion: Boolean = true, sha: String? = null, golden: String = TestModels.staticGolden()) {
        val dir = TestModels.writeFolder(File(root, "models/v$v"), withMotion = withMotion, golden = golden)
        val modelSha = sha ?: sha256Hex(File(dir, ModelFiles.MODEL).readBytes())
        val motion = if (!withMotion) "null" else """{"model_url": "/models/v$v/motion.tflite",
            "labels_url": "/models/v$v/motion_labels.json", "config_url": "/models/v$v/motion_config.json",
            "sha256": "${sha256Hex(File(dir, ModelFiles.MOTION_MODEL).readBytes())}"}"""
        File(root, "api/model").mkdirs()
        File(root, "api/model/latest").writeText("""{"version": $v, "model_url": "/models/v$v/model.tflite",
            "labels_url": "/models/v$v/labels.json", "sha256": "$modelSha", "motion": $motion}""")
    }

    private fun leftovers() = modelsDir.listFiles().orEmpty().filter { it.name.startsWith("tmp") }

    @Test
    fun installsNewVersion() {
        publish(3)
        val result = updater.check(server.baseUrl, localVersion = 0)
        assertTrue(result is ModelUpdater.Result.Updated)
        val bundle = (result as ModelUpdater.Result.Updated).bundle
        assertEquals(3, bundle.version)
        assertNotNull(bundle.motion)
        assertTrue(File(updater.installedDir(3), ModelFiles.MOTION_GOLDEN).isFile)
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun staticOnlyVersion() {
        publish(4, withMotion = false)
        val bundle = (updater.check(server.baseUrl + "/", 0) as ModelUpdater.Result.Updated).bundle
        assertNull(bundle.motion)
    }

    @Test
    fun upToDate() {
        publish(3)
        assertEquals(ModelUpdater.Result.UpToDate, updater.check(server.baseUrl, localVersion = 3))
    }

    @Test
    fun rollbackToOlderVersion() {
        publish(2)
        val result = updater.check(server.baseUrl, localVersion = 3)
        assertEquals(2, (result as ModelUpdater.Result.Updated).bundle.version)
    }

    @Test
    fun noModelPublished() {
        assertEquals(ModelUpdater.Result.NoModelPublished, updater.check(server.baseUrl, 0))
    }

    @Test
    fun checksumMismatchKeepsNothing() {
        publish(3, sha = "0".repeat(64))
        val result = updater.check(server.baseUrl, 0)
        assertTrue(result is ModelUpdater.Result.Failed)
        assertTrue((result as ModelUpdater.Result.Failed).message.contains("checksum"))
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun rejectsVersionThatFailsGolden() {
        publish(3, golden = TestModels.staticGolden(listOf(0.9f to "A")))
        val result = updater.check(server.baseUrl, 0)
        assertTrue((result as ModelUpdater.Result.Failed).message.contains("golden"))
        assertFalse(updater.installedDir(3).exists())
    }

    @Test
    fun missingFileFails() {
        publish(3)
        File(root, "models/v3/labels.json").delete()
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Failed)
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun unreachableServerFails() {
        server.close()
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Failed)
    }

    @Test
    fun badUrlFails() {
        assertTrue(updater.check("not a url", 0) is ModelUpdater.Result.Failed)
    }

    @Test
    fun badJsonFails() {
        File(root, "api/model").mkdirs()
        File(root, "api/model/latest").writeText("<html>")
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Failed)
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.data.ModelUpdaterTest"`
Expected: FAIL to compile (`Unresolved reference: ModelUpdater`, `sha256Hex`).

- [ ] **Step 4: Implement the updater**

`main/java/ph/senya/app/data/LatestModel.kt`:

```kotlin
package ph.senya.app.data

import org.json.JSONObject

/** GET /api/model/latest (contract §3 item 9). */
data class LatestModel(
    val version: Int,
    val modelUrl: String,
    val labelsUrl: String,
    val sha256: String,
    val motion: Motion?,
) {
    data class Motion(val modelUrl: String, val labelsUrl: String, val configUrl: String, val sha256: String)

    companion object {
        /** Throws org.json.JSONException on bad input. */
        fun parse(json: String): LatestModel {
            val o = JSONObject(json)
            val m = o.optJSONObject("motion") // null when missing or JSON null
            return LatestModel(
                version = o.getInt("version"),
                modelUrl = o.getString("model_url"),
                labelsUrl = o.getString("labels_url"),
                sha256 = o.getString("sha256"),
                motion = m?.let {
                    Motion(it.getString("model_url"), it.getString("labels_url"), it.getString("config_url"), it.getString("sha256"))
                },
            )
        }
    }
}
```

`main/java/ph/senya/app/data/ModelUpdater.kt`:

```kotlin
package ph.senya.app.data

import org.json.JSONException
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelFiles
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.ProbabilityModel
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.security.MessageDigest

class HttpStatusException(val code: Int) : IOException("HTTP $code")

fun httpGet(url: URL): ByteArray {
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 3000
    conn.readTimeout = 10000
    try {
        val code = conn.responseCode
        if (code != 200) throw HttpStatusException(code)
        return conn.inputStream.use { it.readBytes() }
    } finally {
        conn.disconnect()
    }
}

fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Downloads, verifies, and installs a published model version (spec §5.2 ModelRepository). No Android imports. */
class ModelUpdater(
    private val modelsDir: File,
    private val modelFactory: (ByteArray) -> ProbabilityModel,
    private val fetch: (URL) -> ByteArray = ::httpGet,
) {
    sealed class Result {
        data class Updated(val bundle: ModelBundle) : Result()
        object UpToDate : Result()
        object NoModelPublished : Result()
        data class Failed(val message: String) : Result()
    }

    fun installedDir(version: Int) = File(modelsDir, "v$version")

    fun check(baseUrl: String, localVersion: Int): Result {
        val base = try {
            URL(baseUrl.trim().trimEnd('/') + "/")
        } catch (e: MalformedURLException) {
            return Result.Failed("bad server URL: $baseUrl")
        }
        val latest = try {
            LatestModel.parse(String(fetch(URL(base, "api/model/latest")), Charsets.UTF_8))
        } catch (e: HttpStatusException) {
            return if (e.code == 404) Result.NoModelPublished else Result.Failed("server error ${e.code}")
        } catch (e: IOException) {
            return Result.Failed("can't reach server (${e.message})")
        } catch (e: JSONException) {
            return Result.Failed("bad response from server")
        }
        if (latest.version == localVersion) return Result.UpToDate

        val tmp = File(modelsDir, "tmp-v${latest.version}")
        try {
            tmp.deleteRecursively()
            if (!tmp.mkdirs()) return Result.Failed("can't write ${tmp.path}")
            for ((name, path) in filesFor(latest)) File(tmp, name).writeBytes(fetch(URL(base, path)))
            checkSha(tmp, ModelFiles.MODEL, latest.sha256)?.let { return Result.Failed(it) }
            latest.motion?.let { m -> checkSha(tmp, ModelFiles.MOTION_MODEL, m.sha256)?.let { return Result.Failed(it) } }
            val bundle = try {
                ModelBundle.load(latest.version, DirModelSource(tmp), modelFactory)
            } catch (e: ModelLoadException) {
                return Result.Failed("model v${latest.version} rejected: ${e.message}")
            }
            val dest = installedDir(latest.version)
            dest.deleteRecursively()
            if (!tmp.renameTo(dest)) {
                bundle.close()
                return Result.Failed("can't install model v${latest.version}")
            }
            return Result.Updated(bundle)
        } catch (e: IOException) {
            return Result.Failed("download failed (${e.message})")
        } finally {
            tmp.deleteRecursively()
        }
    }

    private fun filesFor(latest: LatestModel): List<Pair<String, String>> {
        val files = mutableListOf(
            ModelFiles.MODEL to latest.modelUrl,
            ModelFiles.LABELS to latest.labelsUrl,
            ModelFiles.GOLDEN to sibling(latest.modelUrl, ModelFiles.GOLDEN),
        )
        latest.motion?.let { m ->
            files += ModelFiles.MOTION_MODEL to m.modelUrl
            files += ModelFiles.MOTION_LABELS to m.labelsUrl
            files += ModelFiles.MOTION_CONFIG to m.configUrl
            files += ModelFiles.MOTION_GOLDEN to sibling(m.modelUrl, ModelFiles.MOTION_GOLDEN)
        }
        return files
    }

    /** Golden files live next to the model (plan clarification 6). */
    private fun sibling(url: String, name: String) = url.substringBeforeLast('/') + "/" + name

    private fun checkSha(dir: File, name: String, expected: String): String? {
        val actual = sha256Hex(File(dir, name).readBytes())
        return if (actual.equals(expected, ignoreCase = true)) null else "checksum mismatch for $name"
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./gradlew testDebugUnitTest --tests "ph.senya.app.data.ModelUpdaterTest"`
Expected: PASS (11 tests).

- [ ] **Step 6: Add the repository**

`main/java/ph/senya/app/data/ModelRepository.kt`:

```kotlin
package ph.senya.app.data

import android.content.Context
import ph.senya.app.ml.AssetModelSource
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.TfliteModel
import java.io.File

/** Settings + the installed model version (SharedPreferences) + bundled fallback (spec §5.2, §5.4). */
class ModelRepository(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("senya", Context.MODE_PRIVATE)
    private val updater = ModelUpdater(File(appContext.filesDir, "models"), TfliteModel::fromBytes)

    data class Loaded(val bundle: ModelBundle, val message: String?)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value.trim()).apply()

    var speakOnSpace: Boolean
        get() = prefs.getBoolean(KEY_SPEAK_ON_SPACE, false)
        set(value) = prefs.edit().putBoolean(KEY_SPEAK_ON_SPACE, value).apply()

    val installedVersion: Int get() = prefs.getInt(KEY_VERSION, 0)

    /** The downloaded model if it loads, else the bundled one. Throws only if the bundled model is broken too. */
    fun loadCurrent(): Loaded {
        val v = installedVersion
        var message: String? = null
        if (v != 0) {
            try {
                return Loaded(ModelBundle.load(v, DirModelSource(updater.installedDir(v)), TfliteModel::fromBytes), null)
            } catch (e: ModelLoadException) {
                message = "Model v$v failed to load (${e.message}); using the bundled model"
                prefs.edit().putInt(KEY_VERSION, 0).apply()
            }
        }
        return Loaded(ModelBundle.load(0, AssetModelSource(appContext.assets), TfliteModel::fromBytes), message)
    }

    /** Blocks on the network; call off the main thread. */
    fun checkForUpdate(): ModelUpdater.Result = updater.check(serverUrl, installedVersion).also {
        if (it is ModelUpdater.Result.Updated) prefs.edit().putInt(KEY_VERSION, it.bundle.version).apply()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_SPEAK_ON_SPACE = "speak_on_space"
        private const val KEY_VERSION = "installed_version"
        const val DEFAULT_SERVER_URL = "http://192.168.1.2:8000"
    }
}
```

- [ ] **Step 7: Allow cleartext HTTP and internet**

`main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Demo on the local network: the platform serves plain HTTP (spec §5.2). -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

In `AndroidManifest.xml`, after `<uses-permission android:name="android.permission.CAMERA" />`, add:

```xml
    <uses-permission android:name="android.permission.INTERNET" />
```

And add this attribute to `<application …>`:

```xml
        android:networkSecurityConfig="@xml/network_security_config"
```

- [ ] **Step 8: Add the settings dialog and wire updates**

Strings (inside `<resources>` in `strings.xml`):

```xml
    <string name="settings">Settings</string>
    <string name="server_url">Server URL</string>
    <string name="speak_on_space">Speak each word automatically</string>
    <string name="save">Save</string>
    <string name="check_for_update">Check for update</string>
    <string name="cancel">Cancel</string>
```

`main/res/layout/dialog_settings.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="20dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/server_url" />

    <EditText
        android:id="@+id/server_url"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:importantForAutofill="no"
        android:inputType="textUri" />

    <com.google.android.material.switchmaterial.SwitchMaterial
        android:id="@+id/speak_on_space"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="12dp"
        android:text="@string/speak_on_space" />
</LinearLayout>
```

In `fragment_camera.xml`, inside `top_bar`, after the `model_version` TextView, add:

```xml
            <ImageButton
                android:id="@+id/settings_button"
                android:layout_width="48dp"
                android:layout_height="48dp"
                android:background="?attr/selectableItemBackgroundBorderless"
                android:contentDescription="@string/settings"
                android:src="@android:drawable/ic_menu_preferences" />
```

In `CameraFragment.kt`, add imports:

```kotlin
import androidx.appcompat.app.AlertDialog
import ph.senya.app.core.StabilizerEvent
import ph.senya.app.data.ModelRepository
import ph.senya.app.data.ModelUpdater
import ph.senya.app.databinding.DialogSettingsBinding
```

Add a field:

```kotlin
    private lateinit var repository: ModelRepository
```

In `onViewCreated(...)`, replace `modelExecutor.execute { loadBundledModel() }` with:

```kotlin
        repository = ModelRepository(requireContext())
        binding.settingsButton.setOnClickListener { showSettings() }
        modelExecutor.execute {
            loadCurrentModel()
            checkForUpdate(manual = false)
        }
```

Delete `loadBundledModel()` and add:

```kotlin
    /** Downloaded model, else bundled (spec §5.4). Runs on [modelExecutor]. */
    private fun loadCurrentModel() {
        try {
            val loaded = repository.loadCurrent()
            applyBundle(loaded.bundle)
            loaded.message?.let { toast(it) }
        } catch (e: ModelLoadException) {
            Log.e(TAG, "Bundled model failed to load", e)
            toast("Bundled model failed: ${e.message}")
        }
    }

    /** Runs on [modelExecutor]; on any failure the current model stays (spec §5.2). */
    private fun checkForUpdate(manual: Boolean) {
        when (val result = repository.checkForUpdate()) {
            is ModelUpdater.Result.Updated -> {
                applyBundle(result.bundle)
                toast("Updated to model v${result.bundle.version}")
            }
            is ModelUpdater.Result.UpToDate -> if (manual) toast("Model is up to date")
            is ModelUpdater.Result.NoModelPublished -> if (manual) toast("The server has no published model yet")
            is ModelUpdater.Result.Failed -> toast("Update failed: ${result.message}. Keeping the current model.")
        }
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
```

In `onResults`, replace the `if (out.events.isNotEmpty()) { … }` block with:

```kotlin
            if (out.events.isNotEmpty()) {
                out.events.forEach { transcript.apply(it) }
                renderTranscript()
                if (out.events.any { it is StabilizerEvent.Space } && repository.speakOnSpace) {
                    speaker?.speak(transcript.lastWord())
                }
            }
```

- [ ] **Step 9: Run all tests and check on the phone**

Run: `./gradlew testDebugUnitTest installDebug`
Expected: all tests pass.

Then on the laptop, from the repo root, run `cd fixtures/mock_server && python -m http.server 8000`, and find the laptop's LAN IP (`ipconfig`, IPv4 address). On the phone (same Wi-Fi), open Settings, set `http://<laptop-ip>:8000`, and tap **Check for update**.
Expected: "Model is up to date" (the mock server publishes version 0, same as the bundled model).

To exercise the download path, make a local copy outside the repo and edit `api/model/latest` so `"version": 5`. Serve the copy, and Check for update shows "Updated to model v5" with the status line `Model v5`. Then change one character of `sha256` in the copy and set `"version": 6`: you get "Update failed: checksum mismatch for model.tflite. Keeping the current model." and the status line stays at `Model v5`. Stop the server and relaunch the app: you get the update-failed toast and `Model v5` is still loaded from storage.

- [ ] **Step 10: Commit**

```bash
git add -A app/src
git commit -m "Android: model updates with checksum and golden checks, settings, cleartext HTTP"
git pull --rebase && git push
```

---

### Task 10: Permission screen, fingertip trail, camera flip

**Files:**
- Create: `main/res/layout/fragment_permissions.xml`
- Modify: `fragment/PermissionsFragment.kt`, `OverlayView.kt`, `fragment/CameraFragment.kt`, `main/res/layout/fragment_camera.xml`, `main/res/values/strings.xml`

**Interfaces:**
- Consumes: `FrameOutput.moving` (Task 7); `Hand` (Task 1).
- Produces: `OverlayView.setTrail(points: List<Pair<Float, Float>>)`; view ids `flip_camera_button`, `grant_button`, `explanation`.

- [ ] **Step 1: Add strings**

```xml
    <string name="camera_needed_title">Senya needs the camera</string>
    <string name="camera_needed_body">Senya reads your fingerspelling from the camera. Video is processed on this phone and never leaves it.</string>
    <string name="allow_camera">Allow camera</string>
    <string name="flip_camera">Switch camera</string>
```

- [ ] **Step 2: Permission screen layout**

`main/res/layout/fragment_permissions.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <LinearLayout
        android:id="@+id/explanation"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="center"
        android:gravity="center_horizontal"
        android:orientation="vertical"
        android:padding="32dp"
        android:visibility="gone">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/camera_needed_title"
            android:textSize="22sp"
            android:textStyle="bold" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            android:gravity="center"
            android:text="@string/camera_needed_body"
            android:textSize="16sp" />

        <Button
            android:id="@+id/grant_button"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="24dp"
            android:text="@string/allow_camera" />
    </LinearLayout>
</FrameLayout>
```

- [ ] **Step 3: Replace the body of `PermissionsFragment.kt`** (keep the license header)

```kotlin
package ph.senya.app.fragment

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.Navigation
import ph.senya.app.R
import ph.senya.app.databinding.FragmentPermissionsBinding

private val PERMISSIONS_REQUIRED = arrayOf(Manifest.permission.CAMERA)

/** Spec §5.4: if the camera is denied, explain why and offer to ask again. */
class PermissionsFragment : Fragment() {
    private var _binding: FragmentPermissionsBinding? = null
    private var deniedOnce = false

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                navigateToCamera()
            } else {
                deniedOnce = true
                _binding?.explanation?.visibility = View.VISIBLE
            }
        }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val binding = FragmentPermissionsBinding.inflate(inflater, container, false)
        _binding = binding
        binding.grantButton.setOnClickListener { requestOrOpenSettings() }
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        if (hasPermissions(requireContext())) navigateToCamera()
        else requestPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    override fun onResume() {
        super.onResume()
        // Back from the system settings screen with the permission granted
        if (deniedOnce && hasPermissions(requireContext())) navigateToCamera()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private fun requestOrOpenSettings() {
        if (deniedOnce && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            // "Don't ask again": only the system settings screen can grant it now
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", requireContext().packageName, null)))
        } else {
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun navigateToCamera() {
        lifecycleScope.launchWhenStarted {
            Navigation.findNavController(requireActivity(), R.id.fragment_container)
                .navigate(R.id.action_permissions_to_camera)
        }
    }

    companion object {
        /** Convenience method used to check if all permissions required by this app are granted */
        fun hasPermissions(context: Context) = PERMISSIONS_REQUIRED.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }
}
```

- [ ] **Step 4: Draw the fingertip trail in `OverlayView.kt`**

Add fields after `private var pointPaint = Paint()`:

```kotlin
    /** Index fingertip positions (normalized image coords) while a movement is being recorded. */
    private var trail: List<Pair<Float, Float>> = emptyList()
    private val trailPaint = Paint().apply {
        color = Color.CYAN
        strokeWidth = 10f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
```

Add this method after `clear()`:

```kotlin
    fun setTrail(points: List<Pair<Float, Float>>) {
        trail = points
    }
```

At the end of `draw(canvas)`, after the `results?.let { … }` block, add:

```kotlin
        for (i in 1 until trail.size) {
            val (x0, y0) = trail[i - 1]
            val (x1, y1) = trail[i]
            canvas.drawLine(
                x0 * imageWidth * scaleFactor, y0 * imageHeight * scaleFactor,
                x1 * imageWidth * scaleFactor, y1 * imageHeight * scaleFactor,
                trailPaint
            )
        }
```

- [ ] **Step 5: Feed the trail and add camera flip in `CameraFragment.kt`**

Add fields:

```kotlin
    private val trail = ArrayDeque<Pair<Float, Float>>()
    private var lastMovingMs = 0L
```

In `onResults`, inside `runOnUiThread`, before `binding.overlay.invalidate()`, add:

```kotlin
            if (out.moving && landmarks != null) {
                trail.addLast(landmarks[8 * 3] to landmarks[8 * 3 + 1]) // index fingertip
                while (trail.size > 60) trail.removeFirst()
                lastMovingMs = result.timestampMs()
            } else if (!out.moving && result.timestampMs() - lastMovingMs > 700) {
                trail.clear()
            }
            binding.overlay.setTrail(trail.toList())
```

In `fragment_camera.xml`, inside `top_bar`, before `settings_button`, add:

```xml
            <ImageButton
                android:id="@+id/flip_camera_button"
                android:layout_width="48dp"
                android:layout_height="48dp"
                android:background="?attr/selectableItemBackgroundBorderless"
                android:contentDescription="@string/flip_camera"
                android:src="@drawable/ic_baseline_photo_camera_24" />
```

In `onViewCreated(...)`, add:

```kotlin
        binding.flipCameraButton.setOnClickListener { flipCamera() }
```

Add the method:

```kotlin
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
```

- [ ] **Step 6: Build, test, and check on the phone**

Run: `./gradlew testDebugUnitTest installDebug`
Expected: all tests pass.
- Uninstall first (`adb uninstall ph.senya.app`), reinstall, and deny the camera: the explanation and "Allow camera" button appear, and tapping it asks again. After a second denial with "Don't ask again", the button opens system settings; granting there and returning lands on the camera screen.
- Moving the hand fast draws a cyan trail that disappears ~0.7 s after the movement ends.
- The switch-camera button toggles front and back.

- [ ] **Step 7: Commit**

```bash
git add -A app/src
git commit -m "Android: permission explanation, fingertip trail, camera switch"
git pull --rebase && git push
```

---

### Task 11: Real model, release APK, demo checks, README

**Files:**
- Modify: `android/app/build.gradle`, `android/README.md`, `README.md`
- Update: `android/app/src/main/assets/model/*` (from B's published version)

- [ ] **Step 1: Bundle the real model (spec 5:00–6:00, after B publishes v2)**

With the platform running on the laptop, run from the repo root:
`python android/tools/fetch_bundled_model.py http://<laptop-ip>:8000`
Expected: `Bundled server version 2 (static + motion) into …`.
Then `cd android && ./gradlew installDebug`. Expected: the app starts with `Model v0` (the bundled copy). Once launched with the server reachable, it reports up to date or downloads v2.

- [ ] **Step 2: Sign release builds with the debug key** (fine for a hackathon demo; not for the Play Store)

In `app/build.gradle`, inside `buildTypes { release { … } }`, add:

```groovy
            signingConfig signingConfigs.debug
```

Run: `./gradlew assembleRelease`
Expected: `app/build/outputs/apk/release/app-release.apk` exists. Install it with `adb install -r app/build/outputs/apk/release/app-release.apk`.

- [ ] **Step 3: Run the demo acceptance checks (spec §6) and write down results**

1. Airplane mode: fingerspell 3 short words; each ends up correct with ≤ 1 backspace.
2. Airplane mode: fingerspell "JAZZ", correct with ≤ 1 backspace. A held "I" alone stays "I".
3. Someone not in the training data spells letters, including J and Z. Record accuracy (letters right / letters attempted).
4. A new static sign added on the web reaches the phone without reinstalling (Settings → Check for update) and works offline.
5. Speak produces audio in airplane mode.
6. The status line shows ≥ 15 fps.

If J/Z misfire, tune with B: `start_speed`/`stop_speed` in `motion_config.json` (B publishes a new version), and the I→J window via `replace_window_ms`. No app rebuild is needed; the app picks up the new version.

- [ ] **Step 4: Update `android/README.md`**

Replace the "Build" and "Test against the mock server" sections with:

```markdown
## Build and test
From `android/` (Git Bash): `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
- Unit tests: `./gradlew testDebugUnitTest`
- Install on a phone: `./gradlew installDebug`
- Release APK: `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`

The first build downloads `hand_landmarker.task` into `app/src/main/assets/` (internet once; git-ignored).

## Models
- The bundled model (version 0) lives in `app/src/main/assets/model/`. Refresh it from a running platform or the
  mock server: `python android/tools/fetch_bundled_model.py http://<server>:8000`.
- At launch and on Settings → Check for update, the app downloads the platform's current version into app storage,
  checks sha256 and the golden files, and keeps the current model if anything fails.

## Mock server
`cd fixtures/mock_server && python -m http.server 8000`, then set the app's server URL to `http://<laptop-LAN-IP>:8000`.
```

- [ ] **Step 5: Update the root `README.md` "Running it" section**

```markdown
## Running it
- Android app: install `app-release.apk` from the GitHub release, or build it (see `android/README.md`).
- Platform: see `platform/README.md`.
- Phone and laptop must be on the same Wi-Fi for model updates; translation itself works in airplane mode.
```

- [ ] **Step 6: Commit**

```bash
git add -A app/src/main/assets/model app/build.gradle README.md ../README.md
git commit -m "Android: bundle real model, release signing, README"
git pull --rebase && git push
```
