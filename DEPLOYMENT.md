# Deployment Guide (Free-First)

This repo is set up for one-click Render deploys using `/Users/sohammehta/Documents/New project/render.yaml`.

## What You Can Do for Free

As of February 12, 2026:

- Render supports free web services (with idle spin-down and cold starts): [Render Pricing](https://render.com/pricing)
- Railway does **not** have a $0 always-free production tier (starts at $5/month usage): [Railway Pricing](https://railway.com/pricing)
- Koyeb has a free tier with monthly limits: [Koyeb Serverless Pricing](https://www.koyeb.com/pricing/serverless)

## Recommended: Render (Fastest Path)

### 1) Push this project to GitHub

From `/Users/sohammehta/Documents/New project`:

```bash
git init
git add .
git commit -m "Initial deploy setup"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

### 2) Create Render web service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click `New +` -> `Blueprint`
3. Select your repo
4. Render will detect `render.yaml`
5. Click `Apply`

It will deploy with:

- Start command: `python3 terminal_server.py --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`
- Auto-sync env enabled:
  - `FDL_AUTO_SYNC_ON_START=1`
  - `FDL_SYNC_BLOCKING=0`

## Update + Re-Publish Flow

Every update:

```bash
git add .
git commit -m "Describe update"
git push
```

Render auto-redeploys from `main`.

## Important Data Caveat

This app currently uses local SQLite (`data/terminal.db`). On most free cloud services, local disk is not durable across restarts/redeploys.

Mitigation already configured:

- Startup background sync runs automatically and repopulates data.

If you want durable data + fast restarts, next step is migrating storage to a managed database.
