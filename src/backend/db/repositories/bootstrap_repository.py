from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.engine import Connection

import live_data


def bootstrap_database() -> None:
    with live_data.get_connection() as connection:
        live_data.initialize_database(connection)


def ensure_v2_tables(connection: Connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sync_jobs (
              job_id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              season INTEGER NOT NULL,
              include_nflverse INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              started_at TEXT,
              finished_at TEXT,
              summary_json TEXT,
              error_message TEXT
            )
            """
        )
    )

    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS player_latest_stats_current (
              player_id TEXT PRIMARY KEY,
              season INTEGER,
              week INTEGER,
              season_type TEXT,
              team TEXT,
              opponent_team TEXT,
              fantasy_points_ppr REAL,
              fantasy_points_half_ppr REAL,
              fantasy_points_std REAL,
              passing_yards REAL,
              rushing_yards REAL,
              receiving_yards REAL,
              receptions REAL,
              touchdowns REAL,
              turnovers REAL,
              source TEXT,
              updated_at TEXT NOT NULL
            )
            """
        )
    )

    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_plsc_points ON player_latest_stats_current(fantasy_points_ppr)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_plsc_player ON player_latest_stats_current(player_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_plm_player_key ON player_latest_metrics(player_id, stat_key)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_plm_key_player_value ON player_latest_metrics(stat_key, player_id, stat_value)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_players_position_team_age ON players(position, team, age)"))


def refresh_latest_stats_current(connection: Connection) -> None:
    now = live_data.utc_now_iso()
    connection.execute(text("DELETE FROM player_latest_stats_current"))
    connection.execute(
        text(
            """
            INSERT INTO player_latest_stats_current (
              player_id, season, week, season_type, team, opponent_team,
              fantasy_points_ppr, fantasy_points_half_ppr, fantasy_points_std,
              passing_yards, rushing_yards, receiving_yards, receptions, touchdowns, turnovers,
              source, updated_at
            )
            WITH ranked AS (
              SELECT
                pws.player_id,
                pws.season,
                pws.week,
                pws.season_type,
                pws.team,
                pws.opponent_team,
                pws.fantasy_points_ppr,
                pws.fantasy_points_half_ppr,
                pws.fantasy_points_std,
                pws.passing_yards,
                pws.rushing_yards,
                pws.receiving_yards,
                pws.receptions,
                pws.touchdowns,
                pws.turnovers,
                pws.source,
                ROW_NUMBER() OVER (
                  PARTITION BY pws.player_id
                  ORDER BY pws.season DESC, pws.week DESC, CASE WHEN pws.source='sleeper' THEN 0 ELSE 1 END
                ) AS rn
              FROM player_week_stats pws
            )
            SELECT
              player_id, season, week, season_type, team, opponent_team,
              fantasy_points_ppr, fantasy_points_half_ppr, fantasy_points_std,
              passing_yards, rushing_yards, receiving_yards, receptions, touchdowns, turnovers,
              source, :now
            FROM ranked
            WHERE rn = 1
            """
        ),
        {"now": now},
    )


def fetch_health_summary() -> dict:
    with live_data.get_connection() as connection:
        payload = live_data.fetch_health_summary(connection)

    return {
        "database_path": payload.get("database_path"),
        "players": payload.get("players", 0),
        "stats_rows": payload.get("stats_rows", 0),
        "metric_rows": payload.get("metric_rows", 0),
        "latest_metric_rows": payload.get("latest_metric_rows", 0),
        "metric_keys_available": payload.get("metric_keys_available", 0),
        "last_sync_at": payload.get("last_sync_at"),
        "last_sync_report": payload.get("last_sync_report"),
    }


def decode_summary(summary_json: str | None) -> dict | None:
    if not summary_json:
        return None
    try:
        return json.loads(summary_json)
    except json.JSONDecodeError:
        return None
