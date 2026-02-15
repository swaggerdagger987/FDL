from __future__ import annotations

import importlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def app_client(tmp_path: Path):
    os.environ["FDL_DB_PATH"] = str(tmp_path / "terminal-test.db")
    os.environ["FDL_REQUEST_BODY_LIMIT_BYTES"] = "256"
    os.environ["FDL_SYNC_DRY_RUN"] = "1"
    os.environ["FDL_V2_AUTO_SYNC_ON_START"] = "0"

    import src.backend.config as config
    import src.backend.db.engine as db_engine
    import live_data

    config.reset_settings_cache()
    db_engine.reset_engine_cache()
    live_data = importlib.reload(live_data)

    from src.backend.main import create_app
    from src.backend.db.repositories.bootstrap_repository import refresh_latest_stats_current
    from src.backend.db.session import db_transaction

    app = create_app()

    with TestClient(app) as client:
        with live_data.get_connection() as connection:
            now = live_data.utc_now_iso()
            connection.execute(
                """
                INSERT OR REPLACE INTO players (
                  player_id, full_name, first_name, last_name, search_full_name, position, team, status, age, years_exp, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("p1", "Test Player", "Test", "Player", "testplayer", "WR", "SF", "Active", 24, 2, now),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO player_week_stats (
                  player_id, season, week, season_type, source, updated_at, fantasy_points_ppr, receiving_yards, receptions
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("p1", 2025, 1, "regular", "sleeper", now, 20.2, 120, 7),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO player_week_metrics (
                  player_id, season, week, season_type, source, stat_key, stat_value, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("p1", 2025, 1, "regular", "sleeper", "target_share", 0.31, now),
            )
            connection.commit()
            live_data.refresh_latest_metrics(connection)

        with db_transaction() as connection:
            refresh_latest_stats_current(connection)

        yield client
