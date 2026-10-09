import numpy as np

from app.core import contract, data


def test_resample_interpolates_and_clamps():
    # Same cases as the Kotlin MotionSegmenterTest.resampleInterpolatesAndClamps
    frames = [(0, np.zeros(contract.FLOATS, dtype="float32")), (100, np.full(contract.FLOATS, 10, dtype="float32"))]
    out = data.resample(frames, 0, 100, 3)
    assert out.shape == (3, contract.FLOATS)
    np.testing.assert_allclose([out[0][0], out[1][0], out[2][62]], [0, 5, 10], atol=1e-5)
    clamped = data.resample(frames, -50, 150, 2)
    np.testing.assert_allclose([clamped[0][0], clamped[1][0]], [0, 10], atol=1e-5)


def test_sequence_to_array_skips_missing_frames_and_spans_the_whole_sequence():
    zero = [0.0] * contract.FLOATS
    ten = [10.0] * contract.FLOATS
    seq = {"frames": [{"t_ms": 0, "landmarks": zero}, {"t_ms": 50, "landmarks": None}, {"t_ms": 100, "landmarks": ten}]}
    arr = data.sequence_to_array(seq)
    assert arr.shape == (contract.FRAMES, contract.FLOATS)
    np.testing.assert_allclose(arr[0][0], 0, atol=1e-5)
    np.testing.assert_allclose(arr[-1][0], 10, atol=1e-5)
    assert np.all(np.diff(arr[:, 0]) >= -1e-6)


def test_split_never_puts_an_upload_in_both_sets():
    items = [data.Item(x=np.zeros(1), label=i % 2, upload_id=100 + (i % 7) + 10 * (i % 2)) for i in range(60)]
    train, val, warnings = data.split_by_upload(items, val_fraction=0.2, seed=1)
    assert {i.upload_id for i in train}.isdisjoint({i.upload_id for i in val})
    assert len(train) + len(val) == len(items)
    assert val and train
    assert warnings == []


def test_split_single_upload_falls_back_to_random_with_warning():
    items = [data.Item(x=np.zeros(1), label=0, upload_id=1) for _ in range(50)]
    items += [data.Item(x=np.zeros(1), label=1, upload_id=2 + i % 5) for i in range(50)]
    train, val, warnings = data.split_by_upload(items, val_fraction=0.2, seed=1)
    assert len(val) >= 5
    assert any("only one upload" in w for w in warnings)
    # label 1 still has a clean upload split
    assert {i.upload_id for i in train if i.label == 1}.isdisjoint({i.upload_id for i in val if i.label == 1})


def test_synthetic_export_has_the_documented_shape():
    export = data.synthetic_export(seed=0)
    kinds = {s["kind"] for s in export["signs"]}
    assert kinds == {"static", "motion"}
    labels = {s["label"] for s in export["signs"]}
    assert {"A", "B", "C", "J", "Z", "_none"} <= labels
    static = next(s for s in export["signs"] if s["kind"] == "static")
    assert len(static["uploads"]) >= 3 and len(static["uploads"][0]["samples"][0]) == contract.FLOATS
    motion = next(s for s in export["signs"] if s["label"] == "J")
    assert len(motion["uploads"][0]["sequences"][0]["frames"][0]["landmarks"]) == contract.FLOATS
