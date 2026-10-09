from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.deps import require_api_key
from app.services.extract import ExtractionError, extract

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/extract")
async def extract_landmarks(file: UploadFile = File(...), kind: str = Form(...)):
    """One clip or image -> landmarks (architecture.md §5.4). The file is never stored."""
    if kind not in ("static", "motion"):
        raise HTTPException(status_code=400, detail="kind must be 'static' or 'motion'")
    data = await file.read()
    try:
        # MediaPipe is CPU-bound: run it off the event loop so /health and /train stay responsive.
        return await run_in_threadpool(extract, data, file.filename or "", kind)
    except ExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e))
