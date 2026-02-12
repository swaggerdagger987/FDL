# Fourth Down Labs Terminal MVP

This project is now a multi-page fantasy football terminal with:

- Professional landing + product navigation pages
- Live terminal workflow (trade analyzer + adversarial intelligence)
- Local live-data database for **all NFL players**
- Dedicated player screener powered by the local database

## Site Pages

- `/Users/sohammehta/Documents/New project/index.html` (landing)
- `/Users/sohammehta/Documents/New project/terminal.html` (core terminal)
- `/Users/sohammehta/Documents/New project/screener.html` (all-player live screener)
- `/Users/sohammehta/Documents/New project/mission.html`
- `/Users/sohammehta/Documents/New project/modules.html`
- `/Users/sohammehta/Documents/New project/pricing.html`
- `/Users/sohammehta/Documents/New project/roadmap.html`

## Live Data + Database

Backend files:

- `/Users/sohammehta/Documents/New project/terminal_server.py`
- `/Users/sohammehta/Documents/New project/live_data.py`

Database:

- SQLite file at `/Users/sohammehta/Documents/New project/data/terminal.db`

Live sources used:

- Sleeper players endpoint (`/v1/players/nfl`)
- Sleeper weekly stats endpoints (regular season weeks)
- nflverse-data GitHub release assets for player stats (seasonal sync)

## Run

From `/Users/sohammehta/Documents/New project`:

```bash
python3 terminal_server.py --sync-on-start
```

Then open:

- [http://localhost:8000](http://localhost:8000)
- [http://localhost:8000/terminal.html](http://localhost:8000/terminal.html)
- [http://localhost:8000/screener.html](http://localhost:8000/screener.html)

Docker option:

```bash
docker build -t fdl-terminal .
docker run --rm -p 8000:8000 -e FDL_AUTO_SYNC_ON_START=1 fdl-terminal
```

## API Endpoints

- `GET /api/health`
- `GET /api/players`
- `GET /api/screener`
- `GET /api/filter-options`
- `POST /api/screener/query`
- `GET /api/players/{player_id}`
- `GET|POST /api/admin/sync?season=YYYY`

## Deploy + Re-Publish

- Deployment config: `/Users/sohammehta/Documents/New project/render.yaml`
- Full guide: `/Users/sohammehta/Documents/New project/DEPLOYMENT.md`

Free-first path:

1. Push repo to GitHub.
2. Create a Render Blueprint service from the repo.
3. Share the Render URL.
4. Re-publish by pushing new commits (`git push`), which auto-redeploys.

## Quick Validation Checklist

1. Start `terminal_server.py` with `--sync-on-start`.
2. Check `/api/health` returns player/stats counts.
3. In Terminal page:
   - verify database status shows connected
   - click `Refresh Live DB`
   - load Sleeper leagues and sync one
4. In Screener page:
   - run filters
   - confirm results show live stat columns for players.
