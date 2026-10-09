"""Training jobs: one at a time, in a background thread, reporting back through callbacks (architecture.md §4.2).

The ML service keeps no other state: progress, results and failures all live in the backend's database.
"""
from __future__ import annotations

import os
import threading
import traceback
from typing import Optional

from app.core import pipeline
from app.services.backend_client import Backend

EPOCHS = int(os.getenv("TRAIN_EPOCHS", 60))

_lock = threading.Lock()
_current: Optional[int] = None


def current() -> Optional[int]:
    return _current


def run_job(backend: Backend, model_id: int, epochs: int = EPOCHS) -> None:
    """Trains one model version end to end. Used by the thread below and by `python -m app.cli run-job`."""
    def progress(p, msg):
        backend.progress(model_id, p, msg)

    try:
        progress(0.0, "downloading data")
        result = pipeline.run(backend.dataset(), static_epochs=epochs, motion_epochs=epochs, progress=progress)
        progress(1.0, "uploading model")
        backend.result(model_id, result.files, result.meta)
        print(f"[train] model {model_id}: done")
    except Exception as e:
        traceback.print_exc()
        try:
            backend.fail(model_id, f"{type(e).__name__}: {e}")
        except Exception:
            traceback.print_exc()


def start(model_id: int, backend: Optional[Backend] = None) -> bool:
    """Starts training in the background. False if a job is already running."""
    global _current
    if not _lock.acquire(blocking=False):
        return False
    _current = model_id
    backend = backend or Backend()

    def work():
        global _current
        try:
            run_job(backend, model_id)
        finally:
            _current = None
            _lock.release()

    threading.Thread(target=work, name=f"train-{model_id}", daemon=True).start()
    return True
