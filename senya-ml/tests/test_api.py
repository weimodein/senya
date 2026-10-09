"""The ML service's HTTP surface (architecture.md §5.4) and the job callbacks, with a fake backend."""
import threading

import pytest
from fastapi.testclient import TestClient

from app.core import contract, data
from app.main import app
from app.services import jobs

KEY = {"X-API-Key": "test-key"}


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-key")


client = TestClient(app)


def test_health_is_public():
    assert client.get("/health").json() == {"status": "ok", "training": None}


def test_every_other_route_needs_the_api_key():
    assert client.post("/train", json={"model_id": 1}).status_code == 401
    assert client.post("/train", json={"model_id": 1}, headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.post("/extract", data={"kind": "static"}, files={"file": ("a.mp4", b"x")}).status_code == 401


def test_extract_rejects_a_bad_kind():
    r = client.post("/extract", headers=KEY, data={"kind": "dance"}, files={"file": ("a.mp4", b"x")})
    assert r.status_code == 400


def test_train_returns_202_then_409_while_busy(monkeypatch):
    release = threading.Event()
    monkeypatch.setattr(jobs, "run_job", lambda backend, model_id: release.wait(5))
    monkeypatch.setattr(jobs, "Backend", lambda: object())
    try:
        assert client.post("/train", json={"model_id": 7}, headers=KEY).status_code == 202
        r = client.post("/train", json={"model_id": 8}, headers=KEY)
        assert r.status_code == 409
        assert client.get("/health").json()["training"] == 7
    finally:
        release.set()
    for _ in range(50):
        if jobs.current() is None:
            break
        threading.Event().wait(0.05)
    assert jobs.current() is None


class FakeBackend:
    def __init__(self, dataset):
        self._dataset = dataset
        self.progress_calls, self.results, self.failures = [], [], []

    def dataset(self):
        return self._dataset

    def progress(self, model_id, p, msg):
        self.progress_calls.append((model_id, p, msg))

    def result(self, model_id, files, meta):
        self.results.append((model_id, files, meta))

    def fail(self, model_id, error):
        self.failures.append((model_id, error))


def test_run_job_reports_progress_then_the_files():
    fake = FakeBackend(data.synthetic_export())
    jobs.run_job(fake, 3, epochs=2)
    assert not fake.failures
    (model_id, files, meta), = fake.results
    assert model_id == 3
    assert {contract.MODEL, contract.LABELS, contract.GOLDEN, contract.MOTION_MODEL} <= set(files)
    assert meta["labels"]
    assert fake.progress_calls[0][2] == "downloading data"


def test_run_job_reports_a_failure_instead_of_raising():
    fake = FakeBackend({"signs": []})
    jobs.run_job(fake, 4, epochs=1)
    assert not fake.results
    (model_id, error), = fake.failures
    assert model_id == 4 and "not enough data" in error
