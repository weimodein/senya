import json

import numpy as np
import pytest

from app.core import contract, data, export, pipeline, train


@pytest.fixture(scope="module")
def result():
    # small and fast: this proves the plumbing, not the accuracy of real signs
    return pipeline.run(data.synthetic_export(seed=0), static_epochs=25, motion_epochs=25, seed=0)


def test_produces_every_contract_file(result):
    assert set(result.files) == {
        contract.MODEL, contract.LABELS, contract.GOLDEN,
        contract.MOTION_MODEL, contract.MOTION_LABELS, contract.MOTION_CONFIG, contract.MOTION_GOLDEN,
    }


def test_tflite_shapes_match_the_contract(result):
    static = export.TfliteRunner(result.files[contract.MODEL])
    motion = export.TfliteRunner(result.files[contract.MOTION_MODEL])
    assert static.input_shape == [1, 63] and static.output_shape == [1, 3]
    assert motion.input_shape == [1, 32, 63] and motion.output_shape == [1, 3]


def test_labels_files_match_output_size(result):
    assert json.loads(result.files[contract.LABELS]) == ["A", "B", "C"]
    assert json.loads(result.files[contract.MOTION_LABELS]) == ["_none", "J", "Z"]


def test_the_learnable_synthetic_signs_are_learned(result):
    assert result.meta["val_accuracy"] > 0.9
    assert result.meta["motion_val_accuracy"] > 0.8


def test_golden_files_pass_through_the_published_tflite(result):
    """Exactly what the Android app checks before accepting a version."""
    for model_file, labels_file, golden_file, key in [
        (contract.MODEL, contract.LABELS, contract.GOLDEN, "landmarks"),
        (contract.MOTION_MODEL, contract.MOTION_LABELS, contract.MOTION_GOLDEN, "frames"),
    ]:
        runner = export.TfliteRunner(result.files[model_file])
        labels = json.loads(result.files[labels_file])
        golden = json.loads(result.files[golden_file])
        assert len(golden) >= 3
        for sample in golden:
            probs = runner.predict_one(np.array(sample[key], dtype="float32"))
            assert labels[int(probs.argmax())] == sample["label"]


def test_motion_config_has_the_contract_keys(result):
    config = json.loads(result.files[contract.MOTION_CONFIG])
    assert set(contract.MOTION_CONFIG_DEFAULT) <= set(config)
    assert config["T"] == 32


def test_static_only_when_no_motion_data():
    ex = data.synthetic_export(seed=1)
    ex["signs"] = [s for s in ex["signs"] if s["kind"] == "static"]
    res = pipeline.run(ex, static_epochs=5)
    assert contract.MOTION_MODEL not in res.files and "motion_labels" not in res.meta


def test_not_enough_data_is_a_clear_error():
    ex = data.synthetic_export(seed=1, n_uploads=2, per_upload=5)
    with pytest.raises(ValueError, match="not enough data"):
        pipeline.run(ex, static_epochs=1)


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
