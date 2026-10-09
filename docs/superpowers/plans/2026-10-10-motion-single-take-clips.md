# Single-Take Motion Clips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a motion sign (J, Z, …) be trained from 3–5 single-take clips, each going rest → raise → (hold) → sign once → settle → lower → rest, like the dataset at `C:\Users\Dell\Desktop\trysigla\sigla\datasets\LETTERS(A-L)\J\signer-0*\IMG_*.MOV`.

**Architecture:** The ML service gets a second motion extraction mode, `single`, next to today's repeat-with-pauses mode (`multi`). `single` finds the one movement in the clip, and also cuts the raise and the lower out as "not a sign" (`_none`) samples. The backend asks for `single` on every real motion sign, stores the `_none` cuts under the `_none` sign but attached to the same upload (so deleting the clip deletes them), and the training thresholds drop so 3 clips are enough. The shared `MotionSegmenter` (Kotlin + Python port) is NOT touched, so the Android app needs no change.

**Tech Stack:** Python 3.10 / FastAPI / MediaPipe / OpenCV / TensorFlow (`senya-ml`), Node / Express / Sequelize / Postgres (`senya-backend`), React / Vite (`senya-admin`).

**Spec:** No separate spec file. The design was agreed in conversation on 2026-10-10 and is summarized under *Background* below.

## Background (why this is needed)

Measured on all 40 J clips (4 signers × 10), iPhone `.MOV`, 1080×1920 portrait, 60 fps, 4–5 s:

- The files decode fine (OpenCV applies the rotation; 5–7 MB is under the 50 MB limit). **The format is not the problem.**
- Today's motion extraction expects "repeat the movement several times with pauses". On these clips it returns the raise merged into the J (~1.8 s instead of ~1 s) in 8 of 10 clips, plus the lowering as a fake 350–500 ms "J"; in 2 clips the raise becomes its own fake J.
- Each clip contains one J, but a motion sign needs 20 movements from ≥2 clips (`_none` needs 40), so 3–5 clips can never activate it.

A prototype of the algorithm in Task 1, run on all 40 clips, found exactly one J in every clip (750–1950 ms, inside the app's 300–2500 ms window) and 75 raise/lower `_none` cuts (about 1.9 per clip). Example (`#` fast, `-` medium, `_` still, `.` speed unknown; `r` raise, `J` sign, `l` lower):

```
signer-02/IMG_4431.MOV  . ..########--___-################----------####----__________#####. .
                            rrrrrrrrrrrrrrJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ        lllllllll
signer-03/IMG_4542.MOV  ... ..##########################################--________________________--######.
                            rrrrrrrrrrJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ                       lllllllll
```

Decisions agreed with the user:
- One clip = one sample for real motion signs.
- Raise and lower cuts are saved as `_none` samples automatically.
- Thresholds: a real motion sign needs **3 sequences from 3 uploads** (clips). `_none` needs **6** sequences. (10 was discussed, but 3 J clips only yield ~6 `_none` cuts, so 10 would still block a sign with 3 clips.)
- Training makes more augmented copies for classes with few sequences.

## Global Constraints

- Never stop or reuse anything on ports **8000** or **8001** (the user's own backend and ML service). End-to-end testing uses backend **8010** and ML **8002**, with `DB_SCHEMA=senya_demo`; drop that schema afterwards. Check `netstat -ano | findstr LISTENING` before starting anything.
- Backend tests run in schema `senya_test` (the test file handles this); they need `senya-backend/.env` with `DATABASE_URL`.
- Do not change `senya-ml/app/services/segmenter.py` or `android/**/MotionSegmenter.kt` — they must stay in step with each other.
- Never edit a migration that has run on Supabase. This plan needs no schema change.
- ML default mode stays `multi`, so the currently deployed backend (Render) keeps working until it is redeployed.
- Python commands run from `senya-ml/` with `.venv/Scripts/python.exe`. Node commands run from `senya-backend/` or `senya-admin/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A clip uploaded to `_none` itself** must keep the old `multi` behaviour (many ordinary movements per clip) and must not harvest anything — tested in Task 4 (`direct` upload, no `mode` sent).
2. **Deleting a J clip** must also remove the `_none` samples cut from it — tested in Task 4 (count before/after `DELETE /api/uploads/:id`).
3. **A clip where the hand never makes a movement** (raise, hold, lower) must fail with a readable 422 message, not an empty upload — tested in Task 1 (`find_single_take` → `None`) and Task 2 (`ExtractionError` "sign once").
4. **Training with only 3 sequences per class** (2 train, 1 val) must not crash in split, augmentation or validation — tested in Task 3 (`train_motion` on a 3-clip export with harvested `_none`).
5. **An older backend calling the new ML service without `mode`** must get the old behaviour — tested in Task 2 (`mode` defaults to `multi`).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `senya-ml/app/services/extract.py` | modify | add `find_single_take`, `_single_from_video`, `mode` parameter; share `_sequence` builder |
| `senya-ml/app/routers/extract.py` | modify | accept and validate the `mode` form field |
| `senya-ml/tests/fixtures/make_j_tracks.py` | create | regenerates the real-clip landmark fixture |
| `senya-ml/tests/fixtures/j_tracks.json` | create (generated) | hand tracks of 4 real J clips (no video) |
| `senya-ml/tests/test_single_take.py` | create | synthetic + real-clip tests for single-take extraction |
| `senya-ml/tests/test_api.py` | modify | `mode` validation and pass-through |
| `senya-ml/app/core/contract.py` | modify | new thresholds |
| `senya-ml/app/core/augment.py` | modify | `copies_for` |
| `senya-ml/app/core/train.py` | modify | use `copies_for` per label |
| `senya-ml/tests/test_augment.py` | create | `copies_for` tests |
| `senya-ml/tests/test_data.py` | modify | threshold tests |
| `senya-ml/tests/test_pipeline.py` | modify | tiny-dataset motion training test |
| `senya-backend/src/services/mlClient.js` | modify | send `mode` |
| `senya-backend/src/utils/contract.js` | modify | validate `none_sequences` |
| `senya-backend/src/controllers/signController.js` | modify | request `single`, store `_none` cuts, return `none_added` |
| `senya-backend/test/api.test.js` | modify | stub + tests |
| `senya-admin/src/api/index.js` | modify | `targetFor` |
| `senya-admin/src/pages/SignDetail.jsx` | modify | hint text, result text |
| `docs/architecture.md`, `docs/2026-10-09-senya-design.md` | modify | document the mode and thresholds |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch from `main`**

This work is independent of the Android branch.

```bash
git switch main
git pull --ff-only
git switch -c motion-single-take
```

---

### Task 1: `find_single_take` (ML)

**Files:**
- Create: `senya-ml/tests/fixtures/make_j_tracks.py`
- Create (generated): `senya-ml/tests/fixtures/j_tracks.json`
- Create: `senya-ml/tests/test_single_take.py`
- Modify: `senya-ml/app/services/extract.py`

**Interfaces:**
- Consumes: `app.services.segmenter.Segment(start_ms, end_ms, frames)` and `DEFAULT_CONFIG` (unchanged); `extract._speeds`, `extract._hand_size` (existing).
- Produces: `find_single_take(frames: list) -> Optional[SingleTake]`, where `SingleTake.sign: Segment` (the one movement) and `SingleTake.rest: list[Segment]` (raise and/or lower cuts that pass the segmenter's keep rules). `frames` items are `{"t_ms": int, "landmarks": [63 floats] | None, ...}`.

- [ ] **Step 1: Write the fixture generator**

`senya-ml/tests/fixtures/make_j_tracks.py`:

```python
"""Regenerates j_tracks.json: the hand tracks (never the videos) of 4 real FSL "J" clips, one per signer.

Usage, from senya-ml/:
    .venv/Scripts/python.exe tests/fixtures/make_j_tracks.py "C:/Users/Dell/Desktop/trysigla/sigla/datasets/LETTERS(A-L)/J"
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from app.services.extract import _track_video  # noqa: E402

CLIPS = {
    "signer-01/IMG_4646.MOV": "the settle before the lower is shorter than stop_hold_ms",
    "signer-02/IMG_4431.MOV": "typical: raise, short pause, J, settle, lower",
    "signer-03/IMG_4542.MOV": "no pause at all between the raise and the J",
    "signer-04/IMG_5305.MOV": "the wrist rises during the J itself",
}


def main(dataset: str):
    out = {}
    for name, why in CLIPS.items():
        frames = _track_video(str(pathlib.Path(dataset) / name))
        out[name] = {"why": why, "frames": [
            {"t_ms": f["t_ms"], "landmarks": None if f["landmarks"] is None else [round(v, 4) for v in f["landmarks"]]}
            for f in frames]}
    path = pathlib.Path(__file__).with_name("j_tracks.json")
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
```

- [ ] **Step 2: Generate the fixture**

Run: `.venv/Scripts/python.exe tests/fixtures/make_j_tracks.py "C:/Users/Dell/Desktop/trysigla/sigla/datasets/LETTERS(A-L)/J"`
Expected: prints the path and a size of roughly 200–350 KB.

- [ ] **Step 3: Write the failing tests**

`senya-ml/tests/test_single_take.py`:

```python
"""find_single_take keeps the one movement of a rest -> raise -> (hold) -> MOVE -> settle -> lower -> rest clip."""
import json
import pathlib

import pytest

from app.services.extract import find_single_take

J_TRACKS = json.loads((pathlib.Path(__file__).parent / "fixtures" / "j_tracks.json").read_text())
PAD_MS = 150


def hand(x, y):
    """A 21-point hand ~0.28 wide whose wrist sits at (x, y)."""
    pts = [(x, y)] + [(x + 0.01 * k, y - 0.01 * k) for k in range(1, 21)]
    return [v for px, py in pts for v in (px, py, 0.0)]


def clip(phases, step_ms=33):
    """phases: (name, n_frames, (x0, y0) | None, (x1, y1) | None); the wrist moves linearly, None = no hand."""
    frames, t = [], 0
    for name, n, a, b in phases:
        for k in range(n):
            lm = None if a is None else hand(a[0] + (b[0] - a[0]) * k / max(1, n - 1),
                                             a[1] + (b[1] - a[1]) * k / max(1, n - 1))
            frames.append({"t_ms": t, "landmarks": lm, "phase": name})
            t += step_ms
    return frames


LOW_L, TOP, SIDE, LOW_R = (0.5, 0.95), (0.5, 0.55), (0.75, 0.55), (0.75, 0.95)
AWAY = ("away", 10, None, None)
RAISE, LOWER = ("raise", 8, LOW_L, TOP), ("lower", 8, SIDE, LOW_R)
HOLD, MOVE, SETTLE = ("hold", 10, TOP, TOP), ("move", 12, TOP, SIDE), ("settle", 12, SIDE, SIDE)


def phases_in(segment, frames):
    by_t = {f["t_ms"]: f["phase"] for f in frames}
    return [by_t[f["t_ms"]] for f in segment.frames]


def first_t(frames, phase):
    return min(f["t_ms"] for f in frames if f["phase"] == phase)


def test_keeps_the_movement_and_cuts_the_raise_and_lower_for_none():
    frames = clip([AWAY, RAISE, HOLD, MOVE, SETTLE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    got = phases_in(take.sign, frames)
    assert got.count("move") == 12
    assert "raise" not in got and "lower" not in got
    assert len(take.rest) == 2
    assert phases_in(take.rest[0], frames).count("raise") == 8
    assert phases_in(take.rest[1], frames).count("lower") == 8


def test_a_movement_straight_out_of_the_raise_only_borrows_the_pad():
    frames = clip([AWAY, RAISE, MOVE, SETTLE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    assert phases_in(take.sign, frames).count("move") == 12
    start = first_t(frames, "move")
    assert all(f["t_ms"] >= start - PAD_MS for f in take.sign.frames)


def test_a_movement_running_straight_into_the_lower_stops_before_it():
    frames = clip([AWAY, RAISE, HOLD, MOVE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    got = phases_in(take.sign, frames)
    assert got.count("move") == 12 and "lower" not in got


def test_no_hand_is_no_take():
    assert find_single_take(clip([("away", 40, None, None)])) is None


def test_raise_hold_lower_without_a_movement_is_no_take():
    frames = clip([AWAY, RAISE, ("hold", 30, TOP, TOP), ("lower", 8, TOP, LOW_L), AWAY])
    assert find_single_take(frames) is None


@pytest.mark.parametrize("name", sorted(J_TRACKS))
def test_real_j_clips_give_exactly_one_j_between_the_raise_and_the_lower(name):
    frames, why = J_TRACKS[name]["frames"], J_TRACKS[name]["why"]
    take = find_single_take(frames)
    assert take is not None, why
    assert 700 <= take.sign.end_ms - take.sign.start_ms <= 2000, why
    hand_t = [f["t_ms"] for f in frames if f["landmarks"] is not None]
    assert hand_t[0] < take.sign.start_ms and take.sign.end_ms < hand_t[-1], why
    assert len(take.rest) == 2, why
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_single_take.py -q`
Expected: collection error, `ImportError: cannot import name 'find_single_take'`.

- [ ] **Step 5: Implement**

In `senya-ml/app/services/extract.py`:

1. Change the imports:

```python
from dataclasses import dataclass
from typing import Optional
```
(replacing the existing `from typing import Optional`), and

```python
from app.services.segmenter import DEFAULT_CONFIG as SEGMENTER_DEFAULTS, Segment, segment_clip
```
(replacing `from app.services.segmenter import segment_clip`).

2. Below `HOLD_TRIM_MS = …`, add:

```python
# Motion signs, one per clip: the wrist rising (or dropping) faster than this, in hand sizes per second, is the
# raise (or the lower) around the sign.
RAISE_SPEED = float(os.getenv("RAISE_SPEED", 0.5))
```

3. Replace the smoothing loop at the end of `_speeds` with a shared helper. Add above `_speeds`:

```python
def _smooth3(raw: list) -> list:
    """Mean over each value and its neighbours; None where any of them is None."""
    out = []
    for i in range(len(raw)):
        window = raw[max(0, i - 1):i + 2]
        out.append(None if any(v is None for v in window) else sum(window) / len(window))
    return out
```

and end `_speeds` with `return _smooth3(raw)` instead of its own `out` loop.

4. After `find_hold`, add:

```python
def _wrist_drop_speeds(frames: list) -> list:
    """Vertical wrist speed per frame in hand sizes per second (+ = moving down the picture), smoothed over 3
    frames. None where the hand is missing in this or the previous frame."""
    raw, prev = [], None
    for f in frames:
        cur, before = f["landmarks"], prev["landmarks"] if prev else None
        if cur is None or before is None:
            raw.append(None)
        else:
            dt = (f["t_ms"] - prev["t_ms"]) / 1000
            size = _hand_size(cur)
            raw.append((cur[1] - before[1]) / size / dt if dt > 0 and size > 0 else None)
        prev = f
    return _smooth3(raw)


def _span(frames: list, from_ms: float, to_ms: float) -> Optional[Segment]:
    """One [from_ms, to_ms] cut, kept only under the segmenter's rules (length, share of frames without a hand)."""
    c = SEGMENTER_DEFAULTS
    if not c["min_ms"] <= to_ms - from_ms <= c["max_ms"]:
        return None
    cut = [{"t_ms": f["t_ms"], "landmarks": f["landmarks"]} for f in frames if from_ms <= f["t_ms"] <= to_ms]
    missing = sum(1 for f in cut if f["landmarks"] is None)
    if not cut or missing == len(cut) or missing / len(cut) > c["max_missing"]:
        return None
    return Segment(from_ms, to_ms, cut)


@dataclass
class SingleTake:
    sign: Segment   # the one movement
    rest: list      # the raise and the lower as Segments, when they pass the keep rules (they become _none samples)


def find_single_take(frames: list) -> Optional[SingleTake]:
    """The one movement in a rest -> raise -> (hold) -> MOVE -> settle -> lower -> rest clip.

    Measured on 40 real FSL "J" clips (4 signers): the raise is the wrist rising from the bottom of the picture and
    the lower is it dropping back out. The move always ends in a still settle or runs straight into the lower, but
    the pause after the raise is often missing. So the raise and lower are found by the wrist's vertical speed; the
    move starts at the first fast frame after the raise that keeps moving for min_ms, and ends at the first still
    frame whose stillness lasts stop_hold_ms or runs into the lower (the end the app's segmenter would pick). The
    move gets the segmenter's pad_ms in front. On all 40 clips this kept one J of 750-1950 ms.
    """
    c = SEGMENTER_DEFAULTS
    speeds, drop = _speeds(frames), _wrist_drop_speeds(frames)
    hand = [i for i, f in enumerate(frames) if f["landmarks"] is not None]
    if not hand:
        return None
    first, last = hand[0], hand[-1]

    def t(i):
        return frames[i]["t_ms"]

    def still(i):
        return speeds[i] is not None and speeds[i] < c["stop_speed"]

    def fast(i):
        return speeds[i] is not None and speeds[i] > c["start_speed"]

    raise_end = first
    while raise_end < last and (drop[raise_end] is None or -drop[raise_end] > RAISE_SPEED):
        raise_end += 1
    lower_start = last
    while lower_start > raise_end and (drop[lower_start] is None or drop[lower_start] > RAISE_SPEED):
        lower_start -= 1

    start = next((i for i in range(raise_end, lower_start + 1)
                  if fast(i) and not any(still(k) for k in range(i, lower_start + 1) if t(k) - t(i) <= c["min_ms"])),
                 None)
    if start is None:
        return None
    end, i = lower_start, start + 1
    while i <= lower_start:
        if still(i):
            k = i
            while k < lower_start and still(k + 1):
                k += 1
            if k == lower_start or t(k) - t(i) >= c["stop_hold_ms"]:
                end = i
                break
            i = k
        i += 1

    sign = _span(frames, t(start) - c["pad_ms"], t(end))
    if sign is None:
        return None
    moving = next((i for i in range(first, raise_end + 1) if speeds[i] is not None), raise_end)
    rest = [s for s in (_span(frames, t(moving) - c["pad_ms"], t(raise_end)),
                        _span(frames, t(lower_start) - c["pad_ms"], t(last))) if s]
    return SingleTake(sign, rest)
```

- [ ] **Step 6: Run the new tests and the existing hold/segmenter tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_single_take.py tests/test_hold.py tests/test_segmenter.py -q`
Expected: all pass. The 4 real clips are expected to give J lengths of about 1450, 1283, 1350 and 883 ms.

- [ ] **Step 7: Commit**

```bash
git add senya-ml/app/services/extract.py senya-ml/tests/test_single_take.py senya-ml/tests/fixtures/
git commit -m "ml: find the one movement in a single-take motion clip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `mode` on `/extract` (ML)

**Files:**
- Modify: `senya-ml/app/services/extract.py` (`_motion_from_video`, `extract`)
- Modify: `senya-ml/app/routers/extract.py`
- Modify: `senya-ml/tests/test_single_take.py`, `senya-ml/tests/test_api.py`

**Interfaces:**
- Consumes: `find_single_take`, `SingleTake` from Task 1.
- Produces: `extract(data: bytes, filename: str, kind: str, mode: str = "multi") -> dict`. For `kind="motion", mode="single"` the body is `{"kind": "motion", "no_hand_frames": int, "sequences": [one], "none_sequences": [0–2]}`, where each sequence is `{"duration_ms", "handedness", "thumb", "frames"}`. `POST /extract` takes an optional form field `mode` (`single` | `multi`, default `multi`).

- [ ] **Step 1: Write the failing tests**

Append to `senya-ml/tests/test_single_take.py` (and add `from app.services.extract import ExtractionError, _single_from_video` to its imports):

```python
def test_single_from_video_returns_one_sequence_and_the_none_cuts():
    out = _single_from_video(J_TRACKS["signer-02/IMG_4431.MOV"]["frames"])
    assert out["kind"] == "motion"
    assert len(out["sequences"]) == 1 and len(out["none_sequences"]) == 2
    seq = out["sequences"][0]
    assert 700 <= seq["duration_ms"] <= 2000
    assert seq["thumb"] is None  # fixture tracks carry no pixels
    assert all(f["landmarks"] is None or len(f["landmarks"]) == 63 for f in seq["frames"])


def test_single_from_video_explains_a_clip_without_a_movement():
    frames = clip([AWAY, RAISE, ("hold", 30, TOP, TOP), ("lower", 8, TOP, LOW_L), AWAY])
    with pytest.raises(ExtractionError, match="sign once"):
        _single_from_video(frames)
```

Append to `senya-ml/tests/test_api.py` (and add `from app.routers import extract as extract_router` to its imports):

```python
def test_extract_rejects_a_bad_mode():
    r = client.post("/extract", headers=KEY, data={"kind": "motion", "mode": "twice"}, files={"file": ("a.mov", b"x")})
    assert r.status_code == 400


def test_extract_passes_the_mode_on_and_defaults_to_multi(monkeypatch):
    seen = {}
    monkeypatch.setattr(extract_router, "extract",
                        lambda data, name, kind, mode: seen.update(kind=kind, mode=mode) or {"kind": kind})
    r = client.post("/extract", headers=KEY, data={"kind": "motion", "mode": "single"}, files={"file": ("a.mov", b"x")})
    assert r.status_code == 200 and seen == {"kind": "motion", "mode": "single"}
    client.post("/extract", headers=KEY, data={"kind": "motion"}, files={"file": ("a.mov", b"x")})
    assert seen["mode"] == "multi"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_single_take.py tests/test_api.py -q`
Expected: ImportError for `_single_from_video`; with that fixed, the API tests fail (400 is not returned, `mode` is not passed).

- [ ] **Step 3: Implement in `extract.py`**

Replace `_motion_from_video` with a shared sequence builder, the old function, and the new one:

```python
def _sequence(segment, by_t: dict) -> dict:
    """One Segment -> the contract's sequence: raw frames, plus a thumbnail of the middle frame when we have pixels."""
    hand_frames = [by_t[f["t_ms"]] for f in segment.frames if f["landmarks"] is not None and f["t_ms"] in by_t]
    middle = hand_frames[len(hand_frames) // 2] if hand_frames else None
    return {
        "duration_ms": int(round(segment.end_ms - segment.start_ms)),
        "handedness": next((f.get("handedness") for f in hand_frames if f.get("handedness")), None),
        "thumb": _thumb(middle["bgr"]) if middle is not None and middle.get("bgr") is not None else None,
        "frames": segment.frames,
    }


def _motion_from_video(frames: list) -> dict:
    """mode "multi": the clip repeats the movement with pauses; every movement becomes a sequence."""
    segments = segment_clip([{"t_ms": f["t_ms"], "landmarks": f["landmarks"]} for f in frames])
    if not segments:
        raise ExtractionError("no complete movement found (sign, pause, sign again; keep the hand in view)")
    by_t = {f["t_ms"]: f for f in frames}
    return {"kind": "motion", "no_hand_frames": sum(1 for f in frames if f["landmarks"] is None),
            "sequences": [_sequence(s, by_t) for s in segments]}


def _single_from_video(frames: list) -> dict:
    """mode "single": raise, sign once, lower. The sign is the one sequence; the raise and lower come back as
    none_sequences, for the backend to store as _none samples."""
    take = find_single_take(frames)
    if take is None:
        raise ExtractionError("no movement found: raise the hand, sign once, then lower it (keep the hand in view)")
    by_t = {f["t_ms"]: f for f in frames}
    return {"kind": "motion", "no_hand_frames": sum(1 for f in frames if f["landmarks"] is None),
            "sequences": [_sequence(take.sign, by_t)],
            "none_sequences": [_sequence(s, by_t) for s in take.rest]}
```

Change `extract`:

```python
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MODES = ("single", "multi")


def extract(data: bytes, filename: str, kind: str, mode: str = "multi") -> dict:
    """One uploaded file -> the body the backend stores (architecture.md §5.4). mode only applies to motion signs:
    "single" = one movement per clip (raise, sign, lower), "multi" = the movement repeated with pauses."""
    if kind not in ("static", "motion"):
        raise ValueError("kind must be 'static' or 'motion'")
    if mode not in MODES:
        raise ValueError("mode must be 'single' or 'multi'")
```

and further down replace

```python
    result = _static_from_video(frames) if kind == "static" else _motion_from_video(frames)
```

with

```python
    if kind == "static":
        result = _static_from_video(frames)
    else:
        result = _single_from_video(frames) if mode == "single" else _motion_from_video(frames)
```

- [ ] **Step 4: Implement in `routers/extract.py`**

```python
@router.post("/extract")
async def extract_landmarks(file: UploadFile = File(...), kind: str = Form(...), mode: str = Form("multi")):
    """One clip or image -> landmarks (architecture.md §5.4). The file is never stored."""
    if kind not in ("static", "motion"):
        raise HTTPException(status_code=400, detail="kind must be 'static' or 'motion'")
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="mode must be 'single' or 'multi'")
    data = await file.read()
    try:
        # MediaPipe is CPU-bound: run it off the event loop so /health and /train stay responsive.
        return await run_in_threadpool(extract, data, file.filename or "", kind, mode)
    except ExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e))
```

with the import `from app.services.extract import MODES, ExtractionError, extract`.

- [ ] **Step 5: Run the ML test suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Check against the real videos**

Run this from `senya-ml/` (it is not committed):

```bash
.venv/Scripts/python.exe -c "
import glob, sys
from app.services.extract import extract
for p in sorted(glob.glob(r'C:/Users/Dell/Desktop/trysigla/sigla/datasets/LETTERS(A-L)/J/signer-*/*.MOV')):
    r = extract(open(p, 'rb').read(), p, 'motion', 'single')
    print(p[-26:], [s['duration_ms'] for s in r['sequences']], len(r['none_sequences']), r['sequences'][0]['thumb'] is not None)
"
```

Expected: 40 lines, each with exactly one duration between 700 and 2000, 1–2 `_none` cuts, and a thumbnail (`True`).

- [ ] **Step 7: Commit**

```bash
git add senya-ml/app/services/extract.py senya-ml/app/routers/extract.py senya-ml/tests/test_single_take.py senya-ml/tests/test_api.py
git commit -m "ml: /extract mode=single returns one movement plus raise/lower cuts for _none

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Thresholds and augmentation for small classes (ML)

**Files:**
- Modify: `senya-ml/app/core/contract.py:24-27`
- Modify: `senya-ml/app/core/augment.py`
- Modify: `senya-ml/app/core/train.py` (`train_motion`)
- Create: `senya-ml/tests/test_augment.py`
- Modify: `senya-ml/tests/test_data.py`, `senya-ml/tests/test_pipeline.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `contract.MIN_MOTION_SEQUENCES = 3`, `MIN_MOTION_UPLOADS = 3`, `MIN_NONE_SEQUENCES = 6`; `augment.copies_for(n_items: int, base: int = 3, floor: int = 40) -> int`.

- [ ] **Step 1: Write the failing tests**

`senya-ml/tests/test_augment.py`:

```python
import numpy as np

from app.core import augment, data


def test_copies_for_tops_small_classes_up_to_about_the_floor():
    assert augment.copies_for(2) == 18     # 2 x (plain + mirror + 18) = 40 arrays
    assert augment.copies_for(8) == 3      # ceil(40/8) - 2 = 3, the usual amount
    assert augment.copies_for(100) == 3
    assert augment.copies_for(0) == 3


def test_augment_sequence_honours_copies():
    seq = data.synthetic_export(seed=0)["signs"][3]["uploads"][0]["sequences"][0]
    out = augment.augment_sequence(data.sequence_to_array, seq, np.random.default_rng(0), copies=augment.copies_for(2))
    assert len(out) == 20
```

Append to `senya-ml/tests/test_data.py`:

```python
def test_three_clips_activate_a_motion_sign_and_six_none_sequences_are_enough():
    ds = data.load_export(data.synthetic_export(seed=0, n_uploads=3, seq_per_upload=2))
    assert ds.motion_labels == ["_none", "J", "Z"]


def test_two_clips_are_not_enough_for_a_motion_sign():
    ds = data.load_export(data.synthetic_export(seed=0, n_uploads=2, seq_per_upload=3))
    assert "J" not in ds.motion_labels
    assert any(s.startswith("J:") for s in ds.skipped)
```

Append to `senya-ml/tests/test_pipeline.py` (add `from app.core import train` to its imports if missing):

```python
def test_motion_trains_from_three_single_take_clips_with_harvested_none():
    """The real shape after this change: 1 sequence per J clip, and _none's sequences share J's upload ids."""
    ex = data.synthetic_export(seed=2, n_uploads=3, seq_per_upload=1)
    by = {s["label"]: s for s in ex["signs"]}
    none_seq = by["_none"]["uploads"][0]["sequences"][0]
    by["_none"]["uploads"] = [{"id": u["id"], "sequences": [none_seq, none_seq]} for u in by["J"]["uploads"]]
    ds = data.load_export(ex)
    assert "J" in ds.motion_labels and "_none" in ds.motion_labels
    trained = train.train_motion(ds.motion_items, ds.motion_labels, epochs=2)
    assert trained.report is not None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_augment.py tests/test_data.py tests/test_pipeline.py -q`
Expected: `AttributeError: module 'app.core.augment' has no attribute 'copies_for'`; the threshold tests fail because J is skipped.

- [ ] **Step 3: Implement**

`contract.py`, replacing the motion threshold lines:

```python
# Training thresholds (spec §4.3). Motion clips are single takes (one movement each, raise and lower cut away
# into _none), so 3 clips activate a motion sign; 3 clips also yield about 6 _none cuts.
MIN_STATIC_SAMPLES = 30
MIN_MOTION_SEQUENCES = 3
MIN_MOTION_UPLOADS = 3
MIN_NONE_SEQUENCES = 6
```

`augment.py`: add `import math` at the top, and after `augment_sequence`:

```python
def copies_for(n_items: int, base: int = 3, floor: int = 40) -> int:
    """Random variants per sequence so a label with few training sequences still gets about `floor` arrays
    (each sequence also gives a plain and a mirrored one). Never fewer than `base`."""
    if n_items <= 0:
        return base
    return max(base, math.ceil(floor / n_items) - 2)
```

`train.py`, in `train_motion`: add `from collections import Counter` at the top of the file, and replace the augmentation loop:

```python
    per_label = Counter(it.label for it in train)
    ax, ay = [], []
    for it in train:
        for arr in augment.augment_sequence(data.sequence_to_array, it.x, rng, copies=augment.copies_for(per_label[it.label])):
            ax.append(arr)
            ay.append(it.label)
```

- [ ] **Step 4: Run the ML suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: all pass, including the existing `test_not_enough_data_is_a_clear_error`, which is about static data and is unaffected.

- [ ] **Step 5: Commit**

```bash
git add senya-ml/app/core/ senya-ml/tests/
git commit -m "ml: 3 single-take clips activate a motion sign; augment small classes more

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Backend stores the take and its `_none` cuts

**Files:**
- Modify: `senya-backend/src/services/mlClient.js`
- Modify: `senya-backend/src/utils/contract.js`
- Modify: `senya-backend/src/controllers/signController.js` (`addUpload`)
- Modify: `senya-backend/test/api.test.js`

**Interfaces:**
- Consumes: ML `/extract` with `mode` and `none_sequences` (Task 2).
- Produces: `POST /api/signs/:id/uploads` → `201 {…upload, none_added: int}`; `_none` samples with `sign_id = _none`, `upload_id = the J upload`. `ml.extract(buffer, filename, kind, mode?)`.

- [ ] **Step 1: Update the stub ML service and write the failing tests**

In `test/api.test.js`, `startStubMl`, replace the `/extract` handler:

```js
  app.post("/extract", require("multer")().single("file"), (req, res) => {
    mlCalls.push({ path: "/extract", kind: req.body.kind, filename: req.file.originalname, ...(req.body.mode && { mode: req.body.mode }) });
    if (req.file.originalname.startsWith("empty")) return res.status(422).json({ detail: "no hand found in this clip" });
    if (req.body.kind === "static") {
      return res.json({ kind: "static", no_hand_frames: 2,
        samples: Array.from({ length: 35 }, (_, i) => ({ landmarks: hand(0.3 + i * 0.001), handedness: "Right", frame_index: i, thumb: null })) });
    }
    const frames = Array.from({ length: 30 }, (_, n) => ({ t_ms: 33 * n, landmarks: n === 4 ? null : hand(0.3 + 0.02 * n) }));
    const body = { kind: "motion", no_hand_frames: 1, sequences: [{ duration_ms: 957, handedness: "Right", thumb: null, frames }] };
    if (req.body.mode === "single") {
      body.none_sequences = [0, 1].map(() => ({ duration_ms: 400, handedness: "Right", thumb: null, frames: frames.slice(5, 17) }));
    }
    res.json(body);
  });
```

In the test `uploads go through the ML service and land as samples`, after `assert.equal(j.data.segments_found, 1);` add:

```js
  assert.equal(j.data.none_added, 2);
  assert.deepEqual(mlCalls.at(-1), { path: "/extract", kind: "motion", filename: "J_1.mp4", mode: "single" });
```

In the test `the dataset the trainer downloads is grouped by sign and upload`, replace `assert.deepEqual(by._none.uploads, []);` with:

```js
  // The raise and lower cut from J's clip are _none samples that belong to J's upload.
  assert.equal(by._none.uploads.length, 1);
  assert.equal(by._none.uploads[0].id, by.J.uploads[0].id);
  assert.equal(by._none.uploads[0].sequences.length, 2);
```

Append at the end of the file:

```js
test("a motion clip's raise and lower go to _none and are deleted with the clip", { skip: SKIP }, async () => {
  const signs = Object.fromEntries((await call("GET", "/api/signs")).data.map((s) => [s.label, s]));
  const noneCount = async () => (await call("GET", "/api/signs")).data.find((s) => s.label === "_none").sample_count;
  const before = await noneCount();
  const up = await call("POST", `/api/signs/${signs.J.id}/uploads`, { form: fileForm("J_2.mov") });
  assert.equal(up.status, 201);
  assert.equal(await noneCount(), before + 2);
  assert.equal((await call("DELETE", `/api/uploads/${up.data.id}`)).status, 204);
  assert.equal(await noneCount(), before);

  // A clip uploaded to _none itself keeps the old repeat-with-pauses extraction and harvests nothing.
  const direct = await call("POST", `/api/signs/${signs._none.id}/uploads`, { form: fileForm("none_1.mov") });
  assert.equal(direct.status, 201);
  assert.deepEqual(mlCalls.at(-1), { path: "/extract", kind: "motion", filename: "none_1.mov" });
  assert.equal(direct.data.none_added, 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `senya-backend/`): `npm test`
Expected: failures on `none_added` (undefined) and on `mode` missing from `mlCalls`.

- [ ] **Step 3: Implement**

`src/services/mlClient.js`, `extract`:

```js
/** One uploaded file -> extracted landmarks. The file is never stored by either service.
 *  mode ("single" | "multi") only matters for motion signs; omitted, the ML service uses "multi". */
async function extract(buffer, filename, kind, mode) {
  const form = new FormData();
  form.append("kind", kind);
  if (mode) form.append("mode", mode);
  form.append("file", buffer, { filename });
```
(the rest of the function is unchanged).

`src/utils/contract.js`: replace the motion part of `extractionError` with a shared check:

```js
function sequencesError(list, name) {
  for (const [i, q] of list.entries()) {
    const f = q?.frames;
    if (!Array.isArray(f) || f.length < 2) return `${name}[${i}] needs at least 2 frames`;
    for (const fr of f) {
      if (!Number.isFinite(fr?.t_ms)) return `${name}[${i}] has a frame without t_ms`;
      if (fr.landmarks !== null && !isLandmarks(fr.landmarks)) return `${name}[${i}] has a bad frame`;
    }
    if (!f.some((fr) => fr.landmarks !== null)) return `${name}[${i}] has no frame with a hand`;
  }
  return null;
}

/** Checks what the ML service's /extract returned before it goes into the database. Returns an error or null. */
function extractionError(kind, body) {
  if (!body || body.kind !== kind) return `expected a ${kind} result`;
  if (kind === "static") {
    if (!Array.isArray(body.samples) || !body.samples.length) return "no samples";
    const bad = body.samples.findIndex((s) => !isLandmarks(s?.landmarks));
    return bad >= 0 ? `samples[${bad}].landmarks must be ${FLOATS} finite numbers` : null;
  }
  if (!Array.isArray(body.sequences) || !body.sequences.length) return "no sequences";
  if (body.none_sequences !== undefined && !Array.isArray(body.none_sequences)) return "none_sequences must be a list";
  return sequencesError(body.sequences, "sequences") || sequencesError(body.none_sequences || [], "none_sequences");
}
```

`src/controllers/signController.js`, `addUpload`, as a whole:

```js
const motionData = (it) => ({
  duration_ms: Math.round(it.duration_ms ?? it.frames[it.frames.length - 1].t_ms - it.frames[0].t_ms),
  frames: it.frames,
});

// POST /api/signs/:id/uploads  multipart `file` -> ML /extract -> one upload + its samples
// Real motion signs are single takes (raise, sign once, lower): the ML service returns the one movement, plus the
// raise and lower as none_sequences, which are stored as _none samples of the same upload.
const addUpload = async (req, res) => {
  const sign = await findSign(req.params.id);
  if (!req.file) throw new HttpError(400, "attach the clip or image as the `file` field");

  const singleTake = sign.kind === "motion" && sign.label !== NONE_LABEL;
  const result = await ml.extract(req.file.buffer, req.file.originalname, sign.kind, singleTake ? "single" : undefined);
  const problem = extractionError(sign.kind, result);
  if (problem) throw new HttpError(502, `ML service returned an unusable result: ${problem}`);

  const isStatic = sign.kind === "static";
  const items = isStatic ? result.samples : result.sequences;
  const noneItems = singleTake ? result.none_sequences || [] : [];
  const noneSign = noneItems.length ? await Sign.findOne({ where: { label: NONE_LABEL } }) : null;
  const upload = await sequelize.transaction(async (transaction) => {
    const up = await Upload.create(
      {
        sign_id: sign.id,
        filename: req.file.originalname,
        no_hand_frames: Number(result.no_hand_frames) || 0,
        samples_added: isStatic ? items.length : 0,
        segments_found: isStatic ? 0 : items.length,
      },
      { transaction },
    );
    const rows = items.map((it) => ({
      sign_id: sign.id,
      upload_id: up.id,
      kind: sign.kind,
      data: isStatic ? it.landmarks : motionData(it),
      handedness: it.handedness ?? null,
      thumb: it.thumb ?? null,
    }));
    if (noneSign) {
      rows.push(...noneItems.map((it) => ({
        sign_id: noneSign.id,
        upload_id: up.id,
        kind: "motion",
        data: motionData(it),
        handedness: it.handedness ?? null,
        thumb: it.thumb ?? null,
      })));
    }
    await Sample.bulkCreate(rows, { transaction });
    return up;
  });
  res.status(201).json({ ...upload.toJSON(), none_added: noneSign ? noneItems.length : 0 });
};
```

- [ ] **Step 4: Run the backend tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add senya-backend/
git commit -m "backend: single-take motion uploads; store the raise/lower cuts as _none samples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Admin panel targets and wording

**Files:**
- Modify: `senya-admin/src/api/index.js:39-41`
- Modify: `senya-admin/src/pages/SignDetail.jsx:6-7,26-29`

**Interfaces:**
- Consumes: `none_added` on the upload response (Task 4). It is present only on fresh uploads in the session queue, not on rows listed from the database.
- Produces: nothing used elsewhere.

- [ ] **Step 1: Targets**

`src/api/index.js`:

```js
// How much data a sign needs before it can be trained (spec §4.3). Motion signs: one movement per clip, 3 clips;
// _none also fills up from the raise and lower of those clips.
export const MIN_STATIC_SAMPLES = 30;
export const targetFor = (sign) => (sign.kind === "static" ? 30 : sign.label === "_none" ? 6 : 3);
```

- [ ] **Step 2: Result text and hint**

`src/pages/SignDetail.jsx`, replace `resultText`:

```jsx
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const resultText = (kind, up) =>
  kind === "static"
    ? plural(up.samples_added, "sample")
    : plural(up.segments_found, "movement") + (up.none_added ? ` (+${up.none_added} for _none)` : "");
```

and the hint in `UploadBox`:

```jsx
        {sign.kind === "static"
          ? "Raise your hand, hold the letter still for about a second, lower it. Only the held part is used."
          : sign.label === "_none"
            ? "Ordinary hand movements that are not signs, with a pause between them. Each movement becomes one sample."
            : "Raise your hand, sign it once, lower it. One clip = one sample; the raise and lower also teach _none."}
```

- [ ] **Step 3: Build**

Run (from `senya-admin/`): `npm run build`
Expected: the build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add senya-admin/src/
git commit -m "admin: motion signs need 3 single-take clips; show the _none cuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and end-to-end check

**Files:**
- Modify: `docs/architecture.md` (§5.2 `POST /api/models/train` and uploads line, §5.4 `/extract`)
- Modify: `docs/2026-10-09-senya-design.md:200`

- [ ] **Step 1: Update the docs**

`docs/architecture.md`:
- Uploads line: the `201` body becomes `{id, filename, samples_added, segments_found, no_hand_frames, none_added}`.
- `POST /api/models/train` line: "(3+ sequences from 3+ uploads; `_none` 6+)".
- `/extract`: document the `mode` field and add after the static paragraph:

  > - `POST /extract` also takes `mode` (`single` | `multi`, default `multi`; motion only). The backend sends `single` for every motion sign except `_none`.
  >
  > **Single-take motion clips go rest → raise → (hold) → sign once → settle → lower → rest.** `find_single_take` finds the raise and lower by the wrist's vertical speed (`RAISE_SPEED`, 0.5 hand sizes/s). The sign starts at the first fast frame after the raise that keeps moving for `min_ms`, and ends at the first still frame that stays still for `stop_hold_ms` or runs into the lower. It then gets `pad_ms` in front. The response has one `sequences` entry plus `none_sequences` (the raise and lower), which the backend stores as `_none` samples of the same upload. On 40 real J clips from 4 signers this kept one J of 750–1950 ms every time.

`docs/2026-10-09-senya-design.md:200`: "Include motion signs with **≥ 3 sequences from ≥ 3 uploads**; `_none` needs **≥ 6** (single-take clips: one movement per clip, raise/lower harvested into `_none`)."

- [ ] **Step 2: End-to-end on the local stack (ports 8010/8002 only)**

1. `netstat -ano | findstr LISTENING | findstr ":8010 :8002"` → expect nothing.
2. Start the ML service from `senya-ml/` in the background: `BACKEND_URL=http://localhost:8010 .venv/Scripts/python.exe -m uvicorn app.main:app --port 8002` (it reads the other settings from `.env`).
3. Start the backend from `senya-backend/` in the background: `DB_SCHEMA=senya_demo PORT=8010 ML_SERVICE_URL=http://localhost:8002 node server.js`.
4. Log in (`POST /api/auth/login` with the `.env` admin), then create a static sign `A`, a static sign `B`, and a motion sign `J` with `start_shapes: ["I"]`.
5. Upload 2 static clips each from `LETTERS(A-L)/A/signer-01` and `LETTERS(A-L)/B/signer-01`.
6. Upload 3 J clips: `J/signer-01/IMG_4641.MOV`, `J/signer-02/IMG_4431.MOV`, `J/signer-03/IMG_4535.MOV`. Expect each response to have `segments_found: 1` and `none_added` of 1–2. `GET /api/signs` should show J `sample_count: 3` and `_none` at 5–6.
7. If `_none` has fewer than 6, upload a 4th J clip.
8. `POST /api/models/train` and poll `GET /api/models/:id` until `status` is `trained`. Expect `motion_labels` to contain `J` and `_none`.
9. Stop both background processes, then from `senya-backend/` drop the schema: `node -e "require('dotenv').config(); const {sequelize}=require('./src/config/db.js'); sequelize.query('DROP SCHEMA IF EXISTS senya_demo CASCADE').then(()=>sequelize.close())"`.

- [ ] **Step 3: Run every suite once more**

- `senya-ml/`: `.venv/Scripts/python.exe -m pytest -q`
- `senya-backend/`: `npm test`
- `senya-admin/`: `npm run build`

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: single-take motion clips and the new motion thresholds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Rollout note (not a task — the user decides)

- Restart the laptop ML service on :8001 after merging, then redeploy the Render backend. ML defaults to `multi`, so the order doesn't matter.
- J samples uploaded before this change (if any) are the contaminated kind. Deleting those uploads in the admin panel is recommended before training.
