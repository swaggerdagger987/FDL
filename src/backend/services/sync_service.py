from __future__ import annotations

import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import live_data

from src.backend.db.repositories.bootstrap_repository import refresh_latest_stats_current
from src.backend.db.repositories.sync_jobs_repository import (
    create_sync_job,
    find_latest_active_job,
    get_sync_job,
    update_sync_job_failure,
    update_sync_job_started,
    update_sync_job_success,
)
from src.backend.db.session import db_transaction


class SyncService:
    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fdl-sync-v2")
        self._lock = threading.Lock()
        self._last_created: dict | None = None

    def create_job(self, *, season: int, include_nflverse: bool) -> dict:
        with self._lock:
            now_monotonic = time.monotonic()
            if self._last_created:
                if (
                    self._last_created.get("season") == int(season)
                    and self._last_created.get("include_nflverse") == bool(include_nflverse)
                    and now_monotonic - float(self._last_created.get("created_monotonic", 0.0)) < 2.0
                ):
                    with db_transaction() as connection:
                        existing = get_sync_job(connection, job_id=str(self._last_created.get("job_id")))
                    if existing:
                        return existing

            with db_transaction() as connection:
                active_job = find_latest_active_job(connection)
                if active_job:
                    return active_job
                job_id = uuid.uuid4().hex
                created_at = live_data.utc_now_iso()
                create_sync_job(
                    connection,
                    job_id=job_id,
                    season=int(season),
                    include_nflverse=bool(include_nflverse),
                    created_at=created_at,
                )
                self._last_created = {
                    "job_id": job_id,
                    "season": int(season),
                    "include_nflverse": bool(include_nflverse),
                    "created_monotonic": now_monotonic,
                }

        if os.getenv("FDL_SYNC_DRY_RUN", "0") == "1":
            self._executor.submit(self._run_stub, job_id, int(season), bool(include_nflverse))
        else:
            self._executor.submit(self._run_job, job_id, int(season), bool(include_nflverse))

        with db_transaction() as connection:
            payload = get_sync_job(connection, job_id=job_id)
        return payload

    def get_job(self, *, job_id: str) -> dict | None:
        with db_transaction() as connection:
            return get_sync_job(connection, job_id=job_id)

    def _run_job(self, job_id: str, season: int, include_nflverse: bool) -> None:
        started_at = live_data.utc_now_iso()
        with db_transaction() as connection:
            update_sync_job_started(connection, job_id=job_id, started_at=started_at)

        try:
            with live_data.get_connection() as sync_conn:
                summary = live_data.run_full_sync(sync_conn, season=season, include_nflverse=include_nflverse)

            with db_transaction() as connection:
                refresh_latest_stats_current(connection)
                update_sync_job_success(
                    connection,
                    job_id=job_id,
                    finished_at=live_data.utc_now_iso(),
                    summary=summary,
                )
        except Exception as error:  # noqa: BLE001
            with db_transaction() as connection:
                update_sync_job_failure(
                    connection,
                    job_id=job_id,
                    finished_at=live_data.utc_now_iso(),
                    error_message=str(error),
                )

    def _run_stub(self, job_id: str, season: int, include_nflverse: bool) -> None:
        with db_transaction() as connection:
            update_sync_job_started(connection, job_id=job_id, started_at=live_data.utc_now_iso())
            update_sync_job_success(
                connection,
                job_id=job_id,
                finished_at=live_data.utc_now_iso(),
                summary={
                    "season": season,
                    "include_nflverse": include_nflverse,
                    "mode": "dry_run",
                },
            )


sync_service = SyncService()
