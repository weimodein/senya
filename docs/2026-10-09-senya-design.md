# Senya — FSL Fingerspelling Translator — Design Spec

- **Date:** 2026-10-09 (revised: added the motion letters J and Z with a sequence model; added hackathon fit and submission)
- **Event:** AppBuildersPH Hackathon 2026, theme **Local AI**. Submission deadline **10:00 AM, October 10**, no extensions.
- **Team:** 2 people, working remotely from different places (Person A: Android + ML, Person B: web platform; see §0)
- **Time box:** one 8-hour sprint plus a 1-hour submission block (§9)

## 0. Stack and deployment (revised 2026-10-09 evening — supersedes any conflicting text below)

The team works remotely and will **deploy the web platform**, so the earlier "laptop on the local network" design is replaced. Decisions:

| Area | Decision |
|---|---|
| Android app | Kotlin (unchanged) |
| Web | **PostgreSQL, Express.js, React, Node.js**, deployed to a public HTTPS host (host chosen by Person B) |
| Machine learning | **Python 3 + TensorFlow/Keras**, exported to TFLite, in a separate trainer under `ml/` |
| A↔B contract | **Unchanged** (§3): same endpoints, files and formats. Only the server's address changes (an HTTPS URL, set in the app's Settings; the default is changed once the host exists) |

What this changes, section by section:

1. **Landmark extraction runs in the browser, not on the server.** The React page runs `@mediapipe/tasks-vision` (WebAssembly) on the chosen images/videos, and for motion signs runs the §3 segmenter (a JavaScript port). It uploads **only landmarks** (63-float frames, plus timestamps for motion), never the video. This removes Python from the server, keeps uploads tiny, and means the signer's face never leaves their computer. Replaces the "FastAPI BackgroundTask" extraction in §4.2; the `no_hand_frames` and `segments_found` counts are now reported by the client. Thumbnails are optional small JPEG data URLs made in the browser and stored in the row.
2. **Training runs in a Python "trainer", not in Express.** The deployed server never needs TensorFlow. Clicking **Train** adds a job to a `train_jobs` table. The trainer runs as a worker (`python -m ml.worker`) on a developer's laptop (or a bigger machine) and polls the server for jobs with an admin token. It downloads the training data, trains both models, checks TFLite against Keras (§4.3), then uploads the finished files with `POST /api/models` and reports progress. The trainer follows §4.3 (model definitions, split by upload, augmentation, report) unchanged.
3. **Model files are stored in PostgreSQL** (`bytea`, they are only tens of KB) and served by Express at the same `/models/v{n}/*` URLs. The host therefore needs no persistent disk, and a redeploy never loses a model.
4. **Authentication.** A public server must not let strangers upload, train, publish or delete. Every write endpoint requires a single admin token (`Authorization: Bearer …`, kept in an environment variable). Only these stay public, because the app uses them: `GET /api/model/latest` and `GET /models/v{n}/*`.
5. **Ownership.** The app tasks are mostly done, so **Person A also owns the ML trainer** (`ml/`) and Person B owns the web platform (`platform/`: Express, React, PostgreSQL, deployment). Person B no longer needs Python.
6. **Shared tests.** `fixtures/segmenter_case.json` is now exercised by **three** implementations: the JavaScript segmenter (web), the Kotlin segmenter (app), and the Python resampling step (trainer).
7. **Data collection** is remote: both of you upload clips through the deployed web page from wherever you are. This replaces the in-person "record and upload" slot in §7.2.
8. **Submission wording** (§9): model downloads now need internet (an HTTPS server). Translation itself still works in airplane mode, and the first model is bundled in the APK.

Everything below that mentions FastAPI, SQLite, Python on the server, or a laptop/LAN should be read with these changes applied. The §7.2 schedule rows keep their times; read "FastAPI + SQLite" as "Express + PostgreSQL", and the Python-segmenter/training rows as the JS segmenter (B) and the Python trainer (A).

## 1. Goal

**Senya** is an Android app that recognizes **Filipino Sign Language (FSL) alphabet letters** from the camera and turns them into text and speech, **fully offline**. It handles letters that are held still (static) and letters that are drawn in the air (motion: **J** and **Z**). A separate web platform handles data, training, and publishing models. The mobile app does translation only.

### Why local AI (the hackathon question)
- **Privacy:** the camera sees the signer's face, home, and hands. Frames never leave the phone; only the translated text exists. The platform also discards uploaded videos after extracting landmarks.
- **Works without signal:** Deaf and hard-of-hearing users need to communicate at clinics, offices, and stores, including in places with weak or no mobile data. Senya works in airplane mode.
- **Real time:** fingerspelling is fast. On-device inference runs at ≥ 15 fps with no network round trip, so feedback is immediate.
- **No running cost:** no cloud inference bill, so the app can be free.

### In scope
- Sign → text/speech (camera → letters → words → speech)
- **Static letters:** FSL alphabet letters that are held still, plus any word that is a single held handshape
- **Motion letters:** **J** and **Z**, plus **Ñ** and **NG** if the FSL reference confirms they involve motion (hour 0 check). These use the same pipeline, so they need data but no new code.
- Web platform: manage static and motion signs, upload images/videos, train, publish model versions
- The app downloads new models when online and runs fully offline after that

### Out of scope (this sprint)
- Motion signs beyond the alphabet (everyday words). The platform supports them (`kind = 'motion'`), but we won't collect data for them this sprint.
- Two-handed signs, and recognizing continuous sentences
- Text/speech → sign
- User accounts (a single admin token protects the platform's write endpoints, see §0)
- iOS
- Recording in the browser with a webcam (replaced by uploads)

## 2. Architecture

```
┌─────────── Senya web platform (deployed) ────────────┐        ┌────── Senya Android app ──────┐
│ Browser (React): manage signs → pick files           │        │ CameraX → MediaPipe landmarks │
│   MediaPipe (web) extracts landmarks/segments        │        │  ├→ static TFLite classifier  │
│ Express + PostgreSQL: store data, serve models       │ models │  └→ MotionSegmenter           │
│ Python trainer → Keras → 2× TFLite → [Publish]       │        │       → motion TFLite         │
│                                                      │        │  → PredictionStabilizer       │
│                                                      │ ─────► │  → transcript + offline TTS   │
└──────────────────────────────────────────────────────┘        └───────────────────────────────┘
```

All AI inference on the phone runs on the device: MediaPipe hand landmarks, both TFLite classifiers, and text-to-speech. Only model distribution touches the network: the deployed server stores the training landmarks and serves finished models, and translation never needs it.

Monorepo layout (a **public GitHub repository**, required for submission):
```
senya/
  README.md        # Person A — submission info + disclosures (section 9)
  CONTRACT.md      # Person B types it, both agree — the A↔B contract (section 3), frozen after hour 0
  fixtures/        # Person B — shared test fixtures + mock server (section 3, items 11–12); A only reads
  android/         # Person A only
  platform/        # Person B only (Express + PostgreSQL backend, React frontend, deployment, platform/README.md)
  ml/              # Person A only (Python trainer: Keras → TFLite, worker that polls the server, ml/README.md)
  docs/            # this spec
```

### 2.1 Working in parallel

The plan is built so neither person ever edits the other's files or sits idle waiting for the other.

**Ownership: one owner per path.** Only the owner edits a path. Anyone may read anything.

| Path | Owner | Notes |
|---|---|---|
| `android/` | A | Includes the bundled model in `android/app/src/main/assets/model/` (A downloads it from the platform) |
| `platform/` | B | Includes `platform/README.md`, where B writes the platform facts A needs for the root README |
| `ml/` | A | Python trainer and worker (§0); starts after the app tasks, uses `fixtures/` for tests |
| `fixtures/` | B | Dummy models, golden files, segmenter fixture, mock server |
| `README.md` | A | Built from §9 and `platform/README.md` |
| `CONTRACT.md` | B types, both agree | Frozen after hour 0 (see below) |
| `docs/` | nobody during the sprint | |

**Git workflow**
- Both commit straight to `main`, only inside their own paths, and run `git pull --rebase` before every push. With no shared files, rebases never conflict.
- Commit small and often (at least every hour).
- `.gitignore` covers runtime data and secrets: `.env` files (database URL, admin token), `node_modules/`, build output, and the trainer's downloaded datasets and virtual environment. Never commit the admin token.

**Changing the contract**
- Raise the change out loud. Both agree, B edits `CONTRACT.md` and bumps the `Contract version: n` line at its top, and both pull.
- Don't make changes in the middle of an hour unless one of you is blocked. Each of you works around the issue until the next handoff.

**No waiting:** each person works against stand-ins until the other person's real piece is ready:

| A needs | Stand-in until it's ready | Real one arrives |
|---|---|---|
| Static model + labels | `fixtures/mock_server/` dummy model (random weights, correct shapes) | v1 at ~4:00 |
| Motion model + labels + config | `fixtures/mock_server/` dummy motion model + `motion_config.json` | v2 at ~5:00 |
| Golden files | Dummy `golden.json` / `motion_golden.json` made by running the dummy models | With v1 / v2 |
| `GET /api/model/latest` + file downloads | `python -m http.server` in `fixtures/mock_server/` (§3, item 12) | Real platform at ~4:00 (polished by 6:00) |
| Segmenter test data | Nothing needed before 4:00 | `fixtures/segmenter_case.json` at 2:30 |

| B needs | Stand-in until it's ready | Real one arrives |
|---|---|---|
| Training data | B's own test clips recorded on a phone in hour 0 | Joint recording at 2:30–3:00 |
| Proof the app reads the models | The TFLite-vs-Keras check in the training pipeline | A's golden-file test, at 7:00 end-to-end |

## 3. Contract between the app and the platform

Both people agree to this in hour 0 and copy it into `CONTRACT.md`. Changing it requires agreement from both.

### Static model
1. **Landmarks:** MediaPipe Hand Landmarker, 1 hand, **normalized image landmarks** (not world landmarks). 21 points × (x, y, z), flattened in point order to **63 raw floats**: `[x0, y0, z0, x1, y1, z1, …]`.
2. **Normalization is inside the model.** Neither Kotlin nor Python preprocessing normalizes the landmarks. The model's first layers subtract the wrist (point 0) and divide by hand size.
3. **Model:** `model.tflite`, input `float32[1, 63]`, output `float32[1, N]` softmax probabilities.
4. **Labels:** `labels.json` is a JSON array of strings, and index `i` matches output index `i`. Example: `["A", "B", "C"]`.

### Motion model
5. **Model:** `motion.tflite`, input `float32[1, 32, 63]` (32 frames of raw landmarks, same per-frame format as item 1), output `float32[1, M]` softmax. Labels are in `motion_labels.json`. The label `_none` is reserved and means "movement that isn't a motion sign" (e.g. moving between static letters). It is never committed.
6. **Normalization is inside the model.** The model subtracts **frame 0's wrist** from every point in every frame and divides by **frame 0's hand size** (largest distance from the wrist). This keeps the path of the movement and removes position and distance from the camera.
7. **Segmentation and resampling** happen outside the model, so both sides implement them **exactly** like this, using parameters from `motion_config.json`:
   - **Hand size** `s_t` = the largest distance in (x, y) from point 0 to any other point in frame `t`.
   - **Speed** `v_t` = (mean over the 21 points of the (x, y) distance moved since the previous frame) ÷ `s_t` ÷ seconds elapsed. Then smooth it by averaging the last 3 values. A frame with no hand has no speed.
   - **A segment starts** when the smoothed speed rises above `start_speed`. **It ends** when the speed stays below `stop_speed` for `stop_hold_ms`, or when no hand is seen for more than `stop_hold_ms`.
   - The segment covers `[start − pad_ms, end]`. Keep it only if its length is between `min_ms` and `max_ms`, and at most `max_missing` of its frames have no hand.
   - **Resample** the segment to `T = 32` frames at evenly spaced times from start to end (`t_k = start + k·(end − start)/31`), linearly interpolating each of the 63 floats between the nearest frames that have a hand.
8. **`motion_config.json`** is published with every version, and the app uses the published values:
   ```json
   {"T": 32, "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200, "pad_ms": 150,
    "min_ms": 300, "max_ms": 2500, "max_missing": 0.25, "min_confidence": 0.7,
    "replace_window_ms": 1000, "start_shapes": {"J": ["I"], "Z": []}}
   ```
   Speeds are in hand sizes per second. The starting values are guesses; tune them in hours 6–7. `start_shapes` is explained in §5.2.

### Distribution
9. **Latest model endpoint:** `GET /api/model/latest` →
   ```json
   {"version": 3,
    "model_url": "/models/v3/model.tflite", "labels_url": "/models/v3/labels.json", "sha256": "<hex of model.tflite>",
    "motion": {"model_url": "/models/v3/motion.tflite", "labels_url": "/models/v3/motion_labels.json",
               "config_url": "/models/v3/motion_config.json", "sha256": "<hex of motion.tflite>"}}
   ```
   `motion` is `null` if the version has no motion model; the app then translates static letters only. URLs are relative to the server base URL. Returns 404 if no model has been published.
10. **Golden files:** every published version includes `golden.json` (`[{"landmarks": [63 floats], "label": "A"}, …]`, about 20 static validation samples) and, if it has a motion model, `motion_golden.json` (`[{"frames": [[63 floats] × 32], "label": "J"}, …]`, about 10 samples that have already been resampled). The app's classifiers must predict these labels.
11. **Segmenter fixture:** `fixtures/segmenter_case.json` holds a raw recorded landmark stream (`[{"t_ms": …, "landmarks": [63 floats] | null}, …]`), a config, the expected segment boundaries, and the expected resampled 32 × 63 output. Both the Python and Kotlin segmenter tests must reproduce it (to within 1e-4). Person B generates it by 2:30, from a test clip recorded in hour 0, using the Python segmenter. A builds the Kotlin segmenter from the written rules in item 7, not by reading B's code, so the fixture actually checks that both match the contract.
12. **Mock server:** `fixtures/mock_server/` is laid out so that `python -m http.server 8000` run inside it serves the contract's endpoints exactly: `api/model/latest` (a file containing the item 9 JSON for version 0, with real sha256 values) and `models/v0/` containing the dummy `model.tflite`, `labels.json`, `golden.json`, `motion.tflite`, `motion_labels.json`, `motion_config.json`, and `motion_golden.json`. B generates all of it with `platform/tools/make_dummy_models.py`. To test rollback and failure handling, A can edit a local copy (change the version, break the sha256).

## 4. Web platform (Person B)

**Stack:** Node.js, Express.js, PostgreSQL, React, `@mediapipe/tasks-vision` (in the browser). Deployed to a public HTTPS host. Training is done by the Python trainer in `ml/` (§0), not by this server.

### 4.1 Data model (PostgreSQL; `JSON` columns below are `JSONB`, `bytea` for files; add a `train_jobs` table: `id`, `status`, `progress`, `error`, `model_version`, `created_at`, plus a `model_files` table: `version`, `name`, `content` bytea)

| Table | Fields | Notes |
|---|---|---|
| `signs` | `id`, `label` (unique), `kind` (`'static'` / `'motion'`), `start_shapes` (JSON, motion only), `created_at` | The motion sign `_none` is created automatically and can't be deleted |
| `uploads` | `id`, `sign_id`, `filename`, `status` (`pending`/`processing`/`done`/`failed`), `samples_added`, `segments_found`, `no_hand_frames`, `error`, `created_at` | Deleting an upload deletes its samples/sequences |
| `samples` | `id`, `sign_id`, `upload_id`, `landmarks` (63 floats, JSON), `handedness`, `frame_index` (null for images), `thumb_path` | Static signs only. Original files are not kept; only landmarks + small thumbnail |
| `sequences` | `id`, `sign_id`, `upload_id`, `frames` (JSON: `[{"t_ms", "landmarks" or null}]`, raw, not resampled), `duration_ms`, `handedness`, `thumb_path` | Motion signs only. One row per detected segment. Stored raw so segmenter/resampling settings can change without uploading again |
| `models` | `version`, `labels` (JSON), `val_accuracy`, `per_class_report` (JSON), `motion_labels` (JSON, nullable), `motion_val_accuracy`, `motion_report` (JSON), `is_current` (bool), `created_at` | One row per training run; at most one row has `is_current = true` |

### 4.2 Upload processing
- Runs **in the browser** (§0): the React page extracts landmarks (and, for motion signs, segments) and uploads only landmark JSON. The server validates it (63 floats per frame, sane counts) and inserts the rows. Progress is shown by the page itself.
- **Static signs:**
  - **Image** → 1 sample if a hand is detected.
  - **Video** → one frame every 0.1 s, skipping the first and last 0.5 s; 1 sample per frame with a hand.
- **Motion signs:**
  - Images are rejected (400).
  - **Video** → every frame (capped at 30 fps), with timestamps from the video, run through the §3 segmenter. Each kept segment becomes one `sequences` row. Record **many repetitions per clip with a short pause between each**, so one 30 s clip gives about 15 segments.
  - Uploads to `_none`: clips of fingerspelling static letters, hands entering and leaving the frame, and random hand movement. Every segment found is a `_none` example.
- Frames with no hand detected are counted in `no_hand_frames`, not stored.
- **Zip import (stretch):** one folder per label (`A/…`, `B/…`); creates missing signs as static; each file is processed as above.

### 4.3 Training (`POST /api/train`, executed by the Python trainer in `ml/`)
`POST /api/train` queues a job; the trainer worker picks it up. Only one training job runs at a time; a second request returns 409. One run trains both models and produces one version.

**Static model**
1. Include static signs with **≥ 30 samples**. Report the signs that were skipped.
2. **Split train/validation by upload, not by frame** (about 80/20 per sign). If a sign has only one upload, fall back to a random split for that sign and add a warning to the report.
3. **Augment the training set:** mirror x for every sample (so either hand works), plus small random rotation (±15°), scale (±10%), and Gaussian noise.
4. **Model:** `Input(63)` → `Reshape(21,3)` → normalization layers (subtract point 0; divide by the largest distance from the wrist) → `Flatten` → `Dense(128, relu)` → `Dropout(0.3)` → `Dense(64, relu)` → `Dense(N, softmax)`. Adam optimizer, early stopping on validation loss.

**Motion model** (skipped, with `motion = null`, unless at least one motion sign besides `_none` qualifies)
1. Include motion signs with **≥ 3 sequences from ≥ 3 uploads**; `_none` needs **≥ 6** (single-take clips: one movement per clip, raise/lower harvested into `_none`). Report the signs that were skipped.
2. Resample every sequence to 32 frames (§3, item 7). Split by upload as above.
3. **Augment:** mirror x for the whole sequence, rotation (±15°), scale (±10%), noise, **time warp** (random smooth change in speed, ±20%), and **boundary jitter** (move the start/end by up to ±100 ms before resampling, to simulate segmenter differences).
4. **Model:** `Input(32, 63)` → `Reshape(32,21,3)` → normalization (§3, item 6) → `Reshape(32,63)` → `Conv1D(64, 5, relu)` → `Conv1D(64, 5, relu)` → `MaxPool1D(2)` → `Conv1D(128, 3, relu)` → `GlobalMaxPool1D` → `Dense(64, relu)` → `Dropout(0.3)` → `Dense(M, softmax)`. Use Conv1D, not LSTM/GRU, because it converts to TFLite reliably. Adam, early stopping.

**Both**
5. **Export** each to TFLite, then run the `.tflite` file on its validation set and check its predictions match Keras. If either doesn't match, the version fails.
6. **Report:** overall validation accuracy, accuracy per class, and the most-confused label pairs, for each model. For motion, also report how often real signs were classified as `_none` and the reverse.
7. Save `models/v{n}/model.tflite`, `labels.json`, `golden.json`, and if trained `motion.tflite`, `motion_labels.json`, `motion_config.json`, `motion_golden.json`; insert a `models` row with `is_current = false`.

### 4.4 Publishing
- Exactly one version is **current** at a time (`models.is_current`). Clicking **Publish** on a version makes it current; `GET /api/model/latest` returns the current version.
- Rolling back = clicking Publish on an older version. The app picks this up because it downloads whenever the current version differs from its own (§5.2).
- `motion_config.json` is written from the platform's settings at training time. Editing a sign's `start_shapes` takes effect in the next version.

### 4.5 API
```
GET/POST/DELETE  /api/signs                   POST takes {label, kind, start_shapes?}
PATCH            /api/signs/{id}              edit start_shapes
POST             /api/signs/{id}/uploads      multipart, images and/or videos
POST             /api/import-zip              (stretch)
GET/DELETE       /api/uploads/{id}
GET              /api/signs/{id}/samples      thumbnails for review (static)
GET              /api/signs/{id}/sequences    thumbnails for review (motion)
DELETE           /api/sequences/{id}          remove a bad segment (stretch)
POST             /api/train
GET              /api/train/status
GET              /api/models
POST             /api/models/{version}/publish
GET              /api/model/latest            see §3, item 9
GET              /models/v{n}/*               static files
```

### 4.6 Pages
1. **Signs:** list with kind and sample/segment counts, add sign (choose static or motion), delete sign.
2. **Sign detail / Upload:** upload files, upload status (samples or segments found), thumbnail grid, delete an upload. For motion signs: edit `start_shapes`.
3. **Train & Publish:** Train button, progress, report for both models, list of versions with Publish buttons.

## 5. Android app (Person A)

**Stack:** Kotlin, CameraX, MediaPipe Tasks Hand Landmarker (LIVE_STREAM, 1 hand), TensorFlow Lite Interpreter. minSdk 24.
**Starting point:** `google-ai-edge/mediapipe-samples` → `examples/hand_landmarker/android`.

### 5.1 Per-frame pipeline
```
CameraX frame → HandLandmarker → (t_ms, 63 raw floats | no hand)
  ├→ SignClassifier ───────────────────────────→ static (label, confidence)
  └→ MotionSegmenter → [segment ends] → MotionClassifier → motion (label, confidence)
       → PredictionStabilizer (also told "hand is moving") → committed letters / spaces
       → Transcript UI → Speaker
```

### 5.2 Components
- **`SignClassifier`**: loads `model.tflite` + `labels.json` from a folder; `classify(FloatArray(63)): Prediction(label, confidence)`. Runs in the MediaPipe result callback.
- **`MotionSegmenter`** (pure Kotlin, no Android imports): implements §3, item 7, with values from `motion_config.json`. `onFrame(tMs, landmarks?)` returns whether the hand is moving and, when a segment ends, the resampled `32 × 63` input.
- **`MotionClassifier`**: loads `motion.tflite` + `motion_labels.json`; `classify(Array(32) { FloatArray(63) }): Prediction`. Runs once per segment, not every frame, so its cost is negligible.
- **`PredictionStabilizer`** (pure Kotlin, no Android imports):
  - **Static:**
    - Ignores predictions with confidence < **0.7**.
    - **Ignores frames where the segmenter reports the hand is moving.** They don't count toward the window.
    - Commits a label when it is the top label in **8 of the last 10** frames.
    - Commits the same label again only after a different label has been committed or no hand has been seen (handles double letters).
  - **Motion:**
    - Commits a motion label when its confidence is ≥ `min_confidence` and it isn't `_none`.
    - Each segment is a separate event, so "ZZ" is two segments.
  - **Start shapes:** J starts with the I handshape, so "I" may be committed before the movement begins. When a motion label `L` is committed, if the last committed letter is in `start_shapes[L]`, was committed within `replace_window_ms` before the segment started, and nothing has been committed since, that letter is **replaced** by `L`. Otherwise `L` is added.
  - **Spaces:** emits a **space** after **~1 s** with no hand, once per gap, and never as the first output or right after another space.
  - Thresholds are constructor parameters so they can be tuned.
- **`ModelRepository`**:
  - A bundled model in `assets/model/` is version 0 and is always available. It includes the motion files once a motion model exists (hour 5).
  - On launch and when the user taps "Check for update": if online, call `/api/model/latest`. If `version` differs from the local one (newer, or older after a rollback), download every file to temporary files, check both sha256 values, move them into `filesDir/models/v{n}/`, save the version in SharedPreferences, and swap the classifiers and segmenter config while the app runs.
  - If `motion` is `null`, run static-only.
  - On any failure: keep the current model and show a toast.
  - Server base URL comes from settings.
  - `network_security_config` allows cleartext HTTP (demo on the local network).
- **`Speaker`**: Android `TextToSpeech`. Prefer `fil-PH`, fall back to English; only use voices where `isNetworkConnectionRequired == false`.

### 5.3 UI (single screen)
- Camera preview with the landmark overlay. While a segment is being recorded, draw the fingertip trail so the signer can see the movement was captured.
- "Current guess" chip: label + confidence bar. Shows the motion label briefly when one is committed.
- Transcript text.
- Buttons: **Speak**, **Backspace**, **Clear**. Optional: speak each word automatically when a space is committed.
- Model version label (shows "static only" if there is no motion model); settings (server URL, Check for update).
- Small "Offline · on-device" badge, which is useful for the demo video.

### 5.4 Error states
- Camera permission denied → explanation + button to request permission again.
- No hand detected → "Show your hand to the camera" hint.
- Downloaded model fails to load → go back to the bundled model.
- Motion model fails to load → continue static-only and show a toast.

### 5.5 Performance target
≥ 15 fps end-to-end on the demo phone. The segmenter is cheap math per frame, and the motion model runs only when a segment ends.

## 6. Testing

- **Kotlin unit tests:**
  - `PredictionStabilizer`: commits after 8/10; low-confidence frames are ignored; moving frames are ignored; double letters need a reset; a space is emitted after a no-hand gap, only once; `_none` is never committed; "I" followed within the window by J becomes "J"; "I" committed long before J stays and J is added; "ZZ" from two segments gives two Z's.
  - `MotionSegmenter`: reproduces `fixtures/segmenter_case.json` (boundaries and resampled output).
- **Python tests:**
  - Both normalization layers give the same output when the hand (or the whole sequence) is moved or scaled in the image.
  - The split puts no upload in both the training and validation sets.
  - The segmenter reproduces `fixtures/segmenter_case.json`.
  - TFLite and Keras predictions match for both models (built into the pipeline).
- **Golden-file test:** the app runs the published `golden.json` through `SignClassifier` and `motion_golden.json` through `MotionClassifier`; every label must match. Run it whenever a new model version is used.
- **Demo acceptance checks:**
  1. Airplane mode: fingerspell 3 short words; each ends up correct with ≤ 1 backspace.
  2. Airplane mode: fingerspell **"JAZZ"**; correct with ≤ 1 backspace. A held "I" alone stays "I".
  3. Someone not in the training data spells letters, including J and Z; record the accuracy.
  4. A new static sign added on the web reaches the phone without reinstalling and works offline.
  5. Speak produces audio in airplane mode (offline voice downloaded beforehand).
  6. ≥ 15 fps on the demo phone.

## 7. Sprint schedule

### 7.1 Before the sprint (setup only, no feature code)
So that hour 0 is spent on decisions, not installs:
- **Both:** GitHub accounts with access to the repo; agree on a team chat for "pushed X" messages.
- **A:** Android Studio installed; `mediapipe-samples` hand landmarker app built and running on the demo phone once; `hand_landmarker.task` downloaded; offline TTS voice (Filipino if available, plus English) downloaded on the demo phone.
- **B:** Node.js, a PostgreSQL database (local or hosted), and a hosting account chosen and ready to deploy to (§0). **A:** Python with TensorFlow and MediaPipe installed and importable for `ml/` (TensorFlow is the slow install).

### 7.2 Schedule

**0:00–0:30 (both):**
- Write `CONTRACT.md`, including the motion parts. B types; both read and agree.
- With an FSL reference or signer, confirm which letters are static and which involve motion (J, Z, and check Ñ and NG).
- **Already done before the sprint (by A):** monorepo folders, draft `CONTRACT.md` (§2.1 + §3), per-folder `.gitignore` files, root `README.md` skeleton, and the MediaPipe sample imported into `android/`. In hour 0, B reviews and finalizes `CONTRACT.md` (ticks both boxes, removes "DRAFT") and clones the repo.
- B records a few test clips on a phone (a few static letters, a few J/Z reps), used for the segmenter fixture and B's early testing.

Each column below only touches its owner's paths (§2.1). **Bold** items in a cell are handoffs: the receiver doesn't wait for them, and the "Stand-in" column of §2.1 says what they use until then.

| Time | Person A (Android) — `android/`, `README.md` | Person B (Platform + ML) — `platform/`, `fixtures/` |
|---|---|---|
| 0:30–1:30 | Strip the sample's extra UI; read out the 63 floats + timestamps per frame; log them | `make_dummy_models.py` → **`fixtures/mock_server/` pushed by 1:00**; then FastAPI + SQLite setup, signs CRUD (static/motion) |
| 1:30–2:30 | `SignClassifier` against the dummy model from `fixtures/`, current-guess chip, golden-file test (with dummy golden) | Uploads + background extraction for static; Python segmenter → **`fixtures/segmenter_case.json` pushed by 2:30** |
| 2:30–3:00 | **Both: record and upload** (sync point). Static: 2–3 × 10 s clips per letter each. Motion: 2 × 30 s clips each of J and Z with pauses between reps (≥ 20 reps per person). `_none`: 2 × 30 s clips each of fingerspelling static letters. Vary background, lighting, and distance. If the upload endpoint isn't ready, keep the clips on the phones and B uploads them later. | |
| 3:00–4:00 | `PredictionStabilizer` (static rules) + tests, transcript UI, buttons | Static training pipeline + minimal publish + real `latest` → **v1 published (static only) by 4:00** |
| 4:00–5:00 | `MotionSegmenter` (Kotlin, from §3 item 7) + fixture test, `MotionClassifier` with the dummy motion model. Try v1 on the phone (5 min) | Motion uploads (segments → `sequences`), motion training (resampling, time warp, Conv1D) → **v2 published (static + motion) by 5:00** |
| 5:00 | **Both: motion checkpoint** (5 min, §7.3) | |
| 5:00–6:00 | Stabilizer motion rules + tests, `Speaker`; download v2 into `assets/model/` once it's published | Signs page, Sign detail / Upload page, both golden files from real validation data, sha256 in `latest` |
| 6:00–7:00 | `ModelRepository` against the mock server, then switch to the real server URL; network config, settings | Train & Publish page with both reports; motion sign detail (`start_shapes`, sequence thumbnails); write platform facts into `platform/README.md` |
| 7:00–7:30 | **Both: end-to-end** (sync point) — new sign → train → publish → phone update → offline; tune `motion_config` thresholds and the `I→J` window; more data for the most-confused letters | |
| 7:30–7:45 | **Feature freeze**, bug fixes only, each in their own paths | |
| 7:45–8:00 | Release APK, demo rehearsal (A); deployed server reachable from the phone over HTTPS (B) | |
| 8:00–9:00 | **Submission block (§9).** A: finish `README.md`, submit the form. B: record and edit the demo video, post it on X/LinkedIn, send A the URL. **Must finish before 10:00 AM Oct 10.** | |

**Sync points** (both stop and work together): 0:00–0:30 contract, 2:30–3:00 recording, the 5:00 checkpoint, 7:00–7:30 end-to-end, and the 8:00 submission split. Everywhere else, neither of you needs anything from the other within the hour.

**If a handoff is late:** the receiver keeps working against the stand-in and nobody stops. For example, if v2 is late, A keeps building with the dummy motion model; if `segmenter_case.json` is late, A writes the segmenter from §3 item 7 and adds the fixture test when it arrives. Only the 5:00 checkpoint can change the plan.

### 7.3 Motion checkpoint (5:00)

If v2 hasn't published with a motion model that gets J and Z right on validation, stop motion work. Ship static-only (the app already handles `motion: null`) and spend the time on the static demo. Present J and Z as "in progress" in the video. Who does what if motion is cut:
- **A:** skips the stabilizer motion rules and moves `ModelRepository` up to 5:00.
- **B:** skips the motion sign detail page and spends the time recording more static data for the most-confused letters.

### 7.4 Cut order if behind
Each person cuts from their own list, so a cut never changes the other person's work.
- **A:** automatic speaking on space → fingertip trail overlay → settings screen (hardcode the server URL).
- **B:** zip import → thumbnail grids → delete single sequences → motion sign detail page (set `start_shapes` directly in the database).
- **Both:** motion letters, only via the 5:00 checkpoint.

**Never cut:** upload → train → publish → offline translation of static letters, and the submission block.

## 8. Risks

| Risk | Mitigation |
|---|---|
| App and training disagree on landmark format | Normalization inside both models; contract §3; golden-file tests |
| Kotlin and Python segmenters disagree (preprocessing lives outside the model) | Exact definition in §3, item 7; shared `segmenter_case.json` fixture tested on both sides; boundary-jitter augmentation |
| Moving between static letters gets read as J or Z | `_none` class trained on fingerspelling transitions; `min_confidence`; report `_none` confusion |
| "I" is committed before J's movement starts | Moving frames don't count toward static commits; `start_shapes` replacement rule |
| Phone and video frame rates differ | Resample by timestamp to a fixed 32 frames |
| Not enough motion data | Many repetitions per clip with pauses; auto-segmentation; time-warp and mirror augmentation |
| Motion work runs late | 5:00 checkpoint; app runs static-only when `motion` is `null` |
| Accuracy looks fine in training but not in real use (correlated video frames) | Split by upload; test with someone not in the training data |
| Similar handshapes get mixed up (e.g. M/N) | Confusion report → record more data for those pairs |
| Training data is only from two people | Uploads let classmates or friends contribute videos; mirror augmentation |
| Offline TTS voice missing | Download the voice on the demo phone beforehand; English fallback |
| Android blocks plain HTTP | `network_security_config` |
| Upload pipeline not ready at 2:30 | Record clips on phones anyway; upload them as soon as the endpoint works |
| Merge conflicts | One owner per path (§2.1); `CONTRACT.md` frozen after hour 0; `pull --rebase` before every push |
| One person blocked waiting for the other | Stand-ins for every handoff (§2.1); mock server and dummy models pushed by 1:00; late handoffs never stop the receiver |
| Kotlin segmenter copies a bug from the Python one | A builds from the written rules in §3, not from B's code; the shared fixture catches differences |
| Public server abused (uploads, publish, delete) | Admin token on every write endpoint; only the two read endpoints the app uses are public (§0) |
| Deployment not ready or down during the demo | Deploy a minimal server with the dummy models early; the APK bundles a model and translates offline; keep a local copy of the platform as backup |
| Browser MediaPipe landmarks differ slightly from the phone's | Same model, same normalized landmarks; mirror and rotation augmentation; golden test on real device clips; check a few uploaded clips against the app's output |
| Missing the 10:00 AM deadline | Submission block is never cut; README disclosures drafted at 6:00; record the demo video as soon as v2 works, re-record later only if time allows |

## 9. Hackathon submission

Done in the 1-hour block after the sprint. Everything below goes into `README.md` and the submission form.

**Who does what**
- **A** owns `README.md` and submits the form. A drafts the README during 6:00–7:00 from this section and `platform/README.md`.
- **B** records and edits the demo video, posts it on X/LinkedIn, and gives A the URL.

**The project**
- Project name: **Senya**
- Short description: *Senya translates Filipino Sign Language fingerspelling into text and speech, entirely on the phone and fully offline.*
- Team members: (fill in)
- Public GitHub repository: (URL of the `senya` monorepo)

**The proof**
- **Demo video:** show airplane mode turned on, the "Offline · on-device" badge, a static word, "JAZZ", Speak producing audio, and a new sign going from the web platform to the phone.
- **X / LinkedIn video URL:** post the same video.
- **What runs locally:**
  - On the phone: hand landmark detection (MediaPipe), the static and motion classifiers (TFLite), the stabilizer, and text-to-speech.
  - In the browser and on the trainer's computer: landmark extraction from uploaded clips (browser), and training (Python trainer).
- **What requires internet:**
  - Nothing at translation time.
  - Downloading new model versions from the deployed server (HTTPS). The app works without it using its bundled model.
  - Internet once, beforehand, to download the offline TTS voice and the app's dependencies.

**The disclosures**
- **Models used:**
  - MediaPipe Hand Landmarker (`hand_landmarker.task`, Google, pre-trained)
  - Senya's own static classifier (MLP) and motion classifier (1D CNN), trained during the sprint on data the team recorded
  - Android's built-in offline text-to-speech voices
- **Technologies and frameworks:** Kotlin, CameraX, MediaPipe Tasks, TensorFlow Lite, Node.js, Express.js, React, PostgreSQL, Python, TensorFlow/Keras.
- **APIs and cloud services:** the hosting provider and managed PostgreSQL for the web platform (name them here once chosen); no AI API calls anywhere.
- **Existing code and assets:** `google-ai-edge/mediapipe-samples` hand landmarker Android example (Apache 2.0) as the app's starting point; the FSL alphabet reference used to confirm the letters (cite it).
- **AI development tools:** Claude Code (design spec and coding help); list any others used.

**Why does Senya benefit from running AI locally?** See §1, "Why local AI": privacy of the camera feed, works without signal, real-time feedback, and no running cost.
