from __future__ import annotations

from pydantic import BaseModel


class PlayerSummary(BaseModel):
    player_id: str
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    position: str | None = None
    team: str | None = None
    status: str | None = None
    age: float | None = None
    years_exp: int | None = None
    latest_season: int | None = None
    latest_week: int | None = None
    latest_source: str | None = None
    latest_fantasy_points_ppr: float | None = None


class PlayerPage(BaseModel):
    limit: int
    offset: int
    total: int
    has_next: bool


class PlayerListResponse(BaseModel):
    items: list[PlayerSummary]
    page: PlayerPage
