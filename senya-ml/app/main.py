"""Senya ML service: landmark extraction + training. Called only by senya-backend (docs/architecture.md §5.4).

Run: uvicorn app.main:app --port 8001
"""
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402

from app.routers import extract, train  # noqa: E402
from app.services import jobs  # noqa: E402

app = FastAPI(title="Senya ML Service", version="2.0.0")
app.include_router(extract.router)
app.include_router(train.router)


@app.get("/health")
def health():
    return {"status": "ok", "training": jobs.current()}
