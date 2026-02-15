from __future__ import annotations

from fastapi import APIRouter, Request

from src.backend.api.schemas.common import ok
from src.backend.db.repositories.bootstrap_repository import fetch_health_summary

router = APIRouter(tags=["health"])


@router.get("/health")
def get_health(request: Request):
    _ = request.state.request_id
    return ok(fetch_health_summary())
