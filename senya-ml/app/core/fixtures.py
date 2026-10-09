"""Generate fixtures/mock_server: dummy-but-real models + the files the server would serve (architecture.md §7)."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from . import contract, data, export, pipeline

FILE_ORDER = [contract.MODEL, contract.LABELS, contract.GOLDEN, contract.MOTION_MODEL, contract.MOTION_LABELS,
              contract.MOTION_CONFIG, contract.MOTION_GOLDEN]


def latest_json(version: int, files: dict) -> dict:
    """The exact body of GET /api/model/latest (contract §3 item 9)."""
    base = f"/models/v{version}"
    motion = None
    if contract.MOTION_MODEL in files:
        motion = {"model_url": f"{base}/{contract.MOTION_MODEL}", "labels_url": f"{base}/{contract.MOTION_LABELS}",
                  "config_url": f"{base}/{contract.MOTION_CONFIG}", "sha256": export.sha256_hex(files[contract.MOTION_MODEL])}
    return {"version": version, "model_url": f"{base}/{contract.MODEL}", "labels_url": f"{base}/{contract.LABELS}",
            "sha256": export.sha256_hex(files[contract.MODEL]), "motion": motion}


def write_server_tree(root: Path, version: int, files: dict) -> None:
    """Lay files out so `python -m http.server` inside `root` behaves like the real server."""
    vdir = root / "models" / f"v{version}"
    if vdir.exists():
        shutil.rmtree(vdir)
    vdir.mkdir(parents=True)
    for name in FILE_ORDER:
        if name in files:
            (vdir / name).write_bytes(files[name])
    api = root / "api" / "model"
    api.mkdir(parents=True, exist_ok=True)
    (api / "latest").write_text(json.dumps(latest_json(version, files)), encoding="utf-8")


def make_fixtures(out: Path, version: int = 0, seed: int = 0, epochs: int = 30) -> dict:
    res = pipeline.run(data.synthetic_export(seed=seed), static_epochs=epochs, motion_epochs=epochs, seed=seed)
    write_server_tree(out, version, res.files)
    return latest_json(version, res.files)
