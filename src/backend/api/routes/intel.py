from __future__ import annotations

from fastapi import APIRouter, Query, Request

from src.backend.api.schemas.common import ok
from src.backend.services.intel_service import build_league_intel_report

router = APIRouter(tags=["intel"])


@router.get("/intel/report")
def get_intel_report(
    request: Request,
    league_id: str = "",
    lookback: int = Query(default=2, ge=1, le=4),
):
    _ = request.state.request_id
    payload = build_league_intel_report(league_id=league_id, lookback=lookback)
    return ok(payload)
