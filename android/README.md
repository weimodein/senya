# Senya Android app

**Owner: Person A.** Only Person A edits files under `android/`.

Kotlin, CameraX, MediaPipe Tasks Hand Landmarker, TensorFlow Lite. See `docs/2026-10-09-senya-design.md` §5 for the design.

## Origin
Started from [`google-ai-edge/mediapipe-samples`](https://github.com/google-ai-edge/mediapipe-samples) → `examples/hand_landmarker/android`
at commit `9cabe32bfdd0a7457e2cb1d2f29ffcf7dc24195f`, licensed under Apache 2.0 (see `LICENSE-mediapipe-samples`).
Changes at import: the sample's gallery screen and settings sheet were removed, the Kotlin package is now `ph.senya.app`,
`applicationId` is `ph.senya.app`, and the app name is "Senya". `HandLandmarkerHelper.kt`, `OverlayView.kt`,
`CameraFragment.kt` and `PermissionsFragment.kt` still carry the sample's license header.

## Build and test
From `android/` (Git Bash): `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`
- Unit tests: `./gradlew testDebugUnitTest`
- Install on a phone: `./gradlew installDebug`
- Release APK: `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
  (signed with the debug key; fine for a demo, not for the Play Store)

The first build downloads `hand_landmarker.task` into `app/src/main/assets/` (internet once; git-ignored).
Xiaomi phones need Developer options → "Install via USB" turned on before `installDebug` works.

## Models
- The app downloads models from the deployed platform, https://senya-k2wd.onrender.com, over HTTPS. To build against
  another server, set `senya.serverUrl=https://…` in `android/local.properties` or pass `-Psenya.serverUrl=…`.
- The bundled model (version 0) lives in `app/src/main/assets/model/`. Refresh it from a running platform or the
  mock server: `python android/tools/fetch_bundled_model.py http://<server>:8000`.
- At launch and on Settings → Check for update, the app downloads the platform's current version into app storage,
  checks sha256 and the golden files, and keeps the current model if anything fails.
- With no bundled model the app shows "No model loaded".

## First launch

The app shows a four-step onboarding flow before opening the camera: welcome, camera permission, offline voice, and readiness. Camera access is requested only when the user taps **Allow camera**; skipping it lets them review the remaining steps, but they must grant it before signing. The voice step lists installed offline Filipino or English voices, lets the user test and select one, and links to device voice settings. The selected voice is reused in the camera screen.

The readiness screen checks the actual local model and voice state, lists the letters the model knows, and downloads the published model if the phone is online. The bundled v0 model in this checkout is a demo fixture, not evidence of FSL recognition. Once onboarding is complete, later launches go straight to the camera, or to the permission explanation if camera access was revoked.

## Mock server
`cd fixtures/mock_server && python -m http.server 8000`, then in a **debug** build open Settings (the gear icon) and
set the server override to `http://<laptop-LAN-IP>:8000`. Debug builds allow plain HTTP (`src/debug/`); release builds
ignore the override and only use HTTPS.
