from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .bootstrap_repository import decode_summary


def create_sync_job(connection: Connection, *, job_id: str, season: int, include_nflverse: bool, created_at: str) -> None:
    connection.execute(
        text(
            """
            INSERT INTO sync_jobs (job_id, status, season, include_nflverse, created_at)
            VALUES (:job_id, 'queued', :season, :include_nflverse, :created_at)
            """
        ),
        {
            "job_id": job_id,
            "season": season,
            "include_nflverse": 1 if include_nflverse else 0,
            "created_at": created_at,
        },
    )


def update_sync_job_started(connection: Connection, *, job_id: str, started_at: str) -> None:
    connection.execute(
        text("UPDATE sync_jobs SET status='running', started_at=:started_at WHERE job_id=:job_id"),
        {"job_id": job_id, "started_at": started_at},
    )


def update_sync_job_success(connection: Connection, *, job_id: str, finished_at: str, summary: dict) -> None:
    connection.execute(
        text(
            """
            UPDATE sync_jobs
            SET status='succeeded', finished_at=:finished_at, summary_json=:summary_json, error_message=NULL
            WHERE job_id=:job_id
            """
        ),
        {"job_id": job_id, "finished_at": finished_at, "summary_json": json.dumps(summary)},
    )


def update_sync_job_failure(connection: Connection, *, job_id: str, finished_at: str, error_message: str) -> None:
    connection.execute(
        text(
            """
            UPDATE sync_jobs
            SET status='failed', finished_at=:finished_at, error_message=:error_message
            WHERE job_id=:job_id
            """
        ),
        {"job_id": job_id, "finished_at": finished_at, "error_message": error_message[:1000]},
    )


def get_sync_job(connection: Connection, *, job_id: str) -> dict | None:
    row = connection.execute(
        text(
            """
            SELECT
              job_id,
              status,
              season,
              include_nflverse,
              created_at,
              started_at,
              finished_at,
              summary_json,
              error_message
            FROM sync_jobs
            WHERE job_id = :job_id
            """
        ),
        {"job_id": job_id},
    ).mappings().first()

    if not row:
        return None

    return {
        "job_id": row["job_id"],
        "status": row["status"],
        "season": int(row["season"]),
        "include_nflverse": bool(row["include_nflverse"]),
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "summary": decode_summary(row["summary_json"]),
        "error_message": row["error_message"],
    }


def find_latest_active_job(connection: Connection) -> dict | None:
    row = connection.execute(
        text(
            """
            SELECT
              job_id,
              status,
              season,
              include_nflverse,
              created_at,
              started_at,
              finished_at,
              summary_json,
              error_message
            FROM sync_jobs
            WHERE status IN ('queued', 'running')
            ORDER BY created_at DESC
            LIMIT 1
            """
        )
    ).mappings().first()
    if not row:
        return None
    return {
        "job_id": row["job_id"],
        "status": row["status"],
        "season": int(row["season"]),
        "include_nflverse": bool(row["include_nflverse"]),
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "summary": decode_summary(row["summary_json"]),
        "error_message": row["error_message"],
    }
