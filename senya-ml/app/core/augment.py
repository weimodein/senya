"""Augmentation (spec §4.3). Works on arrays shaped [..., 21, 3] reshaped from/to the flat 63 floats."""
import math

import numpy as np

from . import contract


def _pts(a):
    return np.asarray(a, dtype="float32").reshape(*np.shape(a)[:-1], contract.POINTS, 3)


def mirror_x(a):
    """Flip left/right in normalized image coordinates, so either hand works."""
    p = _pts(a).copy()
    p[..., 0] = 1.0 - p[..., 0]
    return p.reshape(np.shape(a))


def rotate_scale_noise(a, rng, max_deg=15.0, scale=0.10, noise=0.004):
    """One random rotation (about the wrist, xy plane), scale (about the wrist) and Gaussian noise.
    For a sequence the same rotation/scale is used for every frame (the whole movement is rotated)."""
    p = _pts(a).copy()
    origin = p.reshape(-1, contract.POINTS, 3)[0, 0].copy()  # wrist of the sample / of the first frame
    theta = np.deg2rad(rng.uniform(-max_deg, max_deg))
    s = 1.0 + rng.uniform(-scale, scale)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], dtype="float32")
    rel = p - origin
    rel[..., :2] = rel[..., :2] @ rot.T
    out = origin + rel * s + rng.normal(0, noise, size=p.shape).astype("float32")
    return out.astype("float32").reshape(np.shape(a))


def time_warp(seq, rng, amount=0.2):
    """Smooth monotonic change of speed, +-amount. seq is [T, 63]."""
    t = seq.shape[0]
    u = np.linspace(0.0, 1.0, t)
    amp = rng.uniform(-amount, amount)
    warped = np.clip(u + amp * np.sin(2 * np.pi * u) / (2 * np.pi), 0.0, 1.0)
    pos = warped * (t - 1)
    base = np.arange(t)
    return np.stack([np.interp(pos, base, seq[:, j]) for j in range(seq.shape[1])], axis=1).astype("float32")


def augment_static(x, rng, copies=2):
    """[N, 63] -> original + mirrored + `copies` random variants of each (so ~ (2 + 2*copies) x N)."""
    parts = [x, mirror_x(x)]
    for _ in range(copies):
        for base in (x, mirror_x(x)):
            parts.append(np.stack([rotate_scale_noise(row, rng) for row in base]))
    return np.concatenate(parts, axis=0)


def augment_sequence(raw_to_array, seq, rng, copies=3):
    """One raw sequence dict -> list of [32, 63] arrays: plain, mirrored, and random variants with
    boundary jitter (+-100 ms), time warp, rotation, scale and noise."""
    plain = raw_to_array(seq)
    out = [plain, mirror_x(plain)]
    for _ in range(copies):
        arr = raw_to_array(seq, start_jitter_ms=rng.uniform(-100, 100), end_jitter_ms=rng.uniform(-100, 100))
        arr = time_warp(arr, rng)
        arr = rotate_scale_noise(arr, rng)
        out.append(mirror_x(arr) if rng.random() < 0.5 else arr)
    return out


def copies_for(n_items: int, base: int = 3, floor: int = 40) -> int:
    """Random variants per sequence so a label with few training sequences still gets about `floor` arrays
    (each sequence also gives a plain and a mirrored one). Never fewer than `base`."""
    if n_items <= 0:
        return base
    return max(base, math.ceil(floor / n_items) - 2)
