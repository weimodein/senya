"""Landmark extraction from an uploaded clip or image (docs/architecture.md §4.1).

OpenCV decodes the clip, MediaPipe Tasks finds the hand, and the idle head/tail of the clip is trimmed to the
signing span. The output is the contract format: ONE hand, 63 RAW floats per frame (CONTRACT.md §3 item 1), never
normalized — the models do that.

The clip itself is written to a temp file only for decoding and deleted before returning.
"""
from __future__ import annotations

import base64
import math
import os
import tempfile
from dataclasses import dataclass
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.core import contract
from app.services.segmenter import DEFAULT_CONFIG as SEGMENTER_DEFAULTS, Segment, segment_clip

MODEL_PATH = os.getenv("HAND_LANDMARKER_MODEL",
                       os.path.join(os.path.dirname(__file__), "..", "models", "hand_landmarker.task"))

# Static signs: one sample every STATIC_STEP_MS inside the signing span, at most STATIC_MAX_SAMPLES per clip
# (neighbouring frames are near-duplicates; the trainer splits by upload, so more per clip adds little).
STATIC_STEP_MS = int(os.getenv("STATIC_STEP_MS", 100))
STATIC_MAX_SAMPLES = int(os.getenv("STATIC_MAX_SAMPLES", 60))
# Motion signs: analyse at most this many frames per second (the app runs at ~15–30 fps).
MOTION_MAX_FPS = float(os.getenv("MOTION_MAX_FPS", 30))
# Padding kept around the detected signing span, so the start and end of the movement survive.
TRIM_PAD_MS = int(os.getenv("TRIM_PAD_MS", 150))
# Static signs: only the HOLD is kept (see find_hold). Speeds are in hand sizes per second.
HOLD_SPEED = float(os.getenv("HOLD_SPEED", 0.5))
MIN_HOLD_MS = int(os.getenv("MIN_HOLD_MS", 300))
HOLD_TRIM_MS = int(os.getenv("HOLD_TRIM_MS", 100))
# Motion signs, one per clip: the wrist rising (or dropping) faster than this, in hand sizes per second, is the
# raise (or the lower) around the sign.
RAISE_SPEED = float(os.getenv("RAISE_SPEED", 0.5))
MAX_SIDE = int(os.getenv("EXTRACT_MAX_SIDE", 640))
DEFAULT_FPS = 30.0
THUMB_SIZE = 72


class ExtractionError(ValueError):
    """The clip was readable but held nothing usable. The router turns it into a 422."""


def _landmarker(mode):
    path = os.path.abspath(MODEL_PATH)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"HandLandmarker model not found: {path} (see app/models/README.md)")
    return vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=path),
        running_mode=mode,
        num_hands=1,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    ))


def _flatten(result):
    """MediaPipe result -> (63 raw floats | None, handedness | None)."""
    if not result.hand_landmarks:
        return None, None
    hand = result.hand_landmarks[0]
    floats = [float(v) for p in hand for v in (p.x, p.y, p.z)]
    side = result.handedness[0][0].category_name if result.handedness else None
    return floats, side


def _mp_image(bgr):
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


def _thumb(bgr) -> str:
    h, w = bgr.shape[:2]
    s = min(h, w)
    crop = bgr[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    ok, jpg = cv2.imencode(".jpg", cv2.resize(crop, (THUMB_SIZE, THUMB_SIZE)), [cv2.IMWRITE_JPEG_QUALITY, 60])
    return "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode() if ok else None


def _downscale(bgr):
    """Phone clips are often 1080p+; MediaPipe resizes internally anyway. Landmarks are normalized (0..1), so a
    uniform resize doesn't change them; it only makes decoding-to-detection much cheaper."""
    h, w = bgr.shape[:2]
    scale = MAX_SIDE / max(h, w)
    return cv2.resize(bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else bgr


def _read_frames(path: str):
    """Decodes the clip sequentially (no seeking: reliable on every OpenCV backend), keeping at most
    MOTION_MAX_FPS frames per second. Yields (t_ms, bgr)."""
    cap = cv2.VideoCapture(path)
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not np.isfinite(fps) or fps <= 1.0:
            fps = DEFAULT_FPS
        every = max(1, round(fps / MOTION_MAX_FPS))
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if i % every == 0:
                yield int(round(i * 1000 / fps)), _downscale(frame)
            i += 1
    finally:
        cap.release()  # before the caller unlinks the file: Windows keeps it locked otherwise


def _track_video(path: str) -> list:
    """Every kept frame -> {t_ms, landmarks|None, handedness, bgr}. VIDEO mode tracks the hand between frames,
    like the app's live camera."""
    out = []
    with _landmarker(vision.RunningMode.VIDEO) as lm:
        for t_ms, bgr in _read_frames(path):
            landmarks, side = _flatten(lm.detect_for_video(_mp_image(bgr), t_ms))
            out.append({"t_ms": t_ms, "landmarks": landmarks, "handedness": side, "bgr": bgr})
    if not out:
        raise ExtractionError("could not decode any frames from this file")
    return out


def _signing_span(frames: list) -> Optional[tuple]:
    """First/last time a hand is seen, padded: drops the idle head and tail of the clip."""
    hits = [f["t_ms"] for f in frames if f["landmarks"] is not None]
    if not hits:
        return None
    return hits[0] - TRIM_PAD_MS, hits[-1] + TRIM_PAD_MS


def _hand_size(p) -> float:
    return max(math.hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]) for i in range(1, contract.POINTS))


def _smooth3(raw: list) -> list:
    """Mean over each value and its neighbours; None where any of them is None."""
    out = []
    for i in range(len(raw)):
        window = raw[max(0, i - 1):i + 2]
        out.append(None if any(v is None for v in window) else sum(window) / len(window))
    return out


def _speeds(frames: list) -> list:
    """Hand speed per frame, in hand sizes per second (the segmenter's unit), smoothed over 3 frames.
    None where the hand is missing in this or the previous frame."""
    raw, prev = [], None
    for f in frames:
        cur, before = f["landmarks"], prev["landmarks"] if prev else None
        if cur is None or before is None:
            raw.append(None)
        else:
            dt = (f["t_ms"] - prev["t_ms"]) / 1000
            size = _hand_size(cur)
            moved = sum(math.hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
                        for i in range(contract.POINTS))
            raw.append(moved / contract.POINTS / size / dt if dt > 0 and size > 0 else None)
        prev = f
    return _smooth3(raw)


def find_hold(frames: list) -> Optional[list]:
    """The frames where the letter is actually held: clips go rest -> raise -> HOLD -> lower -> rest.

    Measured on real FSL letter clips, the raise and lower move at 3-17 hand sizes/s and the hold at 0.0-0.3, so
    the hold is a run of near-still frames. Several runs can exist (a visible resting hand is still too); the hold
    is the one where the hand is highest (smallest wrist y), since signers raise the hand to sign. Its first and
    last HOLD_TRIM_MS are dropped: that is where the hand settles in and starts to leave.
    """
    speeds = _speeds(frames)
    runs, start = [], None
    for i, s in enumerate(speeds + [None]):
        still = s is not None and s <= HOLD_SPEED
        if still and start is None:
            start = i
        elif not still and start is not None:
            runs.append((start, i - 1))
            start = None
    runs = [(a, b) for a, b in runs if frames[b]["t_ms"] - frames[a]["t_ms"] >= MIN_HOLD_MS]
    if not runs:
        return None

    def height(run):  # median wrist y over the run; smaller = higher in the picture
        ys = sorted(frames[i]["landmarks"][1] for i in range(run[0], run[1] + 1))
        return ys[len(ys) // 2]

    a, b = min(runs, key=lambda r: (round(height(r), 2), -(r[1] - r[0])))
    lo, hi = frames[a]["t_ms"] + HOLD_TRIM_MS, frames[b]["t_ms"] - HOLD_TRIM_MS
    return [f for f in frames[a:b + 1] if lo <= f["t_ms"] <= hi] or frames[a:b + 1]


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


def _static_from_video(frames: list) -> dict:
    if _signing_span(frames) is None:
        raise ExtractionError("no hand found in this clip")
    hold = find_hold(frames)
    if hold is None:
        raise ExtractionError("the hand never held still: hold the letter steady for about a second")
    picked, next_t = [], None
    for f in hold:
        if next_t is None or f["t_ms"] >= next_t:
            picked.append(f)
            next_t = f["t_ms"] + STATIC_STEP_MS
    with_hand = [f for f in picked if f["landmarks"] is not None]
    if len(with_hand) > STATIC_MAX_SAMPLES:
        idx = np.linspace(0, len(with_hand) - 1, STATIC_MAX_SAMPLES).round().astype(int)
        with_hand = [with_hand[i] for i in idx]
    return {
        "kind": "static",
        "no_hand_frames": len(picked) - sum(1 for f in picked if f["landmarks"] is not None),
        "samples": [{"landmarks": f["landmarks"], "handedness": f["handedness"], "frame_index": k,
                     "thumb": _thumb(f["bgr"]) if k % 8 == 0 else None}
                    for k, f in enumerate(with_hand)],
    }


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


def _from_image(data: bytes) -> dict:
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ExtractionError("could not read this image")
    with _landmarker(vision.RunningMode.IMAGE) as lm:
        landmarks, side = _flatten(lm.detect(_mp_image(bgr)))
    if landmarks is None:
        raise ExtractionError("no hand found in this image")
    return {"kind": "static", "no_hand_frames": 0,
            "samples": [{"landmarks": landmarks, "handedness": side, "frame_index": 0, "thumb": _thumb(bgr)}]}


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MODES = ("single", "multi")


def extract(data: bytes, filename: str, kind: str, mode: str = "multi") -> dict:
    """One uploaded file -> the body the backend stores (architecture.md §5.4). mode only applies to motion signs:
    "single" = one movement per clip (raise, sign, lower), "multi" = the movement repeated with pauses."""
    if kind not in ("static", "motion"):
        raise ValueError("kind must be 'static' or 'motion'")
    if mode not in MODES:
        raise ValueError("mode must be 'single' or 'multi'")
    # Keep the real extension: OpenCV picks its decoder from it on Windows, and a wrong suffix makes decoding silently fail.
    suffix = os.path.splitext(filename or "")[1].lower() or ".mp4"
    if suffix in IMAGE_SUFFIXES:
        if kind == "motion":
            raise ExtractionError("motion signs need a video, not an image")
        return _from_image(data)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        frames = _track_video(path)
    finally:
        os.unlink(path)
    if kind == "static":
        result = _static_from_video(frames)
    else:
        result = _single_from_video(frames) if mode == "single" else _motion_from_video(frames)
    if kind == "static" and not result["samples"]:
        raise ExtractionError("no hand found in this clip")
    assert all(len(s["landmarks"]) == contract.FLOATS for s in result.get("samples", []))
    return result
