from __future__ import annotations

from functools import lru_cache

from sqlalchemy import event
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from src.backend.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"sqlite+pysqlite:///{settings.db_path}"
    engine = create_engine(
        url,
        future=True,
        connect_args={"check_same_thread": False, "timeout": 60},
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def set_wal_mode(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return engine


def reset_engine_cache() -> None:
    get_engine.cache_clear()
