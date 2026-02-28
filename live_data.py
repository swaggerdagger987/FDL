import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import re
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = Path(os.getenv("FDL_DB_PATH", str(DATA_DIR / "terminal.db"))).expanduser()
CACHE_DIR = DATA_DIR / "cache"
SLEEPER_PLAYERS_CACHE_PATH = CACHE_DIR / "sleeper_players_nfl.json"
SLEEPER_PLAYERS_CACHE_TTL_SECONDS = 24 * 60 * 60

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
SLEEPER_STATS_ENDPOINTS = [
    "https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular",
    "https://api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular",
]
NFLVERSE_RELEASES_URL = "https://api.github.com/repos/nflverse/nflverse-data/releases?per_page=100"
SLEEPER_WEEK_FETCH_TIMEOUT_SECONDS = 15
NFLVERSE_ASSET_CACHE_TTL_SECONDS = 24 * 60 * 60
NFLVERSE_ASSET_CACHE_KEY_PREFIX = "nflverse_player_stats_asset"

USER_AGENT = "FourthDownLabsTerminal/1.0 (+https://fourthdownlabs.local)"
NFL_REGULAR_SEASON_WEEKS = 18
MAX_SCREEN_FILTERS = 24
DB_SCHEMA_LOCK = threading.Lock()
SLEEPER_CACHE_LOCK = threading.Lock()
FILTER_OPTIONS_CACHE_LOCK = threading.Lock()
FILTER_OPTIONS_CACHE = {"stamp": None, "entries": {}}
FILTER_OPTIONS_CACHE_MAX_ENTRIES = 32

SLEEPER_METRIC_ALIASES = {
    "pts_ppr": "fantasy_points_ppr",
    "pts_half_ppr": "fantasy_points_half_ppr",
    "pts_std": "fantasy_points_std",
    "pass_yd": "passing_yards",
    "rush_yd": "rushing_yards",
    "rec_yd": "receiving_yards",
    "rec": "receptions",
    "pass_td": "passing_tds",
    "rush_td": "rushing_tds",
    "rec_td": "receiving_tds",
    "pass_int": "interceptions",
    "fum_lost": "fumbles_lost",
    "yac": "yards_after_catch",
    "pass_ypa": "yards_per_pass_attempt",
    "rush_ypa": "yards_per_rush_attempt",
}

STAT_KEY_LABEL_OVERRIDES = {
    "fantasy_points_ppr": "Fantasy Points (PPR)",
    "fantasy_points_half_ppr": "Fantasy Points (Half PPR)",
    "fantasy_points_std": "Fantasy Points (STD)",
    "passing_yards": "Passing Yards",
    "rushing_yards": "Rushing Yards",
    "receiving_yards": "Receiving Yards",
    "receptions": "Receptions",
    "touchdowns": "Touchdowns",
    "turnovers": "Turnovers",
    "age": "Age",
    "years_exp": "Years Experience",
    "yac": "Yards After Catch (YAC)",
    "yards_after_catch": "Yards After Catch (YAC)",
    "receiving_yards_after_catch": "Receiving Yards After Catch",
    "rushing_yards_after_contact": "Rushing Yards After Contact",
}

STAT_KEY_ACRONYMS = {
    "ppr",
    "std",
    "yac",
    "epa",
    "cpoe",
    "qb",
    "wr",
    "rb",
    "te",
    "td",
    "yds",
}


def utc_now_iso():
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def current_nfl_season(now=None):
    now = now or dt.datetime.utcnow()
    return now.year if now.month >= 8 else now.year - 1


def normalize_name(value):
    raw = "".join(ch for ch in str(value or "").lower() if ch.isalnum())
    for suffix in ("jr", "sr", "ii", "iii", "iv"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)]
            break
    return raw


def safe_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_stat_key(value):
    key = str(value or "").strip().lower()
    if not key:
        return ""
    key = key.replace("%", "pct")
    key = re.sub(r"[^a-z0-9]+", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    if not key:
        return ""
    if key[0].isdigit():
        return f"v_{key}"
    return key


def build_stat_label(stat_key):
    key = normalize_stat_key(stat_key)
    if not key:
        return ""
    if key in STAT_KEY_LABEL_OVERRIDES:
        return STAT_KEY_LABEL_OVERRIDES[key]
    tokens = key.split("_")
    parts = []
    for token in tokens:
        if token in STAT_KEY_ACRONYMS:
            parts.append(token.upper())
        elif token == "yd":
            parts.append("Yards")
        elif token == "yr":
            parts.append("Year")
        else:
            parts.append(token.capitalize())
    label = " ".join(parts)
    if "yards_after_catch" in key and "YAC" not in label:
        label = f"{label} (YAC)"
    return label


def flatten_numeric_metrics(payload, prefix=""):
    metrics = {}

    def visit(node, path):
        if node is None or isinstance(node, bool):
            return
        if isinstance(node, (int, float)):
            numeric = float(node)
            if math.isfinite(numeric):
                key = normalize_stat_key(path)
                if key:
                    metrics[key] = numeric
            return
        if isinstance(node, str):
            numeric = safe_float(node)
            if numeric is None:
                return
            if math.isfinite(numeric):
                key = normalize_stat_key(path)
                if key:
                    metrics[key] = numeric
            return
        if isinstance(node, dict):
            for child_key, child_value in node.items():
                child_path = f"{path}_{child_key}" if path else str(child_key)
                visit(child_value, child_path)
            return
        if isinstance(node, list):
            for index, child in enumerate(node):
                child_path = f"{path}_{index}" if path else str(index)
                visit(child, child_path)
            return

    if isinstance(payload, dict):
        for key, value in payload.items():
            root_path = f"{prefix}_{key}" if prefix else str(key)
            visit(value, root_path)
    else:
        visit(payload, prefix or "value")

    return metrics


def metric_rows_from_dict(player_id, season, week, season_type, source, metrics, updated_at):
    rows = []
    for raw_key, raw_value in metrics.items():
        stat_key = normalize_stat_key(raw_key)
        stat_value = safe_float(raw_value)
        if not stat_key or stat_value is None:
            continue
        if not math.isfinite(stat_value):
            continue
        rows.append(
            (
                str(player_id),
                int(season),
                int(week),
                str(season_type or "regular"),
                str(source),
                stat_key,
                float(stat_value),
                updated_at,
            )
        )
    return rows


def fetch_json(url, timeout=45):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def fetch_bytes(url, timeout=90):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_iso_timestamp(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1]
    try:
        return dt.datetime.fromisoformat(raw)
    except ValueError:
        return None


def load_sleeper_players_cache():
    if not SLEEPER_PLAYERS_CACHE_PATH.exists():
        return None
    try:
        payload = json.loads(SLEEPER_PLAYERS_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    players = payload.get("players")
    fetched_at = parse_iso_timestamp(payload.get("fetched_at"))
    if not isinstance(players, dict):
        return None
    return {
        "players": players,
        "fetched_at": fetched_at,
        "count": len(players),
    }


def save_sleeper_players_cache(players, fetched_at=None):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = fetched_at or utc_now_iso()
    document = {
        "fetched_at": timestamp,
        "players": players,
    }
    temp_path = SLEEPER_PLAYERS_CACHE_PATH.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(document), encoding="utf-8")
    temp_path.replace(SLEEPER_PLAYERS_CACHE_PATH)


def fetch_sleeper_players_cached(force_refresh=False, max_age_seconds=SLEEPER_PLAYERS_CACHE_TTL_SECONDS):
    with SLEEPER_CACHE_LOCK:
        cached = load_sleeper_players_cache()
        now = dt.datetime.utcnow()
        if cached and not force_refresh:
            fetched_at = cached.get("fetched_at")
            if fetched_at and (now - fetched_at).total_seconds() <= max_age_seconds:
                return cached["players"], {
                    "source": "cache",
                    "cached": True,
                    "fetched_at": fetched_at.replace(microsecond=0).isoformat() + "Z",
                    "count": cached["count"],
                }

        try:
            players = fetch_json(SLEEPER_PLAYERS_URL)
            if not isinstance(players, dict):
                raise RuntimeError("Unexpected Sleeper players payload.")
            timestamp = utc_now_iso()
            save_sleeper_players_cache(players, fetched_at=timestamp)
            return players, {
                "source": "network",
                "cached": False,
                "fetched_at": timestamp,
                "count": len(players),
            }
        except (
            OSError,
            ValueError,
            RuntimeError,
            json.JSONDecodeError,
            TimeoutError,
            urllib.error.URLError,
        ) as error:
            if cached:
                fetched_at = cached.get("fetched_at")
                return cached["players"], {
                    "source": "cache_stale",
                    "cached": True,
                    "stale": True,
                    "fetch_error": str(error),
                    "fetched_at": fetched_at.replace(microsecond=0).isoformat() + "Z" if fetched_at else None,
                    "count": cached["count"],
                }
            raise


def sleeper_player_subset_by_ids(player_ids, force_refresh=False):
    ids = []
    seen = set()
    for raw_id in player_ids or []:
        token = str(raw_id or "").strip()
        if not token or token in seen:
            continue
        seen.add(token)
        ids.append(token)
    ids = ids[:8000]

    players_by_id, cache_info = fetch_sleeper_players_cached(force_refresh=force_refresh)
    result = {}
    for player_id in ids:
        player = players_by_id.get(player_id)
        if not isinstance(player, dict):
            continue
        result[player_id] = {
            "player_id": player_id,
            "full_name": player.get("full_name"),
            "first_name": player.get("first_name"),
            "last_name": player.get("last_name"),
            "position": player.get("position"),
            "age": player.get("age"),
            "years_exp": player.get("years_exp"),
            "team": player.get("team"),
            "status": player.get("status"),
        }

    return {
        "count": len(result),
        "requested_ids": len(ids),
        "players": result,
        "cache": cache_info,
    }


def get_connection():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=60)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database(connection):
    with DB_SCHEMA_LOCK:
        connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS players (
          player_id TEXT PRIMARY KEY,
          full_name TEXT,
          first_name TEXT,
          last_name TEXT,
          search_full_name TEXT,
          position TEXT,
          team TEXT,
          status TEXT,
          age REAL,
          years_exp INTEGER,
          gsis_id TEXT,
          espn_id TEXT,
          yahoo_id TEXT,
          fantasy_positions TEXT,
          metadata_json TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_players_search_full_name ON players(search_full_name);
        CREATE INDEX IF NOT EXISTS idx_players_team ON players(team);
        CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
        CREATE INDEX IF NOT EXISTS idx_players_gsis_id ON players(gsis_id);

        CREATE TABLE IF NOT EXISTS player_week_stats (
          player_id TEXT NOT NULL,
          season INTEGER NOT NULL,
          week INTEGER NOT NULL,
          season_type TEXT NOT NULL DEFAULT 'regular',
          team TEXT,
          opponent_team TEXT,
          fantasy_points_ppr REAL,
          fantasy_points_half_ppr REAL,
          fantasy_points_std REAL,
          passing_yards REAL,
          rushing_yards REAL,
          receiving_yards REAL,
          receptions REAL,
          touchdowns REAL,
          turnovers REAL,
          stats_json TEXT,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (player_id, season, week, season_type, source)
        );

        CREATE INDEX IF NOT EXISTS idx_week_stats_lookup ON player_week_stats(player_id, season, week);
        CREATE INDEX IF NOT EXISTS idx_week_stats_points ON player_week_stats(fantasy_points_ppr);

        CREATE TABLE IF NOT EXISTS player_week_metrics (
          player_id TEXT NOT NULL,
          season INTEGER NOT NULL,
          week INTEGER NOT NULL,
          season_type TEXT NOT NULL DEFAULT 'regular',
          source TEXT NOT NULL,
          stat_key TEXT NOT NULL,
          stat_value REAL NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (player_id, season, week, season_type, source, stat_key)
        );

        CREATE INDEX IF NOT EXISTS idx_week_metrics_key_value ON player_week_metrics(stat_key, stat_value);
        CREATE INDEX IF NOT EXISTS idx_week_metrics_player_week ON player_week_metrics(player_id, season, week);

        CREATE TABLE IF NOT EXISTS player_latest_metrics (
          player_id TEXT NOT NULL,
          stat_key TEXT NOT NULL,
          stat_value REAL NOT NULL,
          season INTEGER,
          week INTEGER,
          source TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (player_id, stat_key)
        );

        CREATE INDEX IF NOT EXISTS idx_latest_metrics_key_value ON player_latest_metrics(stat_key, stat_value);
        CREATE INDEX IF NOT EXISTS idx_latest_metrics_player ON player_latest_metrics(player_id);
        CREATE INDEX IF NOT EXISTS idx_latest_metrics_player_key_value ON player_latest_metrics(player_id, stat_key, stat_value);

        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE VIEW IF NOT EXISTS player_latest_stats AS
        WITH ranked AS (
          SELECT
            pws.*,
            ROW_NUMBER() OVER (
              PARTITION BY pws.player_id
              ORDER BY pws.season DESC, pws.week DESC, CASE WHEN pws.source='sleeper' THEN 0 ELSE 1 END
            ) AS rn
          FROM player_week_stats pws
        )
        SELECT * FROM ranked WHERE rn = 1;
        """
        )
        connection.commit()


def upsert_sync_state(connection, key, value):
    now = utc_now_iso()
    connection.execute(
        """
        INSERT INTO sync_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """,
        (key, value, now),
    )
    connection.commit()


def read_sync_state(connection, key):
    row = connection.execute(
        "SELECT value, updated_at FROM sync_state WHERE key = ?",
        (key,),
    ).fetchone()
    if not row:
        return None
    return {
        "value": row["value"],
        "updated_at": parse_iso_timestamp(row["updated_at"]),
    }


def upsert_player_week_metrics(connection, rows):
    if not rows:
        return 0
    connection.executemany(
        """
        INSERT INTO player_week_metrics (
          player_id, season, week, season_type, source, stat_key, stat_value, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, season, week, season_type, source, stat_key) DO UPDATE SET
          stat_value=excluded.stat_value,
          updated_at=excluded.updated_at
        """,
        rows,
    )
    return len(rows)


def upsert_player_week_stats(connection, rows):
    if not rows:
        return 0
    connection.executemany(
        """
        INSERT INTO player_week_stats (
          player_id, season, week, season_type, team, opponent_team,
          fantasy_points_ppr, fantasy_points_half_ppr, fantasy_points_std,
          passing_yards, rushing_yards, receiving_yards, receptions, touchdowns, turnovers,
          stats_json, source, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, season, week, season_type, source) DO UPDATE SET
          team=excluded.team,
          opponent_team=excluded.opponent_team,
          fantasy_points_ppr=excluded.fantasy_points_ppr,
          fantasy_points_half_ppr=excluded.fantasy_points_half_ppr,
          fantasy_points_std=excluded.fantasy_points_std,
          passing_yards=excluded.passing_yards,
          rushing_yards=excluded.rushing_yards,
          receiving_yards=excluded.receiving_yards,
          receptions=excluded.receptions,
          touchdowns=excluded.touchdowns,
          turnovers=excluded.turnovers,
          stats_json=excluded.stats_json,
          updated_at=excluded.updated_at
        """,
        rows,
    )
    return len(rows)


def refresh_latest_metrics(connection):
    now = utc_now_iso()
    connection.execute("DROP TABLE IF EXISTS latest_metric_snapshot")
    connection.execute(
        """
        CREATE TEMP TABLE latest_metric_snapshot AS
        WITH ranked AS (
          SELECT
            pwm.player_id,
            pwm.stat_key,
            pwm.stat_value,
            pwm.season,
            pwm.week,
            pwm.source,
            ROW_NUMBER() OVER (
              PARTITION BY pwm.player_id, pwm.stat_key
              ORDER BY pwm.season DESC, pwm.week DESC, CASE WHEN pwm.source='sleeper' THEN 0 ELSE 1 END
            ) AS rn
          FROM player_week_metrics pwm
        )
        SELECT player_id, stat_key, stat_value, season, week, source
        FROM ranked
        WHERE rn = 1
        """
    )
    connection.execute(
        """
        INSERT INTO player_latest_metrics (
          player_id, stat_key, stat_value, season, week, source, updated_at
        )
        SELECT player_id, stat_key, stat_value, season, week, source, ?
        FROM latest_metric_snapshot
        WHERE 1=1
        ON CONFLICT(player_id, stat_key) DO UPDATE SET
          stat_value=excluded.stat_value,
          season=excluded.season,
          week=excluded.week,
          source=excluded.source,
          updated_at=excluded.updated_at
        """,
        (now,),
    )
    connection.execute(
        """
        DELETE FROM player_latest_metrics
        WHERE source != 'players'
          AND NOT EXISTS (
            SELECT 1
            FROM latest_metric_snapshot snapshot
            WHERE snapshot.player_id = player_latest_metrics.player_id
              AND snapshot.stat_key = player_latest_metrics.stat_key
          )
        """
    )
    connection.execute(
        """
        INSERT INTO player_latest_metrics (
          player_id, stat_key, stat_value, season, week, source, updated_at
        )
        SELECT player_id, 'age', age, NULL, NULL, 'players', ?
        FROM players
        WHERE age IS NOT NULL
        ON CONFLICT(player_id, stat_key) DO UPDATE SET
          stat_value=excluded.stat_value,
          season=excluded.season,
          week=excluded.week,
          source=excluded.source,
          updated_at=excluded.updated_at
        """,
        (now,),
    )
    connection.execute(
        """
        INSERT INTO player_latest_metrics (
          player_id, stat_key, stat_value, season, week, source, updated_at
        )
        SELECT player_id, 'years_exp', years_exp, NULL, NULL, 'players', ?
        FROM players
        WHERE years_exp IS NOT NULL
        ON CONFLICT(player_id, stat_key) DO UPDATE SET
          stat_value=excluded.stat_value,
          season=excluded.season,
          week=excluded.week,
          source=excluded.source,
          updated_at=excluded.updated_at
        """,
        (now,),
    )
    upsert_profile_metrics_from_players(connection, updated_at=now)
    connection.execute("DROP TABLE IF EXISTS latest_metric_snapshot")
    connection.commit()


def upsert_profile_metrics_from_players(connection, updated_at=None):
    updated_at = updated_at or utc_now_iso()
    player_rows = connection.execute(
        "SELECT player_id, metadata_json FROM players WHERE metadata_json IS NOT NULL"
    ).fetchall()

    metric_rows = []
    for player_row in player_rows:
        player_id = player_row["player_id"]
        try:
            payload = json.loads(player_row["metadata_json"] or "{}")
        except json.JSONDecodeError:
            continue
        metrics = flatten_numeric_metrics(payload)
        for stat_key, stat_value in metrics.items():
            if not stat_key:
                continue
            if stat_key == "id" or stat_key.endswith("_id"):
                continue
            if stat_key.startswith("search_"):
                continue
            numeric = safe_float(stat_value)
            if numeric is None or not math.isfinite(numeric):
                continue
            metric_rows.append((player_id, stat_key, float(numeric), None, None, "players", updated_at))

    if not metric_rows:
        return 0

    connection.executemany(
        """
        INSERT INTO player_latest_metrics (
          player_id, stat_key, stat_value, season, week, source, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, stat_key) DO UPDATE SET
          stat_value=excluded.stat_value,
          season=excluded.season,
          week=excluded.week,
          source=excluded.source,
          updated_at=excluded.updated_at
        """,
        metric_rows,
    )
    return len(metric_rows)


def run_full_sync(connection, season=None, include_nflverse=True):
    initialize_database(connection)
    season = int(season or current_nfl_season())

    summary = {
        "season": season,
        "players_upserted": 0,
        "stats_rows_upserted": 0,
        "metrics_rows_upserted": 0,
        "sources": {},
        "synced_at": utc_now_iso(),
    }

    players_result = sync_sleeper_players(connection)
    summary["players_upserted"] = players_result["players_upserted"]
    summary["sources"]["sleeper_players"] = players_result

    sleeper_stats_result = sync_sleeper_weekly_stats(connection, season)
    summary["stats_rows_upserted"] += sleeper_stats_result["stats_rows_upserted"]
    summary["metrics_rows_upserted"] += sleeper_stats_result.get("metrics_rows_upserted", 0)
    summary["sources"]["sleeper_stats"] = sleeper_stats_result

    if include_nflverse:
        nflverse_result = sync_nflverse_player_stats(connection, season)
        summary["stats_rows_upserted"] += nflverse_result["stats_rows_upserted"]
        summary["metrics_rows_upserted"] += nflverse_result.get("metrics_rows_upserted", 0)
        summary["sources"]["nflverse_stats"] = nflverse_result

    refresh_latest_metrics(connection)
    metric_key_count = connection.execute(
        "SELECT COUNT(DISTINCT stat_key) AS value FROM player_latest_metrics"
    ).fetchone()["value"]
    summary["metric_keys_available"] = metric_key_count

    upsert_sync_state(connection, "last_sync_report", json.dumps(summary))
    return summary


def sync_sleeper_players(connection):
    payload, cache_info = fetch_sleeper_players_cached()
    now = utc_now_iso()
    rows = []

    for player_id, player in payload.items():
        full_name = player.get("full_name") or f"{player.get('first_name', '')} {player.get('last_name', '')}".strip()
        if not full_name:
            continue

        fantasy_positions = player.get("fantasy_positions") or []
        rows.append(
            (
                str(player_id),
                full_name,
                player.get("first_name"),
                player.get("last_name"),
                normalize_name(full_name),
                player.get("position"),
                player.get("team"),
                player.get("status"),
                safe_float(player.get("age")),
                int(player.get("years_exp")) if str(player.get("years_exp", "")).isdigit() else None,
                player.get("gsis_id"),
                player.get("espn_id"),
                player.get("yahoo_id"),
                json.dumps(fantasy_positions),
                json.dumps(player),
                now,
            )
        )

    connection.executemany(
        """
        INSERT INTO players (
          player_id, full_name, first_name, last_name, search_full_name, position, team, status,
          age, years_exp, gsis_id, espn_id, yahoo_id, fantasy_positions, metadata_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
          full_name=excluded.full_name,
          first_name=excluded.first_name,
          last_name=excluded.last_name,
          search_full_name=excluded.search_full_name,
          position=excluded.position,
          team=excluded.team,
          status=excluded.status,
          age=excluded.age,
          years_exp=excluded.years_exp,
          gsis_id=excluded.gsis_id,
          espn_id=excluded.espn_id,
          yahoo_id=excluded.yahoo_id,
          fantasy_positions=excluded.fantasy_positions,
          metadata_json=excluded.metadata_json,
          updated_at=excluded.updated_at
        """,
        rows,
    )
    connection.commit()
    return {
        "players_upserted": len(rows),
        "cache": cache_info,
    }


def fetch_sleeper_week_data(season, week):
    urls = [template.format(season=season, week=week) for template in SLEEPER_STATS_ENDPOINTS]
    errors = []

    with ThreadPoolExecutor(max_workers=len(urls)) as executor:
        futures = {
            executor.submit(fetch_json, url, SLEEPER_WEEK_FETCH_TIMEOUT_SECONDS): url
            for url in urls
        }
        for future in as_completed(futures):
            url = futures[future]
            try:
                payload = future.result()
            except (
                OSError,
                ValueError,
                json.JSONDecodeError,
                TimeoutError,
                urllib.error.URLError,
            ) as error:
                errors.append(f"{url}: {error}")
                continue
            if isinstance(payload, dict):
                for pending in futures:
                    if pending is not future:
                        pending.cancel()
                return payload
            errors.append(f"{url}: unexpected payload type")

    if errors:
        raise RuntimeError("; ".join(errors))
    return {}


def sync_sleeper_weekly_stats(connection, season):
    now = utc_now_iso()
    rows = []
    metric_rows = []
    weeks_fetched = 0

    for week in range(1, NFL_REGULAR_SEASON_WEEKS + 1):
        try:
            payload = fetch_sleeper_week_data(season, week)
        except (
            OSError,
            ValueError,
            RuntimeError,
            json.JSONDecodeError,
            TimeoutError,
            urllib.error.URLError,
        ):
            continue

        if not payload:
            continue
        weeks_fetched += 1

        for player_id, stats in payload.items():
            if not isinstance(stats, dict):
                continue
            pass_td = safe_float(stats.get("pass_td")) or 0
            rush_td = safe_float(stats.get("rush_td")) or 0
            rec_td = safe_float(stats.get("rec_td")) or 0
            turnovers = (safe_float(stats.get("pass_int")) or 0) + (safe_float(stats.get("fum_lost")) or 0)

            rows.append(
                (
                    str(player_id),
                    season,
                    week,
                    "regular",
                    stats.get("team"),
                    stats.get("opp"),
                    safe_float(stats.get("pts_ppr")),
                    safe_float(stats.get("pts_half_ppr")),
                    safe_float(stats.get("pts_std")),
                    safe_float(stats.get("pass_yd")),
                    safe_float(stats.get("rush_yd")),
                    safe_float(stats.get("rec_yd")),
                    safe_float(stats.get("rec")),
                    pass_td + rush_td + rec_td,
                    turnovers if turnovers else None,
                    json.dumps(stats),
                    "sleeper",
                    now,
                )
            )

            metrics = flatten_numeric_metrics(stats)
            for source_key, alias_key in SLEEPER_METRIC_ALIASES.items():
                if source_key in metrics and alias_key not in metrics:
                    metrics[alias_key] = metrics[source_key]
            metrics["touchdowns"] = pass_td + rush_td + rec_td
            metrics["turnovers"] = turnovers
            metric_rows.extend(
                metric_rows_from_dict(
                    player_id=player_id,
                    season=season,
                    week=week,
                    season_type="regular",
                    source="sleeper",
                    metrics=metrics,
                    updated_at=now,
                )
            )

    inserted_metrics = upsert_player_week_metrics(connection, metric_rows)
    inserted_stats = upsert_player_week_stats(connection, rows)
    if rows or inserted_metrics:
        connection.commit()

    return {
        "stats_rows_upserted": inserted_stats,
        "metrics_rows_upserted": inserted_metrics,
        "weeks_fetched": weeks_fetched,
    }


def parse_year_from_name(name):
    text = str(name or "")
    matches = re.findall(r"(19\d{2}|20\d{2})", text)
    for token in reversed(matches):
        if token.isdigit():
            return int(token)
    return None


def nflverse_asset_cache_key(season=None):
    season_part = int(season) if season else "latest"
    return f"{NFLVERSE_ASSET_CACHE_KEY_PREFIX}:{season_part}"


def find_nflverse_player_stats_asset(connection, season=None):
    initialize_database(connection)
    cache_key = nflverse_asset_cache_key(season=season)
    cached = read_sync_state(connection, cache_key)
    if cached:
        updated_at = cached.get("updated_at")
        age_seconds = (dt.datetime.utcnow() - updated_at).total_seconds() if updated_at else None
        if age_seconds is not None and age_seconds <= NFLVERSE_ASSET_CACHE_TTL_SECONDS:
            try:
                payload = json.loads(cached.get("value") or "{}")
                if payload and payload.get("url"):
                    return payload
            except json.JSONDecodeError:
                pass

    releases = fetch_json(NFLVERSE_RELEASES_URL)
    season = int(season) if season else None
    candidates = []

    for release in releases:
        tag_name = str(release.get("tag_name", "")).lower()
        name = str(release.get("name", "")).lower()
        if "player" not in tag_name and "player" not in name:
            continue

        for asset in release.get("assets", []):
            asset_name = str(asset.get("name", "")).lower()
            if "player" not in asset_name or "stat" not in asset_name:
                continue
            if not (asset_name.endswith(".csv") or asset_name.endswith(".csv.gz")):
                continue
            asset_year = parse_year_from_name(asset_name)
            score = 0
            if "weekly" in asset_name or "_week" in asset_name:
                score += 30
            if asset_year:
                score += asset_year
                if season and asset_year == season:
                    score += 5000
                elif season and asset_year <= season:
                    score += 500
            candidates.append(
                {
                    "url": asset.get("browser_download_url"),
                    "name": asset.get("name"),
                    "season_hint": asset_year,
                    "score": score,
                }
            )

    if candidates:
        candidates.sort(key=lambda item: item["score"], reverse=True)
        best = candidates[0]
        upsert_sync_state(connection, cache_key, json.dumps(best))
        return best
    return None


def build_player_lookup_maps(connection):
    gsis_map = {}
    name_map = {}
    rows = connection.execute(
        "SELECT player_id, gsis_id, search_full_name, team, position FROM players"
    ).fetchall()
    for row in rows:
        player_id = row["player_id"]
        if row["gsis_id"]:
            gsis_map[str(row["gsis_id"])] = player_id
        key = (row["search_full_name"], row["team"] or "", row["position"] or "")
        name_map[key] = player_id
        if row["search_full_name"]:
            name_map[(row["search_full_name"], "", row["position"] or "")] = player_id
    return gsis_map, name_map


def sync_nflverse_player_stats(connection, season):
    asset = find_nflverse_player_stats_asset(connection, season=season)
    if not asset:
        return {"stats_rows_upserted": 0, "asset": None, "note": "No nflverse player_stats asset found"}

    asset_url = asset["url"]
    asset_year = asset.get("season_hint")
    gsis_map, name_map = build_player_lookup_maps(connection)
    now = utc_now_iso()
    stats_rows_upserted = 0
    metrics_rows_upserted = 0
    stats_batch = []
    metric_batch = []
    stats_batch_size = 250
    metric_batch_size = 12000
    selected_season = int(season)
    fallback_season_used = False
    request = urllib.request.Request(asset_url, headers={"User-Agent": USER_AGENT})

    def flush_batches():
        nonlocal stats_rows_upserted, metrics_rows_upserted, stats_batch, metric_batch
        wrote_any = False
        if stats_batch:
            stats_rows_upserted += upsert_player_week_stats(connection, stats_batch)
            stats_batch = []
            wrote_any = True
        if metric_batch:
            metrics_rows_upserted += upsert_player_week_metrics(connection, metric_batch)
            metric_batch = []
            wrote_any = True
        if wrote_any:
            connection.commit()

    def process_reader(reader):
        nonlocal fallback_season_used
        for row in reader:
            try:
                row_season = int(row.get("season", 0))
                row_week = int(row.get("week", 0))
            except (TypeError, ValueError):
                continue
            if row_season != selected_season:
                if asset_year and row_season == asset_year and selected_season > asset_year:
                    fallback_season_used = True
                else:
                    continue
            if row_week <= 0:
                continue

            stats_player_id = str(row.get("player_id") or "")
            player_id = gsis_map.get(stats_player_id)

            if not player_id:
                search_name = normalize_name(row.get("player_display_name") or row.get("player_name"))
                key = (search_name, row.get("recent_team", "") or "", row.get("position", "") or "")
                player_id = name_map.get(key) or name_map.get((search_name, "", row.get("position", "") or ""))
            if not player_id:
                continue

            touchdowns = (
                (safe_float(row.get("passing_tds")) or 0)
                + (safe_float(row.get("rushing_tds")) or 0)
                + (safe_float(row.get("receiving_tds")) or 0)
            )
            turnovers = (safe_float(row.get("interceptions")) or 0) + (safe_float(row.get("rushing_fumbles_lost")) or 0)

            stats_batch.append(
                (
                    player_id,
                    row_season,
                    row_week,
                    "regular",
                    row.get("recent_team"),
                    row.get("opponent_team"),
                    safe_float(row.get("fantasy_points_ppr")),
                    safe_float(row.get("fantasy_points_half_ppr")),
                    safe_float(row.get("fantasy_points")),
                    safe_float(row.get("passing_yards")),
                    safe_float(row.get("rushing_yards")),
                    safe_float(row.get("receiving_yards")),
                    safe_float(row.get("receptions")),
                    touchdowns,
                    turnovers if turnovers else None,
                    json.dumps(row),
                    "nflverse",
                    now,
                )
            )

            metrics = flatten_numeric_metrics(row)
            metrics["touchdowns"] = touchdowns
            metrics["turnovers"] = turnovers
            metric_batch.extend(
                metric_rows_from_dict(
                    player_id=player_id,
                    season=row_season,
                    week=row_week,
                    season_type="regular",
                    source="nflverse",
                    metrics=metrics,
                    updated_at=now,
                )
            )

            if len(stats_batch) >= stats_batch_size or len(metric_batch) >= metric_batch_size:
                flush_batches()

    with urllib.request.urlopen(request, timeout=180) as response:
        if asset_url.endswith(".gz"):
            with gzip.GzipFile(fileobj=response) as raw_stream:
                with io.TextIOWrapper(raw_stream, encoding="utf-8", errors="ignore", newline="") as text_stream:
                    process_reader(csv.DictReader(text_stream))
        else:
            with io.TextIOWrapper(response, encoding="utf-8", errors="ignore", newline="") as text_stream:
                process_reader(csv.DictReader(text_stream))

    flush_batches()

    return {
        "stats_rows_upserted": stats_rows_upserted,
        "metrics_rows_upserted": metrics_rows_upserted,
        "asset": asset_url,
        "asset_name": asset.get("name"),
        "asset_season_hint": asset_year,
        "fallback_season_used": fallback_season_used,
    }


def fetch_health_summary(connection):
    initialize_database(connection)
    player_count = connection.execute("SELECT COUNT(*) AS value FROM players").fetchone()["value"]
    stat_count = connection.execute("SELECT COUNT(*) AS value FROM player_week_stats").fetchone()["value"]
    metric_count = connection.execute("SELECT COUNT(*) AS value FROM player_week_metrics").fetchone()["value"]
    latest_metric_count = connection.execute("SELECT COUNT(*) AS value FROM player_latest_metrics").fetchone()["value"]
    metric_key_count = connection.execute(
        "SELECT COUNT(DISTINCT stat_key) AS value FROM player_latest_metrics"
    ).fetchone()["value"]
    last_sync = connection.execute(
        "SELECT value, updated_at FROM sync_state WHERE key='last_sync_report'"
    ).fetchone()

    return {
        "database_path": str(DB_PATH),
        "players": player_count,
        "stats_rows": stat_count,
        "metric_rows": metric_count,
        "latest_metric_rows": latest_metric_count,
        "metric_keys_available": metric_key_count,
        "last_sync_at": last_sync["updated_at"] if last_sync else None,
        "last_sync_report": json.loads(last_sync["value"]) if last_sync and last_sync["value"] else None,
    }


def parse_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_players(connection, query):
    initialize_database(connection)
    search = (query.get("search") or "").strip().lower()
    position = (query.get("position") or "").strip().upper()
    team = (query.get("team") or "").strip().upper()
    limit = max(1, min(parse_int(query.get("limit"), 200), 5000))
    offset = max(0, parse_int(query.get("offset"), 0))
    sort = (query.get("sort") or "points_desc").strip().lower()

    sort_sql = {
        "points_desc": "COALESCE(l.fantasy_points_ppr, -9999) DESC, p.full_name ASC",
        "points_asc": "COALESCE(l.fantasy_points_ppr, 9999) ASC, p.full_name ASC",
        "name": "p.full_name ASC",
        "team": "p.team ASC, p.full_name ASC",
    }.get(sort, "COALESCE(l.fantasy_points_ppr, -9999) DESC, p.full_name ASC")

    sql = f"""
      SELECT
        p.player_id, p.full_name, p.first_name, p.last_name, p.position, p.team, p.status, p.age, p.years_exp,
        l.season AS latest_season, l.week AS latest_week, l.source AS latest_source,
        l.fantasy_points_ppr AS latest_fantasy_points_ppr,
        l.passing_yards AS latest_passing_yards,
        l.rushing_yards AS latest_rushing_yards,
        l.receiving_yards AS latest_receiving_yards,
        l.receptions AS latest_receptions,
        l.touchdowns AS latest_touchdowns
      FROM players p
      LEFT JOIN player_latest_stats l ON l.player_id = p.player_id
      WHERE 1=1
    """
    params = []
    if search:
        sql += " AND (LOWER(p.full_name) LIKE ? OR LOWER(p.first_name) LIKE ? OR LOWER(p.last_name) LIKE ?)"
        wildcard = f"%{search}%"
        params.extend([wildcard, wildcard, wildcard])
    if position:
        sql += " AND p.position = ?"
        params.append(position)
    if team:
        sql += " AND p.team = ?"
        params.append(team)

    sql += f" ORDER BY {sort_sql} LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = connection.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def normalize_filter_operator(value):
    token = str(value or "").strip().lower()
    return {
        "gte": "gte",
        ">=": "gte",
        "min": "gte",
        "lte": "lte",
        "<=": "lte",
        "max": "lte",
        "gt": "gt",
        ">": "gt",
        "lt": "lt",
        "<": "lt",
        "eq": "eq",
        "=": "eq",
        "neq": "neq",
        "!=": "neq",
        "between": "between",
        "range": "between",
    }.get(token, "gte")


def normalize_screen_filters(raw_filters):
    normalized = []
    if not isinstance(raw_filters, list):
        return normalized

    for raw_filter in raw_filters:
        if not isinstance(raw_filter, dict):
            continue
        key = normalize_stat_key(raw_filter.get("key") or raw_filter.get("stat_key"))
        if not key:
            continue

        operator = normalize_filter_operator(raw_filter.get("op") or raw_filter.get("operator"))
        value = parse_float(raw_filter.get("value"))
        value_max = parse_float(raw_filter.get("value_max") or raw_filter.get("max") or raw_filter.get("value2"))

        if operator == "between":
            if value is None or value_max is None:
                continue
            low = min(value, value_max)
            high = max(value, value_max)
            normalized.append({"key": key, "op": operator, "value": low, "value_max": high})
        else:
            if value is None:
                continue
            normalized.append({"key": key, "op": operator, "value": value, "value_max": None})

        if len(normalized) >= MAX_SCREEN_FILTERS:
            break

    return normalized


def build_filter_sql(alias, metric_filter):
    operator = metric_filter.get("op")
    value = metric_filter.get("value")
    value_max = metric_filter.get("value_max")

    if operator == "lt":
        return f"{alias}.stat_value < ?", [value]
    if operator == "lte":
        return f"{alias}.stat_value <= ?", [value]
    if operator == "gt":
        return f"{alias}.stat_value > ?", [value]
    if operator == "eq":
        return f"{alias}.stat_value = ?", [value]
    if operator == "neq":
        return f"{alias}.stat_value != ?", [value]
    if operator == "between":
        return f"{alias}.stat_value BETWEEN ? AND ?", [value, value_max]
    return f"{alias}.stat_value >= ?", [value]


def dedupe_metric_keys(keys):
    seen = set()
    deduped = []
    for key in keys:
        stat_key = normalize_stat_key(key)
        if not stat_key or stat_key in seen:
            continue
        seen.add(stat_key)
        deduped.append(stat_key)
    return deduped


def build_requested_metric_keys(raw_columns, filters):
    keys = ["fantasy_points_ppr", "age", "years_exp"]
    keys.extend([entry["key"] for entry in filters])
    if isinstance(raw_columns, list):
        keys.extend(raw_columns)
    return dedupe_metric_keys(keys)[:80]


def fetch_filter_options(connection, query):
    initialize_database(connection)
    search = str(query.get("search") or "").strip().lower()
    position = str(query.get("position") or "").strip().upper()
    team = str(query.get("team") or "").strip().upper()
    limit = max(1, min(parse_int(query.get("limit"), 600), 12000))

    sync_state = read_sync_state(connection, "last_sync_report")
    cache_stamp = str(sync_state.get("updated_at") or "no_sync")
    cache_key = f"{search}|{position}|{team}|{limit}"

    with FILTER_OPTIONS_CACHE_LOCK:
        if FILTER_OPTIONS_CACHE.get("stamp") == cache_stamp:
            cached = FILTER_OPTIONS_CACHE["entries"].get(cache_key)
            if cached is not None:
                return cached
        else:
            FILTER_OPTIONS_CACHE["stamp"] = cache_stamp
            FILTER_OPTIONS_CACHE["entries"] = {}

    sql = """
      SELECT
        plm.stat_key,
        COUNT(*) AS player_count,
        MIN(plm.stat_value) AS min_value,
        MAX(plm.stat_value) AS max_value
      FROM player_latest_metrics plm
    """
    params = []
    where_parts = ["1=1"]

    if position or team:
        sql += " JOIN players p ON p.player_id = plm.player_id"

    if search:
        token = normalize_stat_key(search)
        wildcard = f"%{token.replace('_', '%') if token else search}%"
        if token == "yac":
            where_parts.append("(plm.stat_key LIKE ? OR plm.stat_key LIKE ?)")
            params.extend(["%yac%", "%yards_after_catch%"])
        else:
            where_parts.append("plm.stat_key LIKE ?")
            params.append(wildcard)
    if position:
        where_parts.append("p.position = ?")
        params.append(position)
    if team:
        where_parts.append("p.team = ?")
        params.append(team)

    sql += f" WHERE {' AND '.join(where_parts)}"
    sql += """
      GROUP BY plm.stat_key
      ORDER BY
        CASE plm.stat_key
          WHEN 'fantasy_points_ppr' THEN 0
          WHEN 'age' THEN 1
          WHEN 'years_exp' THEN 2
          ELSE 100
        END,
        plm.stat_key ASC
      LIMIT ?
    """
    params.append(limit)

    rows = connection.execute(sql, params).fetchall()
    items = []
    for row in rows:
        items.append(
            {
                "key": row["stat_key"],
                "label": build_stat_label(row["stat_key"]),
                "min_value": row["min_value"],
                "max_value": row["max_value"],
                "player_count": row["player_count"],
            }
        )

    with FILTER_OPTIONS_CACHE_LOCK:
        entries = FILTER_OPTIONS_CACHE["entries"]
        entries[cache_key] = items
        if len(entries) > FILTER_OPTIONS_CACHE_MAX_ENTRIES:
            oldest_key = next(iter(entries))
            if oldest_key != cache_key:
                entries.pop(oldest_key, None)
    return items


def fetch_teams(connection):
    initialize_database(connection)
    rows = connection.execute(
        """
        SELECT DISTINCT team
        FROM players
        WHERE team IS NOT NULL AND team != ''
        ORDER BY team ASC
        """
    ).fetchall()
    return [row["team"] for row in rows if row["team"]]


def fetch_screener_query(connection, payload):
    initialize_database(connection)
    payload = payload or {}

    search = str(payload.get("search") or "").strip().lower()
    position = str(payload.get("position") or "").strip().upper()
    raw_positions = payload.get("positions")
    positions = []
    if isinstance(raw_positions, str):
        positions = [item.strip().upper() for item in raw_positions.split(",") if item and str(item).strip()]
    elif isinstance(raw_positions, (list, tuple, set)):
        positions = [str(item).strip().upper() for item in raw_positions if item and str(item).strip()]
    if not positions and position:
        positions = [position]
    positions = [item for item in positions if item]

    team = str(payload.get("team") or "").strip().upper()
    age_min = parse_float(payload.get("age_min"))
    age_max = parse_float(payload.get("age_max"))
    limit = max(1, min(parse_int(payload.get("limit"), 200), 1000))
    offset = max(0, parse_int(payload.get("offset"), 0))
    filters = normalize_screen_filters(payload.get("filters"))
    requested_metric_keys = build_requested_metric_keys(payload.get("columns"), filters)

    sort_key = normalize_stat_key(payload.get("sort_key") or "fantasy_points_ppr")
    sort_direction = str(payload.get("sort_direction") or "desc").strip().lower()
    sort_is_asc = sort_direction == "asc"
    sort_null_fill = "9999999" if sort_is_asc else "-9999999"
    sort_order = "ASC" if sort_is_asc else "DESC"

    where_params = []
    where_parts = ["1=1"]
    filter_join_parts = []
    filter_join_params = []

    for index, metric_filter in enumerate(filters):
        alias = f"mf{index}"
        filter_sql, filter_params = build_filter_sql(alias, metric_filter)
        filter_join_parts.append(
            f"""
            JOIN player_latest_metrics {alias}
              ON {alias}.player_id = p.player_id
             AND {alias}.stat_key = ?
             AND {filter_sql}
            """
        )
        filter_join_params.extend([metric_filter["key"], *filter_params])

    if search:
        where_parts.append("(LOWER(p.full_name) LIKE ? OR LOWER(p.first_name) LIKE ? OR LOWER(p.last_name) LIKE ?)")
        wildcard = f"%{search}%"
        where_params.extend([wildcard, wildcard, wildcard])
    if positions:
        placeholders = ", ".join(["?"] * len(positions))
        where_parts.append(f"p.position IN ({placeholders})")
        where_params.extend(positions)
    if team:
        where_parts.append("p.team = ?")
        where_params.append(team)
    if age_min is not None:
        where_parts.append("p.age >= ?")
        where_params.append(age_min)
    if age_max is not None:
        where_parts.append("p.age <= ?")
        where_params.append(age_max)

    from_clause = f"FROM players p {' '.join(filter_join_parts)}"
    select_params = [*filter_join_params, sort_key or "fantasy_points_ppr", *where_params, limit, offset]

    if requested_metric_keys:
        metric_placeholders = ",".join(["?"] * len(requested_metric_keys))
        sql = f"""
          WITH ranked AS (
            SELECT
              p.player_id, p.full_name, p.position, p.team, p.status, p.age, p.years_exp,
              l.season AS latest_season, l.week AS latest_week, l.source AS latest_source,
              l.fantasy_points_ppr AS latest_fantasy_points_ppr,
              l.passing_yards AS latest_passing_yards,
              l.rushing_yards AS latest_rushing_yards,
              l.receiving_yards AS latest_receiving_yards,
              l.receptions AS latest_receptions,
              l.touchdowns AS latest_touchdowns,
              COALESCE(msort.stat_value, COALESCE(l.fantasy_points_ppr, {sort_null_fill})) AS sort_value
            {from_clause}
            LEFT JOIN player_latest_stats l ON l.player_id = p.player_id
            LEFT JOIN player_latest_metrics msort
              ON msort.player_id = p.player_id
             AND msort.stat_key = ?
            WHERE {' AND '.join(where_parts)}
            ORDER BY sort_value {sort_order}, p.full_name ASC
            LIMIT ? OFFSET ?
          )
          SELECT
            r.player_id, r.full_name, r.position, r.team, r.status, r.age, r.years_exp,
            r.latest_season, r.latest_week, r.latest_source,
            r.latest_fantasy_points_ppr, r.latest_passing_yards, r.latest_rushing_yards,
            r.latest_receiving_yards, r.latest_receptions, r.latest_touchdowns,
            r.sort_value,
            mv.stat_key,
            mv.stat_value
          FROM ranked r
          LEFT JOIN player_latest_metrics mv
            ON mv.player_id = r.player_id
           AND mv.stat_key IN ({metric_placeholders})
          ORDER BY r.sort_value {sort_order}, r.full_name ASC
        """
        rows = connection.execute(sql, [*select_params, *requested_metric_keys]).fetchall()
        items_by_player_id = {}
        order = []
        for row in rows:
            player_id = row["player_id"]
            if player_id not in items_by_player_id:
                item = {
                    "player_id": row["player_id"],
                    "full_name": row["full_name"],
                    "position": row["position"],
                    "team": row["team"],
                    "status": row["status"],
                    "age": row["age"],
                    "years_exp": row["years_exp"],
                    "latest_season": row["latest_season"],
                    "latest_week": row["latest_week"],
                    "latest_source": row["latest_source"],
                    "latest_fantasy_points_ppr": row["latest_fantasy_points_ppr"],
                    "latest_passing_yards": row["latest_passing_yards"],
                    "latest_rushing_yards": row["latest_rushing_yards"],
                    "latest_receiving_yards": row["latest_receiving_yards"],
                    "latest_receptions": row["latest_receptions"],
                    "latest_touchdowns": row["latest_touchdowns"],
                    "metrics": {},
                }
                items_by_player_id[player_id] = item
                order.append(player_id)
            stat_key = row["stat_key"]
            if stat_key:
                items_by_player_id[player_id]["metrics"][stat_key] = row["stat_value"]
        items = [items_by_player_id[player_id] for player_id in order]
    else:
        sql = f"""
          SELECT
            p.player_id, p.full_name, p.position, p.team, p.status, p.age, p.years_exp,
            l.season AS latest_season, l.week AS latest_week, l.source AS latest_source,
            l.fantasy_points_ppr AS latest_fantasy_points_ppr,
            l.passing_yards AS latest_passing_yards,
            l.rushing_yards AS latest_rushing_yards,
            l.receiving_yards AS latest_receiving_yards,
            l.receptions AS latest_receptions,
            l.touchdowns AS latest_touchdowns
          {from_clause}
          LEFT JOIN player_latest_stats l ON l.player_id = p.player_id
          LEFT JOIN player_latest_metrics msort
            ON msort.player_id = p.player_id
           AND msort.stat_key = ?
          WHERE {' AND '.join(where_parts)}
          ORDER BY COALESCE(msort.stat_value, COALESCE(l.fantasy_points_ppr, {sort_null_fill})) {sort_order}, p.full_name ASC
          LIMIT ? OFFSET ?
        """
        rows = connection.execute(sql, select_params).fetchall()
        items = [dict(row) for row in rows]
        for item in items:
            item["metrics"] = {}

    return {
        "count": len(items),
        "filters": filters,
        "columns": requested_metric_keys,
        "items": items,
    }


def fetch_screener(connection, query):
    min_filter_map = {
        "min_ppr": "fantasy_points_ppr",
        "min_passing_yards": "passing_yards",
        "min_rushing_yards": "rushing_yards",
        "min_receiving_yards": "receiving_yards",
        "min_receptions": "receptions",
    }
    filters = []
    for raw_key, metric_key in min_filter_map.items():
        value = parse_float(query.get(raw_key))
        if value is None:
            continue
        filters.append({"key": metric_key, "op": "gte", "value": value})

    response = fetch_screener_query(
        connection,
        {
            "search": query.get("search"),
            "position": query.get("position"),
            "team": query.get("team"),
            "limit": query.get("limit"),
            "offset": query.get("offset"),
            "filters": filters,
        },
    )
    return response["items"]


def fetch_player_history(connection, player_id, season=None, limit=36):
    initialize_database(connection)
    params = [player_id]
    sql = """
      SELECT player_id, season, week, season_type, source,
             fantasy_points_ppr, passing_yards, rushing_yards, receiving_yards, receptions, touchdowns
      FROM player_week_stats
      WHERE player_id = ?
    """
    if season:
        sql += " AND season = ?"
        params.append(int(season))

    sql += " ORDER BY season DESC, week DESC LIMIT ?"
    params.append(max(1, min(int(limit), 200)))
    rows = connection.execute(sql, params).fetchall()
    return [dict(row) for row in rows]
