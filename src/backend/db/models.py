from __future__ import annotations

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, Integer, MetaData, String, Table

metadata = MetaData()

sync_jobs = Table(
    "sync_jobs",
    metadata,
    Column("job_id", String, primary_key=True),
    Column("status", String, nullable=False),
    Column("season", Integer, nullable=False),
    Column("include_nflverse", Boolean, nullable=False, default=False),
    Column("created_at", DateTime, nullable=False),
    Column("started_at", DateTime),
    Column("finished_at", DateTime),
    Column("summary_json", JSON),
    Column("error_message", String),
)

player_latest_stats_current = Table(
    "player_latest_stats_current",
    metadata,
    Column("player_id", String, primary_key=True),
    Column("season", Integer),
    Column("week", Integer),
    Column("season_type", String),
    Column("team", String),
    Column("opponent_team", String),
    Column("fantasy_points_ppr", Float),
    Column("fantasy_points_half_ppr", Float),
    Column("fantasy_points_std", Float),
    Column("passing_yards", Float),
    Column("rushing_yards", Float),
    Column("receiving_yards", Float),
    Column("receptions", Float),
    Column("touchdowns", Float),
    Column("turnovers", Float),
    Column("source", String),
    Column("updated_at", String, nullable=False),
)
