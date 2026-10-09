"""Training (spec §4.3): split by upload, augment the training set only, early stopping, report."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
import tensorflow as tf

from . import augment, contract, data, models

ProgressFn = Callable[[float, str], None]


@dataclass
class Trained:
    model: tf.keras.Model
    labels: list
    val_x: np.ndarray
    val_y: np.ndarray
    report: dict
    warnings: list = field(default_factory=list)


def _report(model, val_x, val_y, labels, warnings, n_train, n_val) -> dict:
    probs = model.predict(val_x, verbose=0)
    pred = probs.argmax(axis=1)
    per_class = {}
    for i, name in enumerate(labels):
        mask = val_y == i
        per_class[name] = float((pred[mask] == i).mean()) if mask.any() else None
    confused = Counter((labels[t], labels[p]) for t, p in zip(val_y, pred) if t != p)
    return {
        "overall_val_accuracy": float((pred == val_y).mean()),
        "per_class": per_class,
        "most_confused": [{"true": t, "pred": p, "count": c} for (t, p), c in confused.most_common(5)],
        "warnings": warnings, "train_samples": n_train, "val_samples": n_val,
    }


def _fit(model, x, y, val_x, val_y, epochs, seed, progress: Optional[ProgressFn], tag: str, base: float, span: float):
    class Reporter(tf.keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            if progress:
                progress(base + span * (epoch + 1) / epochs, f"{tag} epoch {epoch + 1}/{epochs}")

    tf.keras.utils.set_random_seed(seed)
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    model.fit(
        x, y, validation_data=(val_x, val_y), epochs=epochs, batch_size=64, verbose=0, shuffle=True,
        callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True), Reporter()],
    )


def train_static(items: list, labels: list, epochs: int = 60, seed: int = 0, progress: Optional[ProgressFn] = None,
                 base: float = 0.0, span: float = 0.5) -> Trained:
    if len(labels) < 2:
        raise ValueError("need at least 2 static signs with enough samples to train")
    train, val, warnings = data.split_by_upload(items, seed=seed)
    rng = np.random.default_rng(seed)
    tx = np.stack([i.x for i in train]).astype("float32")
    ty = np.array([i.label for i in train])
    vx = np.stack([i.x for i in val]).astype("float32")
    vy = np.array([i.label for i in val])
    ax = augment.augment_static(tx, rng)
    ay = np.tile(ty, len(ax) // len(tx))
    model = models.build_static_model(len(labels))
    _fit(model, ax, ay, vx, vy, epochs, seed, progress, "static", base, span)
    return Trained(model, labels, vx, vy, _report(model, vx, vy, labels, warnings, len(ax), len(vx)), warnings)


def train_motion(items: list, labels: list, epochs: int = 50, seed: int = 0, progress: Optional[ProgressFn] = None,
                 base: float = 0.5, span: float = 0.4) -> Trained:
    """items hold RAW sequence dicts in .x (see data.load_export)."""
    train, val, warnings = data.split_by_upload(items, seed=seed)
    rng = np.random.default_rng(seed)
    ax, ay = [], []
    for it in train:
        for arr in augment.augment_sequence(data.sequence_to_array, it.x, rng):
            ax.append(arr)
            ay.append(it.label)
    vx = np.stack([data.sequence_to_array(i.x) for i in val]).astype("float32")
    vy = np.array([i.label for i in val])
    ax = np.stack(ax).astype("float32")
    ay = np.array(ay)
    model = models.build_motion_model(len(labels))
    _fit(model, ax, ay, vx, vy, epochs, seed, progress, "motion", base, span)
    report = _report(model, vx, vy, labels, warnings, len(ax), len(vx))
    none = labels.index(contract.NONE_LABEL)
    pred = model.predict(vx, verbose=0).argmax(axis=1)
    real = vy != none
    report["real_signs_read_as_none"] = float((pred[real] == none).mean()) if real.any() else None
    report["none_read_as_a_sign"] = float((pred[~real] != none).mean()) if (~real).any() else None
    return Trained(model, labels, vx, vy, report, warnings)
