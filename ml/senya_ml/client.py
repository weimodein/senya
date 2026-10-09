"""Talks to the Express server as the trainer (architecture.md §4.4). Admin token on every call."""
from __future__ import annotations

import json
import os
from typing import Optional

import requests


class Server:
    def __init__(self, base: Optional[str] = None, token: Optional[str] = None):
        self.base = (base or os.environ["SENYA_SERVER"]).rstrip("/")
        self.headers = {"Authorization": f"Bearer {token or os.environ['SENYA_ADMIN_TOKEN']}"}

    def _url(self, path: str) -> str:
        return self.base + path

    def next_job(self) -> Optional[int]:
        r = requests.get(self._url("/api/train/jobs/next"), headers=self.headers, timeout=30)
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()["id"]

    def export(self) -> dict:
        r = requests.get(self._url("/api/export"), headers=self.headers, timeout=300)
        r.raise_for_status()
        return r.json()

    def progress(self, job_id: int, progress: float, message: str) -> None:
        requests.post(self._url(f"/api/train/jobs/{job_id}/progress"), headers=self.headers, timeout=30,
                      json={"progress": round(float(progress), 3), "message": message})

    def fail(self, job_id: int, error: str) -> None:
        requests.post(self._url(f"/api/train/jobs/{job_id}/fail"), headers=self.headers, timeout=30, json={"error": error[:2000]})

    def upload_model(self, job_id: int, files: dict, meta: dict) -> int:
        parts = {name: (name, content) for name, content in files.items()}
        r = requests.post(self._url("/api/models"), headers=self.headers, timeout=300,
                          data={"job_id": str(job_id), "meta": json.dumps(meta)}, files=parts)
        r.raise_for_status()
        return r.json()["version"]
