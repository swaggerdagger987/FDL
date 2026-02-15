from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MetricFilter(BaseModel):
    key: str
    op: Literal["gte", "lte", "gt", "lt", "eq", "neq", "between"] = "gte"
    value: float | None = None
    value_max: float | None = None


class SortSpec(BaseModel):
    key: str = "fantasy_points_ppr"
    direction: Literal["asc", "desc"] = "desc"


class PageSpec(BaseModel):
    limit: int = 100
    offset: int = 0


class ScreenerQueryRequest(BaseModel):
    search: str = ""
    positions: list[str] = Field(default_factory=list)
    team: str = ""
    age_min: float | None = None
    age_max: float | None = None
    filters: list[MetricFilter] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    sort: SortSpec = Field(default_factory=SortSpec)
    page: PageSpec = Field(default_factory=PageSpec)


class ScreenerPlayer(BaseModel):
    player_id: str
    full_name: str | None = None
    position: str | None = None
    team: str | None = None
    status: str | None = None
    age: float | None = None
    years_exp: int | None = None
    latest_fantasy_points_ppr: float | None = None
    latest_season: int | None = None
    latest_week: int | None = None
    latest_source: str | None = None
    metrics: dict[str, float] = Field(default_factory=dict)


class ScreenerPage(BaseModel):
    limit: int
    offset: int
    total: int
    has_next: bool


class ScreenerQueryResponse(BaseModel):
    items: list[ScreenerPlayer]
    page: ScreenerPage
    sort: SortSpec
    applied_filters: list[MetricFilter]
    columns: list[str]
