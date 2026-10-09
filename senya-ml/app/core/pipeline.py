"""The whole training pipeline: export dict -> the model files of one version (contract §3)."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import contract, data, export, train


@dataclass
class Result:
    files: dict          # contract file name -> bytes
    meta: dict           # what POST /api/models wants in its "meta" field
    skipped: list


def run(export_json: dict, static_epochs: int = 60, motion_epochs: int = 50, seed: int = 0,
        progress: Optional[train.ProgressFn] = None, start_shapes: Optional[dict] = None) -> Result:
    ds = data.load_export(export_json)
    if len(ds.static_labels) < 2:
        raise ValueError("not enough data: need at least 2 static signs with >= "
                         f"{contract.MIN_STATIC_SAMPLES} samples. Skipped: {ds.skipped}")
    say = progress or (lambda p, m: None)
    say(0.0, "training static model")
    st = train.train_static(ds.static_items, ds.static_labels, static_epochs, seed, progress)

    say(0.45, "exporting static model")
    st_bytes = export.to_tflite(st.model)
    export.verify_matches(st.model, st_bytes, st.val_x)
    files = {
        contract.MODEL: st_bytes,
        contract.LABELS: export.dumps(ds.static_labels),
        contract.GOLDEN: export.dumps(export.make_golden(st_bytes, st.val_x, st.val_y, ds.static_labels, 20, motion=False)),
    }
    meta = {"labels": ds.static_labels, "val_accuracy": st.report["overall_val_accuracy"], "report": st.report}

    if ds.motion_labels:
        say(0.5, "training motion model")
        mo = train.train_motion(ds.motion_items, ds.motion_labels, motion_epochs, seed, progress)
        say(0.92, "exporting motion model")
        mo_bytes = export.to_tflite(mo.model)
        export.verify_matches(mo.model, mo_bytes, mo.val_x)
        config = copy.deepcopy(contract.MOTION_CONFIG_DEFAULT)
        config["start_shapes"] = start_shapes if start_shapes is not None else _start_shapes(export_json, config)
        files.update({
            contract.MOTION_MODEL: mo_bytes,
            contract.MOTION_LABELS: export.dumps(ds.motion_labels),
            contract.MOTION_CONFIG: export.dumps(config),
            contract.MOTION_GOLDEN: export.dumps(export.make_golden(mo_bytes, mo.val_x, mo.val_y, ds.motion_labels, 10, motion=True)),
        })
        meta.update({"motion_labels": ds.motion_labels, "motion_val_accuracy": mo.report["overall_val_accuracy"],
                     "motion_report": mo.report})
    say(1.0, "done")
    return Result(files, meta, ds.skipped)


def _start_shapes(export_json: dict, config: dict) -> dict:
    """start_shapes per motion sign come from the platform's signs (spec §4.1); fall back to the contract default."""
    shapes = {s["label"]: s.get("start_shapes") for s in export_json["signs"]
              if s["kind"] == "motion" and s["label"] != contract.NONE_LABEL and s.get("start_shapes") is not None}
    return shapes or config["start_shapes"]
