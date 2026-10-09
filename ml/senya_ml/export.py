"""Keras -> TFLite, the Keras-vs-TFLite check, and golden files (contract §3 items 3, 5, 10)."""
from __future__ import annotations

import hashlib
import json

import numpy as np
import tensorflow as tf


def to_tflite(model: tf.keras.Model) -> bytes:
    """Fixed batch of 1, as the contract requires: float32[1, 63] or float32[1, 32, 63]."""
    inp = tf.keras.Input(batch_shape=(1,) + tuple(model.input_shape[1:]))
    fixed = tf.keras.Model(inp, model(inp))
    return tf.lite.TFLiteConverter.from_keras_model(fixed).convert()


class TfliteRunner:
    def __init__(self, tflite_bytes: bytes):
        self.interp = tf.lite.Interpreter(model_content=tflite_bytes)
        self.interp.allocate_tensors()
        self.inp = self.interp.get_input_details()[0]
        self.out = self.interp.get_output_details()[0]

    @property
    def input_shape(self):
        return [int(v) for v in self.inp["shape"]]

    @property
    def output_shape(self):
        return [int(v) for v in self.out["shape"]]

    def predict_one(self, x: np.ndarray) -> np.ndarray:
        self.interp.set_tensor(self.inp["index"], x.astype("float32")[None, ...])
        self.interp.invoke()
        return self.interp.get_tensor(self.out["index"])[0]

    def predict(self, xs: np.ndarray) -> np.ndarray:
        return np.stack([self.predict_one(x) for x in xs])


def verify_matches(model: tf.keras.Model, tflite_bytes: bytes, xs: np.ndarray, atol: float = 1e-3) -> None:
    """Spec §4.3 step 5: the .tflite must predict like Keras, otherwise the version fails."""
    runner = TfliteRunner(tflite_bytes)
    keras_probs = model.predict(xs, verbose=0)
    tflite_probs = runner.predict(xs)
    if not np.allclose(keras_probs, tflite_probs, atol=atol) or not (keras_probs.argmax(1) == tflite_probs.argmax(1)).all():
        worst = float(np.abs(keras_probs - tflite_probs).max())
        raise RuntimeError(f"TFLite does not match Keras (max probability difference {worst:.4f})")


def make_golden(tflite_bytes: bytes, xs: np.ndarray, ys: np.ndarray, labels: list, limit: int, motion: bool) -> list:
    """Up to `limit` validation samples the TFLite model gets RIGHT, spread across classes. The app requires
    every golden label to be predicted, so wrong ones are never included."""
    runner = TfliteRunner(tflite_bytes)
    pred = runner.predict(xs).argmax(axis=1)
    per_class = {c: [i for i in range(len(ys)) if ys[i] == c and pred[i] == c] for c in range(len(labels))}
    chosen, round_ = [], 0
    while len(chosen) < limit and any(round_ < len(v) for v in per_class.values()):
        for c in range(len(labels)):
            if round_ < len(per_class[c]) and len(chosen) < limit:
                chosen.append(per_class[c][round_])
        round_ += 1
    key = "frames" if motion else "landmarks"
    return [{key: xs[i].astype("float32").tolist(), "label": labels[int(ys[i])]} for i in chosen]


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def dumps(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")
