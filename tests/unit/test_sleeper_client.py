from __future__ import annotations

import asyncio
import json
import urllib.error

import pytest

from src.backend.services.sleeper_client import SleeperClient


class _Response:
    def __init__(self, payload: dict):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


@pytest.mark.parametrize("failures", [1, 2])
def test_sleeper_client_retries_then_succeeds(monkeypatch, failures: int):
    calls = {"count": 0}

    def fake_urlopen(request, timeout=0):
        calls["count"] += 1
        if calls["count"] <= failures:
            raise urllib.error.URLError("temporary")
        return _Response({"ok": True})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = SleeperClient(base_url="https://example.com", timeout_seconds=1)
    payload = asyncio.run(client.get_json("/league/test"))

    assert payload["ok"] is True
    assert calls["count"] == failures + 1


def test_sleeper_client_raises_after_retries(monkeypatch):
    def fake_urlopen(request, timeout=0):
        raise urllib.error.URLError("down")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = SleeperClient(base_url="https://example.com", timeout_seconds=1)
    with pytest.raises(RuntimeError):
        asyncio.run(client.get_json("/league/test"))
