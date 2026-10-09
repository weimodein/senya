# Senya

**Senya translates Filipino Sign Language (FSL) fingerspelling into text and speech, entirely on the phone and fully offline.**

AppBuildersPH Hackathon 2026 · Theme: Local AI

## Team
- TODO — Person A (Android)
- TODO — Person B (Platform + ML)

## Demo
- Demo video: TODO
- X / LinkedIn post: TODO

---

## Try it in two minutes (no setup)

1. **Get the APK.** Download [`senya-v1.0.apk`](https://github.com/weimodein/senya/releases/download/1.0.0/senya-v1.0.apk) from this repository's [Releases](https://github.com/weimodein/senya/releases/tag/1.0.0) page (release `1.0.0`), or take it from [`release/`](release/) in this repo. Its sha256 is in [`release/senya-v1.0.apk.sha256`](release/senya-v1.0.apk.sha256).
2. **Install it** on an Android phone (Android 7.0 / API 24 or newer). Allow "Install unknown apps" for your browser or file manager when asked. The APK is signed with a debug key because it is a hackathon build, not a Play Store build.
3. **Open Senya** and follow the four onboarding steps: welcome, camera, offline voice, ready. On the **Ready** screen, the app lists the letters its model knows.
4. **Turn on airplane mode** and fingerspell. Translation, word suggestions and speech all keep working.

**Signing tips**
- Keep one hand fully in view, with some space around it.
- **Held letters:** raise your hand, hold the letter still for about a second, and the letter is committed.
- **J and Z:** these move. For J, start from the letter **I** and trace the J once; for Z, trace the Z once with your index finger.
- Try the word **MAGANDA** ("beautiful"): every letter in it is supported.

**What the bundled model knows (v17):** static letters **A–I and K–Y**, plus the motion letters **J** and **Z**: the whole alphabet. The APK ships with this model, so it works offline straight after install.

The app downloads newer models from our deployed server, **https://senya-k2wd.onrender.com**, when the phone is online (on launch, or Settings → Check for update). It's a free Render service that sleeps when idle, so the first check can take about a minute. The app keeps using its installed model meanwhile. The admin panel at the same address needs a login; ask the team for a demo account.

---

## Why does Senya benefit from running AI locally?
- **Privacy:** the camera sees the signer's face, home and hands. Frames never leave the phone; only the translated text exists. The training platform also deletes uploaded videos right after extracting hand landmarks.
- **Works without signal:** Deaf and hard-of-hearing users need to communicate at clinics, offices and stores, including places with weak or no mobile data. Senya works in airplane mode.
- **Real time:** on-device inference runs at 15+ fps with no network round trip, so feedback is immediate.
- **No running cost:** there is no cloud inference bill and no AI API call anywhere, so the app can be free.

## What runs locally

| Where | What runs there |
|---|---|
| **On the phone, offline** | CameraX camera feed → **MediaPipe Hand Landmarker** (21 hand points per frame) → Senya's **static letter classifier** (MLP, TFLite) and **motion classifier** for J (1D CNN, TFLite) → prediction stabilizer → word suggestions → Android **offline text-to-speech** |
| **On the team's laptop** (`senya-ml`) | Landmark extraction from uploaded training clips (OpenCV + MediaPipe) and model training (TensorFlow → TFLite). Clips are deleted right after extraction |
| **In the cloud** (Render + Supabase) | Storage and delivery only: the REST API, the admin panel, hand-landmark samples and model files. **No AI runs here, and no video is stored** |

**What needs internet:** only downloading a newer model and, once, an offline voice for speech. Translation never does.

---

## How it works

```
                        JWT (Bearer)                          X-API-Key
 ┌──────────────┐   ───────────────────►  ┌────────────────┐  ─────────────────►  ┌──────────────┐
 │ senya-admin  │   /api/auth, /api/signs │ senya-backend  │  POST /extract       │  senya-ml    │
 │ React+Vite   │   /api/models           │ Express +      │  POST /train         │  FastAPI     │
 └──────────────┘                         │ Sequelize      │  ◄─────────────────  │  MediaPipe   │
                                          │                │  GET  /api/ml/dataset│  TensorFlow  │
 ┌──────────────┐   public, read-only     │                │  POST /api/ml/models │  (laptop)    │
 │ Android app  │   ───────────────────►  │                │       /:id/{progress,│              │
 │ (offline     │   GET /api/model/latest │                │        result,fail}  │              │
 │  inference)  │   GET /models/v{n}/*    └───────┬────────┘                      └──────────────┘
 └──────────────┘                                 ▼
                                          ┌────────────────┐
                                          │ PostgreSQL     │
                                          └────────────────┘
```

**The pipeline**
1. **Collect:** in the admin panel, create a sign (e.g. `A`, static; `J`, motion, starting from letter `I`) and upload phone clips.
2. **Extract (laptop):** the ML service finds the hand in every frame and keeps only the landmarks. For a static letter it keeps the held frames. For a motion letter it keeps the one movement, and the raise and lower become "not a sign" (`_none`) examples. The video is deleted.
3. **Train (laptop):** one click trains both classifiers, checks the exported TFLite files against Keras, and uploads them to the backend. Progress shows live in the panel.
4. **Deploy:** one click publishes a version, or rolls back to an older one.
5. **Update (phone):** the app downloads the new version, verifies every file (sha256 plus golden test inputs), and switches over. If anything fails, it keeps its current model.
6. **Translate (phone):** everything happens on-device from then on.

| Part | Folder | Built with |
|---|---|---|
| Android app | [`android/`](android/) | Kotlin, CameraX, MediaPipe Tasks, TensorFlow Lite, Android TTS |
| ML service | [`senya-ml/`](senya-ml/) | Python 3.10, FastAPI, OpenCV, MediaPipe 0.10.35, TensorFlow 2.20 |
| Backend | [`senya-backend/`](senya-backend/) | Node.js 22, Express, Sequelize, JWT, bcrypt, multer |
| Admin panel | [`senya-admin/`](senya-admin/) | React, Vite, Tailwind CSS, axios |
| Database | — | PostgreSQL (Supabase in production; any local PostgreSQL works) |

Details: [`docs/architecture.md`](docs/architecture.md) covers every API, the database and the flows. [`CONTRACT.md`](CONTRACT.md) freezes the model files and the endpoints the app uses.

---

## Replicate the whole system on your machine

This runs the database, ML service, backend and admin panel locally, and points a debug build of the app at them. Commands are for Windows with Git Bash. On macOS or Linux, use `.venv/bin/` instead of `.venv/Scripts/`.

### Prerequisites
- **Git**
- **Node.js 22** and npm
- **Python 3.10**. The pinned TensorFlow 2.20 + MediaPipe 0.10.35 pair is tested on 3.10.
- **PostgreSQL 14+**, local; or a free Supabase project (see [`docs/deploy.md`](docs/deploy.md))
- **Android Studio** (bundled JDK, Android SDK 34) and an Android phone with USB debugging, for the app
- Some fingerspelling clips (phone videos, any common format such as `.mp4` or `.mov`), or photos for static letters

### 1. Clone
```bash
git clone https://github.com/weimodein/senya.git
cd senya
```

### 2. Database
Create an empty database. The backend creates every table itself on start (`senya-backend/migrations/*.sql`).
```bash
createdb senya        # or: psql -c "CREATE DATABASE senya;"
```

### 3. Shared secrets
Make an API key that the backend and the ML service will share:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. ML service (port 8001)
```bash
cd senya-ml
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
curl -sSL -o app/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
cp .env.example .env
```
Edit `senya-ml/.env`:
```
BACKEND_URL=http://localhost:8000
ML_API_KEY=<the key from step 3>
```
Start it, and leave it running:
```bash
.venv/Scripts/python -m uvicorn app.main:app --port 8001
```
Check: `curl http://localhost:8001/health` → `{"status":"ok","training":null}`

### 5. Backend (port 8000)
In a new terminal:
```bash
cd senya-backend
npm ci
cp .env.example .env
```
Edit `senya-backend/.env`:
```
DATABASE_URL=postgres://<user>:<password>@localhost:5432/senya
PORT=8000
JWT_SECRET=<any long random string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<choose one>
ML_SERVICE_URL=http://localhost:8001
ML_API_KEY=<the key from step 3>
ALLOWED_ORIGINS=http://localhost:5173
```
Start it, and leave it running:
```bash
npm start
```
Check: `curl http://localhost:8000/health` → `{"ok":true}`. Optional: `npm run seed:v0` publishes a dummy demo model (letters A, B, C) to test the app connection before you train anything.

### 6. Admin panel (port 5173)
In a new terminal:
```bash
cd senya-admin
npm ci
npm run dev
```
Open **http://localhost:5173** and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 7. Collect data, train, deploy
1. **Signs → Add a sign.**
   - **Static letters** (e.g. `A`, `B`): kind *Static*.
   - **J**: kind *Motion*, "Starts from letter" `I`.
2. **Upload clips** on each sign's page.
   - **Static:** raise the hand, hold the letter still for about a second, lower it. Only the held part is kept.
   - **Motion (J):** raise the hand, sign J once, lower it. One clip = one sample, and the raise and lower automatically become `_none` samples.
3. **Minimum data before training:**
   - At least **2 static letters with 30+ samples each**. One clip gives about 10–15 samples.
   - Optional motion model: **3+ clips per motion letter**, and **4+ `_none` samples**, which 3 clips nearly always provide.
4. **Models → Train.** Watch progress. Training takes a few minutes on a laptop CPU.
5. **Deploy** the trained version.

### 8. Run the app against your local server
1. Plug in the phone (USB debugging on), then forward the backend port:
   ```bash
   adb reverse tcp:8000 tcp:8000
   ```
2. Point the debug build at it. Create or edit `android/local.properties`:
   ```
   senya.serverUrl=http://127.0.0.1:8000
   ```
3. Build and install:
   ```bash
   cd android
   export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
   ./gradlew installDebug
   ```
   The first build downloads `hand_landmarker.task` into the app's assets (internet once).
4. Open the app, then **Settings → Check for update**. It downloads your deployed version. Turn on airplane mode and sign.

Debug builds allow plain HTTP and have a server override in Settings. Release builds use HTTPS only.

### 9. Optional: deploy it like we did
Render (backend + admin panel), Supabase (database) and an ngrok static domain for the laptop's ML service: see [`docs/deploy.md`](docs/deploy.md). To build a release APK against your own server, set `senya.serverUrl=https://<your-service>.onrender.com` in `android/local.properties`, then run `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.

---

## Tests
| Part | Command (from the folder) | Notes |
|---|---|---|
| ML service | `.venv/Scripts/python -m pytest -q` | includes real hand tracks from recorded J clips |
| Backend | `npm test` | end to end against `DATABASE_URL`, in its own `senya_test` schema, with a stub ML service |
| Admin panel | `npm run build` | |
| Android | `./gradlew testDebugUnitTest` | JVM unit tests for the translation logic |

---

## Dataset
The team recorded its own FSL fingerspelling clips: 4 signers, about 10 single-take clips per signer per letter, on a phone. Only hand landmarks (21 points per frame) are extracted and stored; videos and faces are never kept. The deployed model was trained on a subset of these clips.

---

## Disclosures
- **Models used:**
  - MediaPipe Hand Landmarker (`hand_landmarker.task`, Google, pretrained).
  - Senya's own static classifier (MLP) and motion classifier (1D CNN), trained during the sprint on data the team recorded.
  - Android's built-in offline text-to-speech voices.
- **Technologies and frameworks:** Kotlin, CameraX, MediaPipe Tasks, TensorFlow Lite, Node.js, Express.js, Sequelize, React, Vite, Tailwind CSS, PostgreSQL, Python, FastAPI, OpenCV, TensorFlow/Keras.
- **APIs and cloud services:**
  - Render: hosts the backend and admin panel.
  - Supabase: managed PostgreSQL.
  - ngrok: tunnel to the laptop's ML service.
  - No AI API calls anywhere.
- **Existing code and assets:**
  - `google-ai-edge/mediapipe-samples` hand landmarker Android example (Apache 2.0), used as the app's starting point; see [`android/README.md`](android/README.md).
  - FSL alphabet reference: TODO (cite it).
- **AI development tools:** Claude Code (design spec, planning, coding help). TODO: list any others used.

## Repository layout
| Path | What |
|---|---|
| `android/` | Android app |
| `senya-backend/` | REST API: Express + Sequelize on PostgreSQL |
| `senya-admin/` | Admin panel: React + Vite + Tailwind |
| `senya-ml/` | ML service: FastAPI + MediaPipe + TensorFlow (extraction, training → TFLite) |
| `fixtures/` | Dummy v0 model + mock server |
| `release/` | The release APK |
| `SENYA-brand-final/` | Logo, app icon and palette |
| `CONTRACT.md` | Model files and the app-facing endpoints |
| `docs/` | Design spec, architecture, deployment |
| `render.yaml` | Render blueprint (one web service: backend + built admin panel) |

## License
Apache License 2.0 — see `LICENSE` and `NOTICE`. The Android app started from the MediaPipe hand landmarker sample (also Apache 2.0); see `android/README.md`.
