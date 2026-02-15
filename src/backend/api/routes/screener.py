from __future__ import annotations

from fastapi import APIRouter, Request

from src.backend.api.schemas.common import ok
from src.backend.api.schemas.screener import ScreenerQueryRequest
from src.backend.db.repositories.screener_repository import query_screener
from src.backend.db.session import db_connection

router = APIRouter(tags=["screener"])


@router.post("/screener/query")
def post_screener_query(request: Request, body: ScreenerQueryRequest):
    _ = request.state.request_id
    with db_connection() as connection:
        payload = query_screener(connection, body.model_dump())
    return ok(payload)
