"""v2 bootstrap tables

Revision ID: 0001_v2_bootstrap
Revises:
Create Date: 2026-02-14
"""

from alembic import op

revision = "0001_v2_bootstrap"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
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
    op.execute(
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


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS player_latest_stats_current")
    op.execute("DROP TABLE IF EXISTS sync_jobs")
