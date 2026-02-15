from __future__ import annotations

from pydantic import BaseModel, Field


class IntelManagerCard(BaseModel):
    manager_id: str
    display_name: str
    aggression_score: float
    trade_friendliness: float
    weakness: str | None = None


class IntelReportResponse(BaseModel):
    league_id: str
    lookback: int
    summary: dict = Field(default_factory=dict)
    managers: list[IntelManagerCard] = Field(default_factory=list)
