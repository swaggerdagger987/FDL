from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from src.backend.config import get_settings


@dataclass
class SleeperClient:
    base_url: str = "https://api.sleeper.app/v1"
    timeout_seconds: int = 15

    def __post_init__(self) -> None:
        settings = get_settings()
        self._max_concurrency = max(1, settings.sleeper_max_concurrency)
        self._retry_attempts = max(1, settings.sleeper_retry_attempts)
        self._semaphore: asyncio.Semaphore | None = None

    async def get_json(self, path: str) -> dict | list:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self._max_concurrency)
        async with self._semaphore:
            return await asyncio.to_thread(self._request_with_retry, path)

    def _request_with_retry(self, path: str):
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        backoff = 0.35
        last_error: Exception | None = None

        for attempt in range(1, self._retry_attempts + 1):
            request = urllib.request.Request(url, headers={"User-Agent": "FDL-v2/1.0", "Accept": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    raw = response.read()
                return json.loads(raw.decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as error:
                last_error = error
                if attempt >= self._retry_attempts:
                    break
                time.sleep(backoff)
                backoff *= 2

        raise RuntimeError(f"Sleeper request failed for {url}: {last_error}")
