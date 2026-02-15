# Fourth Down Labs V1 (3-Page IA)

Fourth Down Labs is now organized around a strict product architecture:

- `/index.html` (Home)
- `/lab.html` (The Lab)
- `/league-intel.html` (League Intel + manager deep-dive state)

The primary UX is Sleeper-first and does not include trade analyzer flows in the main navigation.

## Canonical + Compatibility Routes

Canonical pages:

- `http://localhost:8000/`
- `http://localhost:8000/index.html`
- `http://localhost:8000/lab.html`
- `http://localhost:8000/league-intel.html`

Compatibility redirects:

- `/screener.html` -> `/lab.html`
- `/terminal.html` -> `/league-intel.html`
- `/mission.html` -> `/index.html`
- `/modules.html` -> `/index.html`
- `/pricing.html` -> `/index.html`
- `/roadmap.html` -> `/index.html`

## Shared State Contracts

LocalStorage keys:

- `fdl_sleeper_session_v1`
- `fdl_saved_lab_views_v2`
- `fdl_last_lab_view_v2`

Lab URL contracts:

- `?view=<base64url-json>`
- Optional debug fields: `sort=<key>:<asc|desc>`, `positions=QB,RB,...`, `league=<league_id>`

League Intel URL contract:

- `?league=<league_id>&manager=<user_id>&lookback=<1-4>`

## Run Locally

From `/Users/sohammehta/Documents/New project`:

```bash
python3 terminal_server.py --sync-on-start
```

Then open:

- [http://localhost:8000](http://localhost:8000)
- [http://localhost:8000/lab.html](http://localhost:8000/lab.html)
- [http://localhost:8000/league-intel.html](http://localhost:8000/league-intel.html)

## Data + Sync

Backend files:

- `/Users/sohammehta/Documents/New project/terminal_server.py`
- `/Users/sohammehta/Documents/New project/live_data.py`

SQLite database:

- `/Users/sohammehta/Documents/New project/data/terminal.db`

Primary sources:

- Sleeper API (`/v1/players/nfl`, leagues/users/rosters/transactions)
- nflverse data assets (via sync pipeline)

Sync default:

- `/api/admin/sync` now defaults to `include_nflverse=false` for faster warm-up.
- Use `/api/admin/sync?include_nflverse=1` for the full Sleeper+nflverse pass.

## API Endpoints

- `GET /api/health`
- `GET /api/filter-options`
- `GET /api/players`
- `GET|POST /api/sleeper/players/by-ids`
- `POST /api/screener/query`
- `GET /api/screener`
- `GET /api/players/{player_id}`
- `GET|POST /api/admin/sync?season=YYYY`
- `GET /api/admin/sync/status`

`POST /api/screener/query` supports:

- `positions[]` (and legacy `position` compatibility)
- `age_min`, `age_max`
- `columns[]`
- `filters[]`
- `sort_key`, `sort_direction`

## Deploy

- Render blueprint config: `/Users/sohammehta/Documents/New project/render.yaml`
- Full deployment notes: `/Users/sohammehta/Documents/New project/DEPLOYMENT.md`

## V2 Rewrite Track (Parallel Cutover)

A parallel v2 stack now exists for the scalability rewrite:

- Backend: FastAPI (`/api/v2/*`) in `src/backend`
- Frontend: React + Vite in `src/frontend`
- Runner: `python3 server_v2.py`

### Run v2 locally

From `/Users/sohammehta/Documents/New project`:

```bash
python3 -m pip install -r requirements.txt
npm --prefix src/frontend install
npm --prefix src/frontend run build
python3 server_v2.py
```

Then open:

- `http://127.0.0.1:8010/v2`
- `http://127.0.0.1:8010/api/v2/docs`

### v2 API namespace

- `GET /api/v2/health`
- `GET /api/v2/players`
- `GET /api/v2/screener/options`
- `POST /api/v2/screener/query`
- `POST /api/v2/sync/jobs`
- `GET /api/v2/sync/jobs/{job_id}`
- `GET /api/v2/intel/report`

### v2 Runtime Controls (Env)

- `FDL_DB_PATH`: SQLite path (shared with legacy while in parallel mode)
- `FDL_CORS_ALLOW_ORIGINS`: comma-separated allowlist
- `FDL_REQUEST_BODY_LIMIT_BYTES`: default `10485760` (10MB)
- `FDL_REQUEST_TIMEOUT_SECONDS`: default `30`
- `FDL_API_CACHE_PLAYERS_SECONDS`: default `60`
- `FDL_API_CACHE_SCREENER_OPTIONS_SECONDS`: default `300`
- `FDL_V2_AUTO_SYNC_ON_START`: set `1` to queue non-blocking warm sync on startup when DB is empty
- `FDL_V2_AUTO_SYNC_INCLUDE_NFLVERSE`: optional (`0/1`) for startup sync mode
- `FDL_V2_AUTO_SYNC_SEASON`: optional explicit season for startup sync

### Quality gates

```bash
make test
npm --prefix src/frontend run build
```

CI workflow is defined in `.github/workflows/ci.yml`.
