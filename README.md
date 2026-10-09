# Senya

**Senya translates Filipino Sign Language fingerspelling into text and speech, entirely on the phone and fully offline.**

AppBuildersPH Hackathon 2026 · Theme: Local AI

> **Owner: Person A.** This README becomes the submission write-up (spec §9). Fill in the TODOs during 6:00–7:00 and the submission block.

## Team
- TODO — Person A (Android)
- TODO — Person B (Platform + ML)

## Why does Senya benefit from running AI locally?
- **Privacy:** the camera sees the signer's face, home, and hands. Frames never leave the phone; only the translated text exists. The platform also discards uploaded videos after extracting landmarks.
- **Works without signal:** Deaf and hard-of-hearing users need to communicate at clinics, offices, and stores, including in places with weak or no mobile data. Senya works in airplane mode.
- **Real time:** on-device inference runs at ≥ 15 fps with no network round trip, so feedback is immediate.
- **No running cost:** no cloud inference bill, so the app can be free.

## Demo
- Demo video: TODO
- X / LinkedIn post: TODO

## What runs locally
- **On the phone:** hand landmark detection (MediaPipe), the static and motion sign classifiers (TFLite), the prediction stabilizer, and text-to-speech.
- **In the browser and on the trainer's computer:** landmark extraction from uploaded clips (browser) and training (Python trainer).

## What requires internet
- Nothing at translation time.
- Downloading new model versions from the deployed server (HTTPS). The app works without it using its bundled model.
- Internet once, beforehand, to download the offline TTS voice and the app's dependencies.

## Disclosures
- **Models used:** MediaPipe Hand Landmarker (`hand_landmarker.task`, Google, pre-trained); Senya's own static classifier (MLP) and motion classifier (1D CNN), trained during the sprint on data the team recorded; Android's built-in offline text-to-speech voices.
- **Technologies and frameworks:** Kotlin, CameraX, MediaPipe Tasks, TensorFlow Lite, Node.js, Express.js, React, PostgreSQL, Python, TensorFlow/Keras.
- **APIs and cloud services:** TODO — name the hosting provider and managed PostgreSQL once chosen; no AI API calls anywhere.
- **Existing code and assets:** `google-ai-edge/mediapipe-samples` hand landmarker Android example (Apache 2.0) as the app's starting point — see `android/README.md`; FSL alphabet reference: TODO (cite it).
- **AI development tools:** Claude Code (design spec, repo setup, coding help); TODO: list any others used.

## Repository layout
| Path | Owner | What |
|---|---|---|
| `android/` | Person A | Android app |
| `platform/` | Person B | Web platform: Express + PostgreSQL backend, React frontend, deployment |
| `ml/` | Person A | Python trainer (Keras → TFLite) and worker |
| `fixtures/` | Person B | Shared test fixtures + mock server |
| `CONTRACT.md` | Both agree, B edits | The app ↔ platform contract |
| `docs/` | — | Design spec |

## Running it
- Android app: build it (see `android/README.md`) or install `app-release.apk` from the GitHub release.
- Platform: see `platform/README.md`.
- Model updates need the internet (the deployed server); translation itself works in airplane mode.

## License
Apache License 2.0 — see `LICENSE` and `NOTICE`. The Android app started from the MediaPipe hand landmarker sample (also Apache 2.0); see `android/README.md`.
