from __future__ import annotations

import asyncio
import hashlib
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .api.schemas.common import fail
from .config import get_settings


class RequestContextMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, timeout_seconds: int) -> None:
        super().__init__(app)
        self._timeout_seconds = timeout_seconds

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.state.request_id = request_id
        try:
            response = await asyncio.wait_for(call_next(request), timeout=self._timeout_seconds)
        except asyncio.TimeoutError:
            payload = fail(
                code="REQUEST_TIMEOUT",
                message="Request timed out.",
                request_id=request_id,
            )
            return JSONResponse(status_code=504, content=payload, headers={"X-Request-Id": request_id})

        response.headers["X-Request-Id"] = request_id
        return response


class RequestBodyLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, max_bytes: int) -> None:
        super().__init__(app)
        self._max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        request_id = getattr(request.state, "request_id", "unknown")
        if content_length:
            try:
                size = int(content_length)
            except ValueError:
                size = 0
            if size > self._max_bytes:
                payload = fail(
                    code="PAYLOAD_TOO_LARGE",
                    message=f"Payload exceeds {self._max_bytes} bytes.",
                    request_id=request_id,
                )
                return JSONResponse(status_code=413, content=payload)

        return await call_next(request)


class CacheHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:
        super().__init__(app)
        self._settings = get_settings()

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        method = request.method.upper()
        path = request.url.path

        if method in {"GET", "HEAD"}:
            self._apply_cache_control(path, response)
            self._apply_json_etag(request, response)
        else:
            response.headers.setdefault("Cache-Control", "no-store")

        return response

    def _apply_cache_control(self, path: str, response: Response) -> None:
        if response.headers.get("Cache-Control"):
            return
        if path.startswith("/api/v2/health"):
            response.headers["Cache-Control"] = "no-store"
            return
        if path.startswith("/api/v2/screener/options"):
            response.headers["Cache-Control"] = (
                f"public, max-age={self._settings.api_cache_screener_options_seconds}, stale-while-revalidate=300"
            )
            return
        if path.startswith("/api/v2/players"):
            response.headers["Cache-Control"] = (
                f"public, max-age={self._settings.api_cache_players_seconds}, stale-while-revalidate=120"
            )
            return
        if path.startswith("/api/v2/"):
            response.headers["Cache-Control"] = "no-store"
            return
        if "/assets/" in path:
            response.headers["Cache-Control"] = (
                f"public, max-age={self._settings.static_asset_cache_seconds}, immutable"
            )
            return
        response.headers["Cache-Control"] = "no-cache"

    def _apply_json_etag(self, request: Request, response: Response) -> None:
        if response.status_code != 200:
            return
        if response.headers.get("ETag"):
            return
        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type:
            return
        body = getattr(response, "body", None)
        if not isinstance(body, (bytes, bytearray)):
            return

        digest = hashlib.sha1(body).hexdigest()
        etag = f'W/"{digest}"'
        incoming = request.headers.get("If-None-Match", "")
        if incoming and incoming == etag:
            response.status_code = 304
            response.body = b""
            if "content-type" in response.headers:
                del response.headers["content-type"]
            response.headers["Content-Length"] = "0"
        response.headers["ETag"] = etag
