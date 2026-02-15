from __future__ import annotations

import live_data
from fastapi import APIRouter, HTTPException, Request

from src.backend.api.schemas.common import ok
from src.backend.api.schemas.sync import SyncJobCreateRequest
from src.backend.services.sync_service import sync_service

router = APIRouter(tags=["sync"])


@router.post("/sync/jobs")
def create_sync_job(request: Request, body: SyncJobCreateRequest):
    _ = request.state.request_id
    season = int(body.season or live_data.current_nfl_season())
    payload = sync_service.create_job(season=season, include_nflverse=body.include_nflverse)
    return ok(payload)


@router.get("/sync/jobs/{job_id}")
def get_sync_job(request: Request, job_id: str):
    _ = request.state.request_id
    payload = sync_service.get_job(job_id=job_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return ok(payload)
