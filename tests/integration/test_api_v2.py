from __future__ import annotations


def test_health_endpoint_returns_envelope(app_client):
    response = app_client.get("/api/v2/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["players"] >= 1
    assert response.headers.get("Cache-Control") == "no-store"


def test_health_disables_browser_cache(app_client):
    response = app_client.get("/api/v2/health")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"


def test_screener_query_returns_paginated_rows(app_client):
    response = app_client.post(
        "/api/v2/screener/query",
        json={
            "search": "Test",
            "positions": ["WR"],
            "filters": [{"key": "target_share", "op": "gte", "value": 0.2}],
            "sort": {"key": "fantasy_points_ppr", "direction": "desc"},
            "page": {"limit": 25, "offset": 0},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["page"]["total"] >= 1
    assert payload["data"]["items"][0]["full_name"] == "Test Player"


def test_players_endpoint_returns_page_meta(app_client):
    response = app_client.get("/api/v2/players?limit=25&offset=0&sort=fantasy_points_ppr")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["page"]["limit"] == 25
    assert payload["data"]["page"]["offset"] == 0
    assert payload["data"]["page"]["total"] >= 1
    assert response.headers.get("Cache-Control", "").startswith("public, max-age=")


def test_screener_options_cache_header(app_client):
    response = app_client.get("/api/v2/screener/options?limit=10")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control", "").startswith("public, max-age=")


def test_body_limit_rejects_large_payload(app_client):
    huge = "x" * 2048
    response = app_client.post("/api/v2/screener/query", data=huge, headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_sync_job_lifecycle_endpoint_exists(app_client):
    create = app_client.post("/api/v2/sync/jobs", json={"season": 2025, "include_nflverse": False})
    assert create.status_code == 200
    job = create.json()["data"]
    status = app_client.get(f"/api/v2/sync/jobs/{job['job_id']}")
    assert status.status_code == 200
    assert status.json()["data"]["job_id"] == job["job_id"]


def test_sync_job_dedupes_when_active(app_client):
    first = app_client.post("/api/v2/sync/jobs", json={"season": 2025, "include_nflverse": False})
    second = app_client.post("/api/v2/sync/jobs", json={"season": 2025, "include_nflverse": False})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"]["job_id"] == second.json()["data"]["job_id"]
