"""The ONLY place the ML service calls the backend (docs/architecture.md §5.3). X-API-Key on every call."""
from __future__ import annotations

import json
import os

import httpx


class Backend:
    def __init__(self, base: str | None = None, api_key: str | None = None):
        self.base = (base or os.environ["BACKEND_URL"]).rstrip("/")
        self.headers = {"X-API-Key": api_key or os.environ["ML_API_KEY"]}

    def _post(self, path: str, **kwargs) -> httpx.Response:
        r = httpx.post(self.base + path, headers=self.headers, timeout=300, **kwargs)
        r.raise_for_status()
        return r

    def dataset(self) -> dict:
        r = httpx.get(self.base + "/api/ml/dataset", headers=self.headers, timeout=300)
        r.raise_for_status()
        return r.json()

    def progress(self, model_id: int, progress: float, message: str) -> None:
        try:  # progress is best-effort: a dropped update must never kill a training run
            self._post(f"/api/ml/models/{model_id}/progress",
                       json={"progress": round(float(progress), 3), "message": message})
        except httpx.HTTPError as e:
            print(f"[backend] progress update failed: {e}")

    def result(self, model_id: int, files: dict, meta: dict) -> None:
        parts = [(name, (name, content, "application/octet-stream")) for name, content in files.items()]
        self._post(f"/api/ml/models/{model_id}/result", data={"meta": json.dumps(meta)}, files=parts)

    def fail(self, model_id: int, error: str) -> None:
        self._post(f"/api/ml/models/{model_id}/fail", json={"error": error[:2000]})
