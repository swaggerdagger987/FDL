from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_env: str
    debug: bool
    db_path: Path
    cors_allow_origins: list[str]
    request_body_limit_bytes: int
    request_timeout_seconds: int
    frontend_dist_dir: Path
    sleeper_max_concurrency: int
    sleeper_retry_attempts: int
    static_asset_cache_seconds: int
    api_cache_players_seconds: int
    api_cache_screener_options_seconds: int
    auto_sync_on_start: bool
    auto_sync_include_nflverse: bool
    auto_sync_season: int | None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    env = os.getenv("FDL_APP_ENV", "development").strip().lower()
    db_path = Path(os.getenv("FDL_DB_PATH", str(PROJECT_ROOT / "data" / "terminal.db"))).expanduser()
    cors_raw = os.getenv("FDL_CORS_ALLOW_ORIGINS", "http://localhost:5173,http://localhost:8000")
    origins = [entry.strip() for entry in cors_raw.split(",") if entry.strip()]
    if not origins:
        origins = ["http://localhost:5173", "http://localhost:8000"]

    return Settings(
        app_env=env,
        debug=_to_bool(os.getenv("FDL_DEBUG"), default=(env != "production")),
        db_path=db_path,
        cors_allow_origins=origins,
        request_body_limit_bytes=int(os.getenv("FDL_REQUEST_BODY_LIMIT_BYTES", str(10 * 1024 * 1024))),
        request_timeout_seconds=int(os.getenv("FDL_REQUEST_TIMEOUT_SECONDS", "30")),
        frontend_dist_dir=Path(os.getenv("FDL_FRONTEND_DIST", str(PROJECT_ROOT / "src" / "frontend" / "dist"))),
        sleeper_max_concurrency=int(os.getenv("FDL_SLEEPER_MAX_CONCURRENCY", "4")),
        sleeper_retry_attempts=int(os.getenv("FDL_SLEEPER_RETRY_ATTEMPTS", "3")),
        static_asset_cache_seconds=int(os.getenv("FDL_STATIC_ASSET_CACHE_SECONDS", str(7 * 24 * 60 * 60))),
        api_cache_players_seconds=int(os.getenv("FDL_API_CACHE_PLAYERS_SECONDS", "60")),
        api_cache_screener_options_seconds=int(os.getenv("FDL_API_CACHE_SCREENER_OPTIONS_SECONDS", "300")),
        auto_sync_on_start=_to_bool(os.getenv("FDL_V2_AUTO_SYNC_ON_START"), default=False),
        auto_sync_include_nflverse=_to_bool(os.getenv("FDL_V2_AUTO_SYNC_INCLUDE_NFLVERSE"), default=False),
        auto_sync_season=int(os.getenv("FDL_V2_AUTO_SYNC_SEASON")) if os.getenv("FDL_V2_AUTO_SYNC_SEASON") else None,
    )


def reset_settings_cache() -> None:
    get_settings.cache_clear()
