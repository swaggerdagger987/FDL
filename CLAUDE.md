# Fourth Down Labs Coding Guide

This file documents project structure and implementation standards for AI-assisted development.

## Product Modules

1. Trade Analyzer
2. Sleeper League Sync
3. Adversarial Intelligence (multi-season manager profiling)
4. Live Player Screener

## Data Contracts

- Internal player IDs use kebab-case names (example: `breece-hall`).
- Sleeper user IDs and league IDs are stored as strings.
- Sleeper transaction ingestion treats only completed transactions as analyzable records.

## Core Files

- `/Users/sohammehta/Documents/New project/index.html`
- `/Users/sohammehta/Documents/New project/terminal.html`
- `/Users/sohammehta/Documents/New project/screener.html`
- `/Users/sohammehta/Documents/New project/styles.css`
- `/Users/sohammehta/Documents/New project/app.js`
- `/Users/sohammehta/Documents/New project/screener.js`
- `/Users/sohammehta/Documents/New project/data.js`
- `/Users/sohammehta/Documents/New project/terminal_server.py`
- `/Users/sohammehta/Documents/New project/live_data.py`

## Frontend Rules

- Keep the app dependency-free and browser-runnable from the local terminal server.
- Use `state` object as single source of truth.
- Keep UI render functions pure where possible.
- Use explicit loading/error statuses for every async flow.

## Backend Rules

- Use SQLite as the local source of truth (`data/terminal.db`).
- Keep API endpoints in `terminal_server.py` thin and delegate data logic to `live_data.py`.
- Prefer idempotent sync operations (`upsert` semantics).
- Keep endpoints stable:
  - `/api/health`
  - `/api/players`
  - `/api/screener`
  - `/api/players/{id}`
  - `/api/admin/sync`

## Sleeper Integration Rules

- Base URL: `https://api.sleeper.app/v1`
- Supported pull flows:
  - `username -> user -> leagues`
  - `league -> rosters + users`
  - `league -> transactions by week`
  - `league history -> previous_league_id recursion`
- Cache `/players/nfl` in-memory in runtime.
- For stats, gracefully handle endpoint instability and preserve partial syncs.

## Intelligence Rules

- Aggregate per-manager metrics:
  - FAAB bid count/sum/max
  - Trade participation
  - Draft pick movement
  - Add/drop volume and positional bias
- Output human-readable targeting cues for each manager profile.

## Safety and Scope

- Do not add paid API dependencies in this static MVP.
- Do not remove sample-league fallback behavior.
- Preserve mobile responsiveness.
