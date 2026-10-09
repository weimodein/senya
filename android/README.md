# Senya Android app

**Owner: Person A.** Only Person A edits files under `android/`.

Kotlin, CameraX, MediaPipe Tasks Hand Landmarker, TensorFlow Lite. See `docs/2026-10-09-senya-design.md` §5 for the design.

## Origin
Started from [`google-ai-edge/mediapipe-samples`](https://github.com/google-ai-edge/mediapipe-samples) → `examples/hand_landmarker/android`
at commit `9cabe32bfdd0a7457e2cb1d2f29ffcf7dc24195f`, licensed under Apache 2.0 (see `LICENSE-mediapipe-samples`).
Changes at import: `applicationId` → `ph.senya.app`, app name → "Senya", Gradle project name → "Senya". The Kotlin package
(`com.google.mediapipe.examples.handlandmarker`) is unchanged for now.

## Build
Open `android/` in Android Studio, or run `./gradlew assembleDebug`. The first build downloads `hand_landmarker.task` into
`app/src/main/assets/` (needs internet once; the file is git-ignored).

## Test against the mock server
1. `cd fixtures/mock_server && python -m http.server 8000` on the laptop.
2. Set the app's server URL to `http://<laptop-LAN-IP>:8000`.
