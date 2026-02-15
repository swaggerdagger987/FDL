from __future__ import annotations

from src.backend.db.repositories.bootstrap_repository import fetch_health_summary


def build_league_intel_report(*, league_id: str, lookback: int) -> dict:
    # Placeholder intelligence report for v2 parity bootstrap. Sleeper-auth manager
    # profiling will be layered in subsequent iterations of the rewrite.
    health = fetch_health_summary()
    return {
        "league_id": league_id,
        "lookback": max(1, min(int(lookback or 1), 4)),
        "summary": {
            "players_indexed": health.get("players", 0),
            "stats_rows": health.get("stats_rows", 0),
            "note": "v2 intel endpoint is active; manager profiling expansion is next in queue.",
        },
        "managers": [],
    }
