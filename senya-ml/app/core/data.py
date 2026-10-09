"""Dataset handling: resampling, split by upload, loading the server export, and synthetic data."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import contract


@dataclass
class Item:
    x: np.ndarray            # [63] static, or [32, 63] motion
    label: int
    upload_id: int


# ---------------------------------------------------------------- resampling (contract §3 item 7)

def resample(frames: list, from_ms: float, to_ms: float, t: int = contract.FRAMES) -> np.ndarray:
    """frames = [(t_ms, [63 floats])] with a hand, sorted by time. Linear interpolation at t evenly spaced times;
    clamps to the first/last frame outside their range. Mirrors the Kotlin MotionSegmenter.resample."""
    times = np.array([f[0] for f in frames], dtype="float64")
    values = np.array([np.asarray(f[1], dtype="float32") for f in frames])
    out = np.empty((t, contract.FLOATS), dtype="float32")
    for k in range(t):
        tk = from_ms + k * (to_ms - from_ms) / (t - 1)
        after = int(np.searchsorted(times, tk, side="left"))
        if after >= len(times):
            out[k] = values[-1]
        elif after == 0:
            out[k] = values[0]
        else:
            ta, tb = times[after - 1], times[after]
            w = 1.0 if tb == ta else (tk - ta) / (tb - ta)
            out[k] = values[after - 1] + (values[after] - values[after - 1]) * w
    return out


def sequence_to_array(seq: dict, start_jitter_ms: float = 0.0, end_jitter_ms: float = 0.0) -> np.ndarray:
    """One exported sequence -> [32, 63]. Spans first..last frame time; the jitters move the start/end (augmentation)."""
    frames = seq["frames"]
    with_hand = [(f["t_ms"], f["landmarks"]) for f in frames if f.get("landmarks") is not None]
    if not with_hand:
        raise ValueError("sequence has no frame with a hand")
    start, end = frames[0]["t_ms"] + start_jitter_ms, frames[-1]["t_ms"] + end_jitter_ms
    if end <= start:
        start, end = frames[0]["t_ms"], frames[-1]["t_ms"]
    return resample(with_hand, start, end)


# ---------------------------------------------------------------- split by upload (spec §4.3)

def split_by_upload(items: list, val_fraction: float = 0.2, seed: int = 0):
    """Per label, whole uploads go to either train or val. A label with one upload falls back to a random split
    for that label and adds a warning. Returns (train, val, warnings)."""
    rng = np.random.default_rng(seed)
    train, val, warnings = [], [], []
    for label in sorted({i.label for i in items}):
        group = [i for i in items if i.label == label]
        uploads = sorted({i.upload_id for i in group})
        if len(uploads) < 2:
            idx = rng.permutation(len(group))
            n_val = max(1, int(round(len(group) * val_fraction)))
            val += [group[j] for j in idx[:n_val]]
            train += [group[j] for j in idx[n_val:]]
            warnings.append(f"label {label}: only one upload, used a random split (accuracy will look better than it is)")
            continue
        order = rng.permutation(len(uploads))
        n_val_uploads = max(1, int(round(len(uploads) * val_fraction)))
        val_ids = {uploads[j] for j in order[:n_val_uploads]}
        for i in group:
            (val if i.upload_id in val_ids else train).append(i)
    return train, val, warnings


# ---------------------------------------------------------------- loading the server export

@dataclass
class Dataset:
    static_labels: list
    static_items: list
    motion_labels: list
    motion_items: list          # x is the RAW sequence dict here so augmentation can jitter bounds
    skipped: list


def load_export(export: dict) -> Dataset:
    """GET /api/export -> Dataset, applying the minimum-data rules of spec §4.3."""
    skipped = []
    static_signs, motion_signs = [], []
    for sign in export["signs"]:
        uploads = sign["uploads"]
        if sign["kind"] == "static":
            n = sum(len(u["samples"]) for u in uploads)
            if n >= contract.MIN_STATIC_SAMPLES:
                static_signs.append(sign)
            else:
                skipped.append(f"{sign['label']}: {n} samples (needs {contract.MIN_STATIC_SAMPLES})")
        else:
            n = sum(len(u["sequences"]) for u in uploads)
            n_up = sum(1 for u in uploads if u["sequences"])
            need = contract.MIN_NONE_SEQUENCES if sign["label"] == contract.NONE_LABEL else contract.MIN_MOTION_SEQUENCES
            if n >= need and (sign["label"] == contract.NONE_LABEL or n_up >= contract.MIN_MOTION_UPLOADS):
                motion_signs.append(sign)
            else:
                skipped.append(f"{sign['label']}: {n} sequences from {n_up} uploads (needs {need}"
                               f"{'' if sign['label'] == contract.NONE_LABEL else f' from {contract.MIN_MOTION_UPLOADS} uploads'})")

    static_labels = [s["label"] for s in static_signs]
    static_items = [Item(np.asarray(sample, dtype="float32"), static_labels.index(s["label"]), u["id"])
                    for s in static_signs for u in s["uploads"] for sample in u["samples"]]

    has_real_motion = any(s["label"] != contract.NONE_LABEL for s in motion_signs)
    motion_labels, motion_items = [], []
    if has_real_motion and any(s["label"] == contract.NONE_LABEL for s in motion_signs):
        # _none first, so index 0 is "not a sign" (matches the spec's example ["_none", "J", "Z"])
        ordered = sorted(motion_signs, key=lambda s: (s["label"] != contract.NONE_LABEL, s["label"]))
        motion_labels = [s["label"] for s in ordered]
        motion_items = [Item(seq, motion_labels.index(s["label"]), u["id"])
                        for s in ordered for u in s["uploads"] for seq in u["sequences"]]
    elif has_real_motion:
        skipped.append("motion model skipped: no usable _none class (needs at least "
                       f"{contract.MIN_NONE_SEQUENCES} sequences of non-sign movement)")
    return Dataset(static_labels, static_items, motion_labels, motion_items, skipped)


# ---------------------------------------------------------------- synthetic data (pipeline tests, dummy models)

def _pose(rng, spread=0.12):
    """A random fixed hand pose: wrist near the middle, 20 other points around it."""
    wrist = np.array([0.5, 0.6, 0.0])
    pts = wrist + rng.normal(0, spread, size=(contract.POINTS, 3))
    pts[0] = wrist
    return pts


def _static_sample(pose, rng, noise=0.004):
    shift = rng.normal(0, 0.05, size=3) * np.array([1, 1, 0])
    scale = rng.uniform(0.85, 1.15)
    pts = pose[0] + (pose - pose[0]) * scale + shift + rng.normal(0, noise, size=pose.shape)
    return pts.astype("float32").reshape(-1).tolist()


def _path(kind, t):
    """Fingertip displacement for u in [0, 1]: J = hook, Z = zigzag, none = small wobble."""
    u = np.asarray(t)
    if kind == "J":
        return np.stack([0.08 * np.sin(np.pi * u * 0.5), 0.15 * u + 0.05 * np.sin(np.pi * u), np.zeros_like(u)], axis=-1)
    if kind == "Z":
        return np.stack([0.15 * np.abs(((u * 3) % 2) - 1) - 0.07, 0.12 * u, np.zeros_like(u)], axis=-1)
    return np.stack([0.01 * np.sin(6 * u), 0.01 * np.cos(5 * u), np.zeros_like(u)], axis=-1)


def _motion_sequence(kind, pose, rng, fps=30):
    n = int(rng.integers(14, 26))
    u = np.linspace(0, 1, n)
    disp = _path(kind, u)
    base = pose + rng.normal(0, 0.003, size=pose.shape)
    frames = []
    for i in range(n):
        pts = base.copy()
        pts += disp[i]  # the whole hand travels along the path
        pts += rng.normal(0, 0.002, size=pts.shape)
        miss = rng.random() < 0.05
        frames.append({"t_ms": int(i * 1000 / fps),
                       "landmarks": None if miss else pts.astype("float32").reshape(-1).tolist()})
    if frames[0]["landmarks"] is None:
        frames[0]["landmarks"] = frames[1]["landmarks"] or base.astype("float32").reshape(-1).tolist()
    if frames[-1]["landmarks"] is None:
        frames[-1]["landmarks"] = base.astype("float32").reshape(-1).tolist()
    return {"frames": frames}


def synthetic_export(seed: int = 0, static_letters: str = "ABC", n_uploads: int = 4,
                     per_upload: int = 25, seq_per_upload: int = 14) -> dict:
    """Fake GET /api/export output with learnable structure: A, B, C static; J, Z, _none motion."""
    rng = np.random.default_rng(seed)
    signs, upload_id = [], 1
    for letter in static_letters:
        pose = _pose(rng)
        uploads = []
        for _ in range(n_uploads):
            uploads.append({"id": upload_id, "samples": [_static_sample(pose, rng) for _ in range(per_upload)]})
            upload_id += 1
        signs.append({"label": letter, "kind": "static", "start_shapes": None, "uploads": uploads})
    pose = _pose(rng)
    for label in ("J", "Z", contract.NONE_LABEL):
        uploads = []
        for _ in range(n_uploads):
            uploads.append({"id": upload_id, "sequences": [_motion_sequence(label if label != contract.NONE_LABEL else "none", pose, rng)
                                                           for _ in range(seq_per_upload)]})
            upload_id += 1
        signs.append({"label": label, "kind": "motion",
                      "start_shapes": ["I"] if label == "J" else ([] if label == "Z" else None), "uploads": uploads})
    return {"signs": signs}
