from __future__ import annotations

from pydantic import BaseModel


class SyncJobCreateRequest(BaseModel):
    season: int | None = None
    include_nflverse: bool = False


class SyncJobResponse(BaseModel):
    job_id: str
    status: str
    season: int
    include_nflverse: bool
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    summary: dict | None = None
    error_message: str | None = None
