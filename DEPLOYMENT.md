# Deployment Guide (Render, Free-First)

This repo is configured for Render Blueprint deploys via `/Users/sohammehta/Documents/New project/render.yaml`.
For parallel v2 cutover, use `/Users/sohammehta/Documents/New project/render-v2.yaml`.

## Current Production IA

Deployed app should expose:

- `/index.html` (Home)
- `/lab.html` (The Lab)
- `/league-intel.html` (League Intel)

Legacy routes redirect to canonical pages.

## Cost Notes

Render free web services are typically free with limits (cold starts, idle spin-down, and resource caps). Verify current terms before launch:

- [Render Pricing](https://render.com/pricing)

## One-Time Setup

From `/Users/sohammehta/Documents/New project`:

```bash
git add .
git commit -m "Ship 3-page IA reset"
git push
```

In Render:

1. Open [Render Dashboard](https://dashboard.render.com/)
2. Create or open your Blueprint service
3. Confirm it uses `render.yaml`
4. Apply/sync blueprint

Configured service:

- Start command: `python3 terminal_server.py --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`
- Env vars:
  - `FDL_AUTO_SYNC_ON_START=1`
  - `FDL_SYNC_BLOCKING=0`
  - `FDL_ADMIN_SYNC_ASYNC=1`
  - `FDL_SYNC_INCLUDE_NFLVERSE=0` (faster startup sync by default)

## Publish Update Flow

For each iteration:

```bash
git add .
git commit -m "Describe update"
git push
```

Render auto-deploys from `main`.

## Post-Deploy Smoke Test

1. Check `https://<your-service>.onrender.com/api/health`
2. Open `https://<your-service>.onrender.com/`
3. Open `https://<your-service>.onrender.com/lab.html`
4. Open `https://<your-service>.onrender.com/league-intel.html`
5. Confirm redirects:
   - `/terminal.html` -> `/league-intel.html`
   - `/screener.html` -> `/lab.html`
6. In The Lab, click `Refresh Live DB` once and wait for background sync completion.

If you need the heavier Sleeper+nflverse run, trigger:

- `/api/admin/sync?season=YYYY&include_nflverse=1`

## Data Persistence Caveat

This app uses local SQLite (`data/terminal.db`). On free instances, local disk can reset during restarts/redeploys.

Mitigation already in place:

- Startup sync repopulates data automatically.
- Manual admin sync endpoint is available if needed.

For durable persistence and faster warm starts, move to managed storage in a future pass.

## Parallel V2 Deployment

The rewrite stack can be deployed in parallel as a second web service.

1. Keep the current service on `render.yaml` for legacy traffic.
2. Create a second Render web service using `render-v2.yaml`.
3. Validate:
   - `/api/v2/health`
   - `/api/v2/docs`
   - `/v2`
4. Recommended env for v2 service:
   - `FDL_V2_AUTO_SYNC_ON_START=1`
   - `FDL_V2_AUTO_SYNC_INCLUDE_NFLVERSE=0`
   - `FDL_REQUEST_BODY_LIMIT_BYTES=10485760`
   - `FDL_CORS_ALLOW_ORIGINS=https://<your-frontend-origin>`
5. After parity QA, switch traffic gradually to v2.
