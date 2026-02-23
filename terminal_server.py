import argparse
import json
import os
import threading
import traceback
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import live_data

BASE_DIR = Path(__file__).resolve().parent
LEGACY_REDIRECTS = {
    "/index": "/home.html",
    "/index.html": "/home.html",
    "/home": "/home.html",
    "/lab": "/lab.html",
    "/league-intel": "/league-intel.html",
    "/agents": "/agents.html",
    "/screener": "/lab.html",
    "/screener.html": "/lab.html",
    "/terminal": "/league-intel.html",
    "/terminal.html": "/league-intel.html",
    "/mission": "/home.html",
    "/mission.html": "/home.html",
    "/modules": "/home.html",
    "/modules.html": "/home.html",
    "/pricing": "/home.html",
    "/pricing.html": "/home.html",
    "/roadmap": "/home.html",
    "/roadmap.html": "/home.html",
}
SYNC_STATE_LOCK = threading.Lock()
SYNC_THREAD = None
SYNC_STATE = {
    "running": False,
    "season": None,
    "include_nflverse": False,
    "last_started_at": None,
    "last_finished_at": None,
    "last_summary": None,
    "last_error": None,
}
STATIC_CACHE_MAX_AGE_BY_EXT = {
    ".css": 3600,
    ".js": 3600,
    ".mjs": 3600,
    ".json": 900,
    ".svg": 3600,
    ".png": 3600,
    ".jpg": 3600,
    ".jpeg": 3600,
    ".gif": 3600,
    ".webp": 3600,
    ".woff": 3600,
    ".woff2": 3600,
    ".ttf": 3600,
}
DEFAULT_STATIC_MAX_AGE = 300
HTML_MAX_AGE = 60


def first(query, key, default=None):
    values = query.get(key)
    if not values:
        return default
    return values[0]


def sync_snapshot():
    global SYNC_THREAD
    with SYNC_STATE_LOCK:
        if SYNC_STATE["running"] and (SYNC_THREAD is None or not SYNC_THREAD.is_alive()):
            SYNC_STATE["running"] = False
            if not SYNC_STATE["last_finished_at"]:
                SYNC_STATE["last_finished_at"] = live_data.utc_now_iso()
        return dict(SYNC_STATE)


def should_async_admin_sync(query):
    mode = str(first(query, "mode", "auto")).strip().lower()
    if mode in {"sync", "blocking"}:
        return False
    if mode in {"async", "background"}:
        return True
    return env_is_truthy("FDL_ADMIN_SYNC_ASYNC", default=False)


def parse_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def should_include_nflverse(query):
    explicit = first(query, "include_nflverse")
    if explicit is None:
        explicit = first(query, "full")
    return parse_bool(explicit, default=env_is_truthy("FDL_SYNC_INCLUDE_NFLVERSE", default=False))


def start_background_sync(season, include_nflverse=False):
    global SYNC_THREAD
    with SYNC_STATE_LOCK:
        if SYNC_STATE["running"]:
            return False
        SYNC_STATE["running"] = True
        SYNC_STATE["season"] = int(season)
        SYNC_STATE["include_nflverse"] = bool(include_nflverse)
        SYNC_STATE["last_started_at"] = live_data.utc_now_iso()
        SYNC_STATE["last_error"] = None

    def _runner():
        try:
            summary = run_sync_task(season=season, include_nflverse=include_nflverse)
            with SYNC_STATE_LOCK:
                SYNC_STATE["last_summary"] = summary
                SYNC_STATE["last_error"] = None
        except Exception as error:  # noqa: BLE001
            with SYNC_STATE_LOCK:
                SYNC_STATE["last_error"] = str(error)
        finally:
            with SYNC_STATE_LOCK:
                SYNC_STATE["running"] = False
                SYNC_STATE["last_finished_at"] = live_data.utc_now_iso()

    SYNC_THREAD = threading.Thread(target=_runner, daemon=True)
    SYNC_THREAD.start()
    return True


class TerminalRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self._pending_cache_control = None
        self._pending_etag = None
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def _reset_response_cache_headers(self):
        self._pending_cache_control = None
        self._pending_etag = None

    def _prepare_static_cache_headers(self, parsed):
        self._reset_response_cache_headers()
        if parsed.path.startswith("/api/"):
            return False

        target_path = parsed.path or "/"
        if target_path == "/":
            target_path = "/home.html"
        if target_path in LEGACY_REDIRECTS:
            return False

        clean = unquote(target_path.lstrip("/"))
        if not clean:
            return False

        candidate = (BASE_DIR / clean).resolve()
        try:
            candidate.relative_to(BASE_DIR)
        except ValueError:
            return False
        if not candidate.exists() or not candidate.is_file():
            return False

        stat_result = candidate.stat()
        ext = candidate.suffix.lower()
        if ext == ".html":
            max_age = HTML_MAX_AGE
        else:
            max_age = STATIC_CACHE_MAX_AGE_BY_EXT.get(ext, DEFAULT_STATIC_MAX_AGE)
        self._pending_cache_control = f"public, max-age={max_age}, stale-while-revalidate=300"
        self._pending_etag = f'W/"{stat_result.st_mtime_ns:x}-{stat_result.st_size:x}"'

        incoming_etag = self.headers.get("If-None-Match")
        if incoming_etag and incoming_etag == self._pending_etag:
            self.send_response(304)
            self.end_headers()
            return True

        return False

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if self._prepare_static_cache_headers(parsed):
            return
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed, method="GET")
            return
        redirect_target = LEGACY_REDIRECTS.get(parsed.path)
        if redirect_target:
            self.redirect_to(redirect_target, parsed.query)
            return
        if parsed.path == "/":
            self.path = "/home.html"
        super().do_GET()

    def do_HEAD(self):  # noqa: N802
        parsed = urlparse(self.path)
        if self._prepare_static_cache_headers(parsed):
            return
        if parsed.path.startswith("/api/"):
            self.send_error(405, "Method Not Allowed")
            return
        redirect_target = LEGACY_REDIRECTS.get(parsed.path)
        if redirect_target:
            self.redirect_to(redirect_target, parsed.query)
            return
        if parsed.path == "/":
            self.path = "/home.html"
        super().do_HEAD()

    def do_POST(self):  # noqa: N802
        self._reset_response_cache_headers()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed, method="POST")
            return
        self.send_error(404, "Not Found")

    def handle_api(self, parsed, method):
        try:
            query = parse_qs(parsed.query)
            body = self.read_json_body() if method == "POST" else {}

            with live_data.get_connection() as connection:
                if parsed.path == "/api/health" and method == "GET":
                    payload = live_data.fetch_health_summary(connection)
                    self.send_json(200, payload)
                    return

                if parsed.path == "/api/admin/sync/status" and method == "GET":
                    status_payload = sync_snapshot()
                    health_payload = live_data.fetch_health_summary(connection)
                    if health_payload.get("last_sync_report") and not status_payload.get("last_summary"):
                        status_payload["last_summary"] = health_payload.get("last_sync_report")
                    if health_payload.get("last_sync_at"):
                        status_payload["db_last_sync_at"] = health_payload.get("last_sync_at")
                    self.send_json(200, {"ok": True, "status": status_payload})
                    return

                if parsed.path == "/api/filter-options" and method == "GET":
                    items = live_data.fetch_filter_options(
                        connection,
                        {
                            "search": first(query, "search", ""),
                            "position": first(query, "position", ""),
                            "team": first(query, "team", ""),
                            "limit": first(query, "limit", "600"),
                        },
                    )
                    self.send_json(200, {"count": len(items), "items": items})
                    return

                if parsed.path == "/api/players" and method == "GET":
                    items = live_data.fetch_players(
                        connection,
                        {
                            "search": first(query, "search", ""),
                            "position": first(query, "position", ""),
                            "team": first(query, "team", ""),
                            "limit": first(query, "limit", "200"),
                            "offset": first(query, "offset", "0"),
                            "sort": first(query, "sort", "points_desc"),
                        },
                    )
                    self.send_json(200, {"count": len(items), "items": items})
                    return

                if parsed.path == "/api/sleeper/players/by-ids" and method in {"GET", "POST"}:
                    raw_ids = []
                    if method == "GET":
                        raw_ids = first(query, "ids", "") or ""
                    else:
                        raw_ids = body.get("ids", [])

                    if isinstance(raw_ids, str):
                        ids = [token.strip() for token in raw_ids.split(",") if token and token.strip()]
                    elif isinstance(raw_ids, (list, tuple, set)):
                        ids = [str(token).strip() for token in raw_ids if token and str(token).strip()]
                    else:
                        ids = []

                    force_refresh = parse_bool(
                        body.get("force_refresh") if method == "POST" else first(query, "force_refresh"),
                        default=False,
                    )
                    payload = live_data.sleeper_player_subset_by_ids(ids, force_refresh=force_refresh)
                    self.send_json(200, payload)
                    return

                if parsed.path == "/api/screener/query" and method == "POST":
                    result = live_data.fetch_screener_query(connection, body)
                    self.send_json(200, result)
                    return

                if parsed.path == "/api/screener" and method == "GET":
                    items = live_data.fetch_screener(
                        connection,
                        {
                            "search": first(query, "search", ""),
                            "position": first(query, "position", ""),
                            "team": first(query, "team", ""),
                            "limit": first(query, "limit", "200"),
                            "offset": first(query, "offset", "0"),
                            "min_ppr": first(query, "min_ppr", ""),
                            "min_passing_yards": first(query, "min_passing_yards", ""),
                            "min_rushing_yards": first(query, "min_rushing_yards", ""),
                            "min_receiving_yards": first(query, "min_receiving_yards", ""),
                            "min_receptions": first(query, "min_receptions", ""),
                        },
                    )
                    self.send_json(200, {"count": len(items), "items": items})
                    return

                if parsed.path.startswith("/api/players/") and method == "GET":
                    player_id = parsed.path.split("/api/players/")[1]
                    if not player_id:
                        self.send_json(400, {"error": "player_id is required"})
                        return
                    history = live_data.fetch_player_history(
                        connection,
                        player_id=player_id,
                        season=first(query, "season", None),
                        limit=first(query, "limit", 36),
                    )
                    self.send_json(200, {"player_id": player_id, "items": history})
                    return

                if parsed.path == "/api/admin/sync" and method in {"GET", "POST"}:
                    season = first(query, "season", live_data.current_nfl_season())
                    include_nflverse = should_include_nflverse(query)
                    if method == "POST":
                        include_nflverse = parse_bool(body.get("include_nflverse"), default=include_nflverse)
                    if should_async_admin_sync(query):
                        started = start_background_sync(season=season, include_nflverse=include_nflverse)
                        payload = {
                            "ok": True,
                            "queued": started,
                            "include_nflverse": include_nflverse,
                            "status": sync_snapshot(),
                        }
                        if not started:
                            payload["note"] = "A sync job is already running."
                        self.send_json(202, payload)
                        return

                    summary = live_data.run_full_sync(
                        connection,
                        season=season,
                        include_nflverse=include_nflverse,
                    )
                    with SYNC_STATE_LOCK:
                        SYNC_STATE["last_summary"] = summary
                        SYNC_STATE["last_error"] = None
                        SYNC_STATE["include_nflverse"] = include_nflverse
                        SYNC_STATE["last_finished_at"] = live_data.utc_now_iso()
                    self.send_json(200, {"ok": True, "summary": summary, "status": sync_snapshot()})
                    return

            self.send_json(404, {"error": f"Unknown endpoint: {parsed.path}"})
        except Exception as error:  # noqa: BLE001
            self.send_json(
                500,
                {
                    "error": str(error),
                    "traceback": traceback.format_exc(limit=6),
                },
            )

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        elif self._pending_cache_control:
            self.send_header("Cache-Control", self._pending_cache_control)
        if self._pending_etag:
            self.send_header("ETag", self._pending_etag)
        super().end_headers()
        self._reset_response_cache_headers()

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def redirect_to(self, path, query):
        location = str(path)
        if query:
            location = f"{location}?{query}"
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        content_length = self.headers.get("Content-Length")
        if not content_length:
            return {}
        try:
            size = int(content_length)
        except ValueError:
            return {}
        if size <= 0:
            return {}
        raw = self.rfile.read(size)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}


def parse_args():
    parser = argparse.ArgumentParser(description="Fourth Down Labs terminal server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", default=8000, type=int, help="Port to bind")
    parser.add_argument(
        "--sync-on-start",
        action="store_true",
        help="Run live data sync before serving requests",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=live_data.current_nfl_season(),
        help="NFL season for initial sync",
    )
    return parser.parse_args()


def env_is_truthy(name, default=False):
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def run_sync_task(season=None, include_nflverse=False):
    with live_data.get_connection() as connection:
        summary = live_data.run_full_sync(connection, season=season, include_nflverse=include_nflverse)
    print(
        "Background sync complete: "
        f"players={summary.get('players_upserted', 0)} "
        f"stats={summary.get('stats_rows_upserted', 0)} "
        f"metrics={summary.get('metrics_rows_upserted', 0)} "
        f"(include_nflverse={bool(include_nflverse)})"
    )
    return summary


def main():
    args = parse_args()
    sync_on_start_env = env_is_truthy("FDL_AUTO_SYNC_ON_START", default=False)
    sync_blocking_env = env_is_truthy("FDL_SYNC_BLOCKING", default=False)
    include_nflverse_env = env_is_truthy("FDL_SYNC_INCLUDE_NFLVERSE", default=False)
    season_env = os.getenv("FDL_SYNC_SEASON")
    sync_season = int(season_env) if season_env and str(season_env).isdigit() else args.season

    with live_data.get_connection() as connection:
        live_data.initialize_database(connection)
        if args.sync_on_start and not sync_on_start_env:
            summary = live_data.run_full_sync(
                connection,
                season=args.season,
                include_nflverse=include_nflverse_env,
            )
            print(f"Initial sync complete: players={summary['players_upserted']} stats={summary['stats_rows_upserted']}")

    handler = partial(TerminalRequestHandler)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving Fourth Down Labs terminal on http://{args.host}:{args.port}")

    if sync_on_start_env:
        if sync_blocking_env:
            print("Running startup sync in blocking mode...")
            run_sync_task(season=sync_season, include_nflverse=include_nflverse_env)
        else:
            print("Starting background startup sync thread...")
            thread = threading.Thread(
                target=run_sync_task,
                kwargs={"season": sync_season, "include_nflverse": include_nflverse_env},
                daemon=True,
            )
            thread.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
