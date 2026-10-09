"""The trainer worker: polls the server for a queued job, trains, uploads (docs/architecture.md §1 step ③)."""
from __future__ import annotations

import time
import traceback

from . import pipeline
from .client import Server


def run_job(server: Server, job_id: int, **kwargs) -> int:
    def progress(p, msg):
        server.progress(job_id, p, msg)

    progress(0.0, "downloading data")
    export_json = server.export()
    result = pipeline.run(export_json, progress=progress, **kwargs)
    version = server.upload_model(job_id, result.files, result.meta)
    return version


def poll_forever(server: Server, interval: float = 5.0, once: bool = False, **kwargs) -> None:
    print(f"worker polling {server.base} every {interval}s (Ctrl+C to stop)")
    while True:
        try:
            job = server.next_job()
        except Exception as e:  # network blip: keep polling
            print("poll failed:", e)
            time.sleep(interval)
            continue
        if job is None:
            time.sleep(interval)
            continue
        print(f"job {job}: started")
        try:
            version = run_job(server, job, **kwargs)
            print(f"job {job}: uploaded model v{version}")
        except Exception as e:
            traceback.print_exc()
            server.fail(job, f"{type(e).__name__}: {e}")
        if once:
            return
