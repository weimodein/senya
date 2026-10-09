import os
import secrets
from typing import Optional

from fastapi import Header, HTTPException


def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Only the backend may call this service: it sends the shared ML_API_KEY in X-API-Key."""
    expected = os.getenv("ML_API_KEY")
    if not expected or not x_api_key or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")
