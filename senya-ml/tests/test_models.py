import numpy as np

from app.core import contract, models


def rng():
    return np.random.default_rng(0)


def test_wrist_normalize_ignores_translation_and_scale():
    layer = models.WristNormalize()
    x = rng().random((4, 21, 3)).astype("float32")
    base = layer(x).numpy()
    moved = layer(x + np.array([0.2, -0.1, 0.05], dtype="float32")).numpy()
    scaled = layer(x * 2.5).numpy()
    np.testing.assert_allclose(moved, base, atol=1e-5)
    np.testing.assert_allclose(scaled, base, atol=1e-5)
    np.testing.assert_allclose(base[:, 0, :], 0, atol=1e-6)  # wrist is the origin


def test_sequence_normalize_uses_first_frame_and_keeps_motion():
    layer = models.SequenceNormalize()
    seq = rng().random((3, contract.FRAMES, 21, 3)).astype("float32")
    base = layer(seq).numpy()
    moved = layer(seq + np.array([0.3, 0.1, 0.0], dtype="float32")).numpy()
    scaled = layer(seq * 0.5).numpy()
    np.testing.assert_allclose(moved, base, atol=1e-5)
    np.testing.assert_allclose(scaled, base, atol=1e-5)
    # frame 0's wrist is the origin, but later frames keep their displacement (the path is the signal)
    np.testing.assert_allclose(base[:, 0, 0, :], 0, atol=1e-6)
    assert np.abs(base[:, -1, 0, :]).max() > 1e-3


def test_static_model_contract_shapes():
    m = models.build_static_model(5)
    assert m.input_shape == (None, contract.FLOATS)
    out = m(np.zeros((2, contract.FLOATS), dtype="float32")).numpy()
    assert out.shape == (2, 5)
    np.testing.assert_allclose(out.sum(axis=1), 1.0, atol=1e-5)


def test_motion_model_contract_shapes():
    m = models.build_motion_model(3)
    assert m.input_shape == (None, contract.FRAMES, contract.FLOATS)
    out = m(np.zeros((2, contract.FRAMES, contract.FLOATS), dtype="float32")).numpy()
    assert out.shape == (2, 3)
    np.testing.assert_allclose(out.sum(axis=1), 1.0, atol=1e-5)
