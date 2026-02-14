import argparse
import json
import os
import threading
import traceback
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import live_data

BASE_DIR = Path(__file__).resolve().parent
LEGACY_REDIRECTS = {
    "/index": "/index.html",
    "/lab": "/lab.html",
    "/league-intel": "/league-intel.html",
    "/screener": "/lab.html",
    "/screener.html": "/lab.html",
    "/terminal": "/league-intel.html",
    "/terminal.html": "/league-intel.html",
    "/mission": "/index.html",
    "/mission.html": "/index.html",
    "/modules": "/index.html",
    "/modules.html": "/index.html",
    "/pricing": "/index.html",
    "/pricing.html": "/index.html",
    "/roadmap": "/index.html",
    "/roadmap.html": "/index.html",
}
SYNC_STATE_LOCK = threading.Lock()
SYNC_THREAD = None
SYNC_STATE = {
    "running": False,
    "season": None,
    "last_started_at": None,
    "last_finished_at": None,
    "last_summary": None,
    "last_error": None,
}


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


def start_background_sync(season):
    global SYNC_THREAD
    with SYNC_STATE_LOCK:
        if SYNC_STATE["running"]:
            return False
        SYNC_STATE["running"] = True
        SYNC_STATE["season"] = int(season)
        SYNC_STATE["last_started_at"] = live_data.utc_now_iso()
        SYNC_STATE["last_error"] = None

    def _runner():
        try:
            summary = run_sync_task(season=season)
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
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed, method="GET")
            return
        redirect_target = LEGACY_REDIRECTS.get(parsed.path)
        if redirect_target:
            self.redirect_to(redirect_target, parsed.query)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_error(405, "Method Not Allowed")
            return
        redirect_target = LEGACY_REDIRECTS.get(parsed.path)
        if redirect_target:
            self.redirect_to(redirect_target, parsed.query)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_HEAD()

    def do_POST(self):  # noqa: N802
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
                    if should_async_admin_sync(query):
                        started = start_background_sync(season=season)
                        payload = {
                            "ok": True,
                            "queued": started,
                            "status": sync_snapshot(),
                        }
                        if not started:
                            payload["note"] = "A sync job is already running."
                        self.send_json(202, payload)
                        return

                    summary = live_data.run_full_sync(connection, season=season, include_nflverse=True)
                    with SYNC_STATE_LOCK:
                        SYNC_STATE["last_summary"] = summary
                        SYNC_STATE["last_error"] = None
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
        super().end_headers()

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


def run_sync_task(season=None):
    with live_data.get_connection() as connection:
        summary = live_data.run_full_sync(connection, season=season, include_nflverse=True)
    print(
        "Background sync complete: "
        f"players={summary.get('players_upserted', 0)} "
        f"stats={summary.get('stats_rows_upserted', 0)} "
        f"metrics={summary.get('metrics_rows_upserted', 0)}"
    )
    return summary


def main():
    args = parse_args()
    sync_on_start_env = env_is_truthy("FDL_AUTO_SYNC_ON_START", default=False)
    sync_blocking_env = env_is_truthy("FDL_SYNC_BLOCKING", default=False)
    season_env = os.getenv("FDL_SYNC_SEASON")
    sync_season = int(season_env) if season_env and str(season_env).isdigit() else args.season

    with live_data.get_connection() as connection:
        live_data.initialize_database(connection)
        if args.sync_on_start and not sync_on_start_env:
            summary = live_data.run_full_sync(connection, season=args.season, include_nflverse=True)
            print(f"Initial sync complete: players={summary['players_upserted']} stats={summary['stats_rows_upserted']}")

    handler = partial(TerminalRequestHandler)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving Fourth Down Labs terminal on http://{args.host}:{args.port}")

    if sync_on_start_env:
        if sync_blocking_env:
            print("Running startup sync in blocking mode...")
            run_sync_task(season=sync_season)
        else:
            print("Starting background startup sync thread...")
            thread = threading.Thread(target=run_sync_task, kwargs={"season": sync_season}, daemon=True)
            thread.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
