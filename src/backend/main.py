from __future__ import annotations

import logging
import uuid

import live_data
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.backend.api.routes import health_router, intel_router, players_router, screener_router, sync_router
from src.backend.api.schemas.common import fail
from src.backend.config import get_settings
from src.backend.db.repositories.bootstrap_repository import (
    bootstrap_database,
    ensure_v2_tables,
    fetch_health_summary,
    refresh_latest_stats_current,
)
from src.backend.db.session import db_transaction
from src.backend.middleware import CacheHeadersMiddleware, RequestBodyLimitMiddleware, RequestContextMiddleware
from src.backend.services.sync_service import sync_service

logger = logging.getLogger("fdl.v2")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="Fourth Down Labs API v2", version="0.1.0", docs_url="/api/v2/docs", redoc_url="/api/v2/redoc")

    app.add_middleware(RequestContextMiddleware, timeout_seconds=settings.request_timeout_seconds)
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=settings.request_body_limit_bytes)
    app.add_middleware(CacheHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
    )

    @app.on_event("startup")
    def on_startup() -> None:
        bootstrap_database()
        with db_transaction() as connection:
            ensure_v2_tables(connection)
            refresh_latest_stats_current(connection)
        if settings.auto_sync_on_start:
            _schedule_startup_sync(settings)

    @app.on_event("shutdown")
    def on_shutdown() -> None:
        sync_service.shutdown(wait=False)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
        message = "; ".join([err.get("msg", "invalid input") for err in exc.errors()])
        return JSONResponse(
            status_code=422,
            content=fail(code="VALIDATION_ERROR", message=message, request_id=request_id),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException):
        request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
        message = str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content=fail(code="HTTP_ERROR", message=message, request_id=request_id),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
        logger.exception("Unhandled v2 error", extra={"request_id": request_id})
        return JSONResponse(
            status_code=500,
            content=fail(code="INTERNAL_ERROR", message="Internal server error.", request_id=request_id),
        )

    app.include_router(health_router, prefix="/api/v2")
    app.include_router(players_router, prefix="/api/v2")
    app.include_router(screener_router, prefix="/api/v2")
    app.include_router(sync_router, prefix="/api/v2")
    app.include_router(intel_router, prefix="/api/v2")

    if settings.frontend_dist_dir.exists():
        app.mount("/v2", StaticFiles(directory=str(settings.frontend_dist_dir), html=True), name="v2-ui")
    else:

        @app.get("/v2")
        @app.get("/v2/")
        async def v2_not_built():
            return {
                "ok": True,
                "data": {
                    "message": "v2 frontend is not built yet. Run: npm --prefix src/frontend install && npm --prefix src/frontend run build"
                },
                "error": None,
            }

    return app


app = create_app()


def _schedule_startup_sync(settings) -> None:
    try:
        health = fetch_health_summary()
        if int(health.get("stats_rows") or 0) > 0:
            return
        season = settings.auto_sync_season or live_data.current_nfl_season()
        sync_service.create_job(season=season, include_nflverse=settings.auto_sync_include_nflverse)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to queue startup sync job")
