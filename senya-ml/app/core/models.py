"""Keras models (spec §4.3). Normalization lives INSIDE the models (contract §3 items 2 and 6)."""
import tensorflow as tf

from . import contract

EPS = 1e-6


@tf.keras.utils.register_keras_serializable(package="senya")
class WristNormalize(tf.keras.layers.Layer):
    """[B, 21, 3] -> subtract the wrist (point 0), divide by the largest distance from the wrist."""

    def call(self, x):
        rel = x - x[:, 0:1, :]
        size = tf.reduce_max(tf.norm(rel, axis=-1), axis=-1)  # [B]
        return rel / (size[:, None, None] + EPS)


@tf.keras.utils.register_keras_serializable(package="senya")
class SequenceNormalize(tf.keras.layers.Layer):
    """[B, T, 21, 3] -> subtract FRAME 0's wrist from every frame, divide by FRAME 0's hand size.

    Using frame 0 for everything keeps the path of the movement (the signal) and removes position and distance.
    """

    def call(self, x):
        wrist0 = x[:, 0:1, 0:1, :]  # [B, 1, 1, 3]
        rel = x - wrist0
        size0 = tf.reduce_max(tf.norm(rel[:, 0], axis=-1), axis=-1)  # [B]
        return rel / (size0[:, None, None, None] + EPS)


def build_static_model(n_classes: int) -> tf.keras.Model:
    inp = tf.keras.Input(shape=(contract.FLOATS,), name="landmarks")
    x = tf.keras.layers.Reshape((contract.POINTS, 3))(inp)
    x = WristNormalize()(x)
    x = tf.keras.layers.Flatten()(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    out = tf.keras.layers.Dense(n_classes, activation="softmax", name="probabilities")(x)
    return tf.keras.Model(inp, out, name="senya_static")


def build_motion_model(n_classes: int) -> tf.keras.Model:
    """Conv1D, not LSTM/GRU: converts to TFLite reliably (spec §4.3)."""
    inp = tf.keras.Input(shape=(contract.FRAMES, contract.FLOATS), name="frames")
    x = tf.keras.layers.Reshape((contract.FRAMES, contract.POINTS, 3))(inp)
    x = SequenceNormalize()(x)
    x = tf.keras.layers.Reshape((contract.FRAMES, contract.FLOATS))(x)
    x = tf.keras.layers.Conv1D(64, 5, padding="same", activation="relu")(x)
    x = tf.keras.layers.Conv1D(64, 5, padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPool1D(2)(x)
    x = tf.keras.layers.Conv1D(128, 3, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalMaxPool1D()(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    out = tf.keras.layers.Dense(n_classes, activation="softmax", name="probabilities")(x)
    return tf.keras.Model(inp, out, name="senya_motion")
