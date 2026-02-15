from __future__ import annotations

from fastapi import APIRouter, Query, Request

from src.backend.api.schemas.common import ok
from src.backend.db.repositories.players_repository import fetch_filter_options, fetch_players
from src.backend.db.session import db_connection

router = APIRouter(tags=["players"])


@router.get("/players")
def get_players(
    request: Request,
    search: str = "",
    position: str = "",
    team: str = "",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    sort: str = "points_desc",
):
    _ = request.state.request_id
    with db_connection() as connection:
        payload = fetch_players(
            connection,
            search=search,
            position=position,
            team=team,
            limit=limit,
            offset=offset,
            sort=sort,
        )
    return ok(payload)


@router.get("/screener/options")
def get_screener_options(
    request: Request,
    search: str = "",
    position: str = "",
    team: str = "",
    limit: int = Query(default=600, ge=1, le=3000),
):
    _ = request.state.request_id
    with db_connection() as connection:
        items = fetch_filter_options(
            connection,
            search=search,
            position=position,
            team=team,
            limit=limit,
        )
    return ok({"count": len(items), "items": items})
