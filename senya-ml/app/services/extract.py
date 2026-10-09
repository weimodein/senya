"""Landmark extraction from an uploaded clip or image (docs/architecture.md §4.1).

OpenCV decodes the clip, MediaPipe Tasks finds the hand, and the idle head/tail of the clip is trimmed to the
signing span. The output is the contract format: ONE hand, 63 RAW floats per frame (CONTRACT.md §3 item 1), never
normalized — the models do that.

The clip itself is written to a temp file only for decoding and deleted before returning.
"""
from __future__ import annotations

import base64
import os
import tempfile
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.core import contract
from app.services.segmenter import segment_clip

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


def _static_from_video(frames: list) -> dict:
    span = _signing_span(frames)
    if span is None:
        raise ExtractionError("no hand found in this clip")
    inside = [f for f in frames if span[0] <= f["t_ms"] <= span[1]]
    picked, next_t = [], None
    for f in inside:
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


def _motion_from_video(frames: list) -> dict:
    segments = segment_clip([{"t_ms": f["t_ms"], "landmarks": f["landmarks"]} for f in frames])
    if not segments:
        raise ExtractionError("no complete movement found (sign, pause, sign again; keep the hand in view)")
    by_t = {f["t_ms"]: f for f in frames}
    sequences = []
    for s in segments:
        hand_frames = [by_t[f["t_ms"]] for f in s.frames if f["landmarks"] is not None and f["t_ms"] in by_t]
        middle = hand_frames[len(hand_frames) // 2] if hand_frames else None
        sequences.append({
            "duration_ms": int(round(s.end_ms - s.start_ms)),
            "handedness": next((f["handedness"] for f in hand_frames if f["handedness"]), None),
            "thumb": _thumb(middle["bgr"]) if middle else None,
            "frames": s.frames,
        })
    return {"kind": "motion", "no_hand_frames": sum(1 for f in frames if f["landmarks"] is None),
            "sequences": sequences}


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


def extract(data: bytes, filename: str, kind: str) -> dict:
    """One uploaded file -> the body the backend stores (architecture.md §5.4)."""
    if kind not in ("static", "motion"):
        raise ValueError("kind must be 'static' or 'motion'")
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
    result = _static_from_video(frames) if kind == "static" else _motion_from_video(frames)
    if kind == "static" and not result["samples"]:
        raise ExtractionError("no hand found in this clip")
    assert all(len(s["landmarks"]) == contract.FLOATS for s in result.get("samples", []))
    return result
