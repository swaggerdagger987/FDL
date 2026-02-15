from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy.engine import Connection

from .engine import get_engine


@contextmanager
def db_connection() -> Iterator[Connection]:
    engine = get_engine()
    with engine.connect() as connection:
        yield connection


@contextmanager
def db_transaction() -> Iterator[Connection]:
    engine = get_engine()
    with engine.begin() as connection:
        yield connection
