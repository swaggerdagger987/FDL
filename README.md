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
