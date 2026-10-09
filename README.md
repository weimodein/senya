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
- **On the laptop:** landmark extraction from uploads, training, and model publishing.

## What requires internet
- Nothing at translation time.
- The local network (no internet) for downloading new model versions from the laptop.
- Internet once, beforehand, to download the offline TTS voice and the app's dependencies.

## Disclosures
- **Models used:** MediaPipe Hand Landmarker (`hand_landmarker.task`, Google, pre-trained); Senya's own static classifier (MLP) and motion classifier (1D CNN), trained during the sprint on data the team recorded; Android's built-in offline text-to-speech voices.
- **Technologies and frameworks:** Kotlin, CameraX, MediaPipe Tasks, TensorFlow Lite, Python, FastAPI, SQLite, TensorFlow/Keras.
- **APIs and cloud services:** none.
- **Existing code and assets:** `google-ai-edge/mediapipe-samples` hand landmarker Android example (Apache 2.0) as the app's starting point — see `android/README.md`; FSL alphabet reference: TODO (cite it).
- **AI development tools:** Claude Code (design spec, repo setup, coding help); TODO: list any others used.

## Repository layout
| Path | Owner | What |
|---|---|---|
| `android/` | Person A | Android app |
| `platform/` | Person B | Web platform: FastAPI backend, pages, training |
| `fixtures/` | Person B | Shared test fixtures + mock server |
| `CONTRACT.md` | Both agree, B edits | The app ↔ platform contract |
| `docs/` | — | Design spec |

## Running it
- Android app: build it (see `android/README.md`) or install `app-release.apk` from the GitHub release.
- Platform: see `platform/README.md`.
- Phone and laptop must be on the same Wi-Fi for model updates; translation itself works in airplane mode.

## License
Apache License 2.0 — see `LICENSE` and `NOTICE`. The Android app started from the MediaPipe hand landmarker sample (also Apache 2.0); see `android/README.md`.
