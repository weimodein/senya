from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.deps import require_api_key
from app.services import jobs

router = APIRouter(dependencies=[Depends(require_api_key)])


class TrainRequest(BaseModel):
    model_id: int


@router.post("/train", status_code=202)
def train(req: TrainRequest):
    """Starts training and returns at once; results come back to the backend through callbacks."""
    if not jobs.start(req.model_id):
        raise HTTPException(status_code=409, detail=f"already training model {jobs.current()}")
    return JSONResponse({"model_id": req.model_id, "status": "started"}, status_code=202)
