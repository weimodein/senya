# Senya — A↔B Contract

**Contract version: 1 — DRAFT** (becomes final when both Person A and Person B have read and agreed to it in hour 0)

Agreed by: [ ] Person A (Android) · [ ] Person B (Platform + ML)

This file is copied from `docs/2026-10-09-senya-design.md` (sections 2.1 and 3). Section references (§) point to that spec.
**Changing this file:** raise the change out loud; both agree; Person B edits it and bumps the version line above; both pull.

## Contract

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
12. **Mock server:** `fixtures/mock_server/` is laid out so that `python -m http.server 8000` run inside it serves the contract's endpoints exactly: `api/model/latest` (a file containing the item 9 JSON for version 0, with real sha256 values) and `models/v0/` containing the dummy `model.tflite`, `labels.json`, `golden.json`, `motion.tflite`, `motion_labels.json`, `motion_config.json`, and `motion_golden.json`. Generate all of it with `python -m app.cli make-fixtures` in `senya-ml/`. To test rollback and failure handling, A can edit a local copy (change the version, break the sha256).


## Ownership and workflow

**Ownership: one owner per path.** Only the owner edits a path. Anyone may read anything.

| Path | Owner | Notes |
|---|---|---|
| `android/` | A | Includes the bundled model in `android/app/src/main/assets/model/` (A downloads it from the platform) |
| `senya-backend/`, `senya-admin/` | B | Backend API and admin panel |
| `senya-ml/` | A | ML service (extraction, training) |
| `fixtures/` | A | Dummy models, golden files, mock server (generated by `senya-ml`) |
| `README.md` | A | Built from §9 |
| `CONTRACT.md` | B types, both agree | Frozen after hour 0 (see below) |
| `docs/` | nobody during the sprint | |

**Git workflow**
- Both commit straight to `main`, only inside their own paths, and run `git pull --rebase` before every push. With no shared files, rebases never conflict.
- Commit small and often (at least every hour).
- `.gitignore` covers every `.env`, `node_modules/`, the Python venv and the MediaPipe `.task` bundle in `senya-ml/app/models/`.

**Changing the contract**
- Raise the change out loud. Both agree, B edits `CONTRACT.md` and bumps the `Contract version: n` line at its top, and both pull.
- Don't make changes in the middle of an hour unless one of you is blocked. Each of you works around the issue until the next handoff.

