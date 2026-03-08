# Lab Screener Upgrade Plan

## Problem Statement
1. Not all NFL player names display (Sleeper cache misses → opaque IDs shown)
2. Too many low-relevance players clutter results (practice squad, retired, etc.)
3. No college player stats for rookie draft evaluation
4. Single-season view only — no multi-year comparison

---

## Phase 1: Fix Missing Player Names

**Root cause**: `fetch_screener_query()` joins against `players` table populated from Sleeper's `/players/nfl`. Players in `player_week_stats` (from nflverse) that don't exist in Sleeper's cache get dropped or show raw IDs.

### Changes

**`live_data.py`** — `sync_nflverse_stats()` / player ingestion:
- When ingesting nflverse CSV stats, upsert into `players` table any `player_id` + `player_display_name` + `position` not already present. This ensures every player with stats has at least a name row.
- Fallback chain: `full_name` → `player_display_name` from nflverse → `player_name` from nflverse → player_id.

**`live_data.py`** — `initialize_database()`:
- Add `IF NOT EXISTS` column `name_source TEXT` to `players` to track whether name came from Sleeper or nflverse backfill.

**Impact**: Pure backend data-completeness fix. No frontend changes. No behavior change for existing players.

---

## Phase 2: Relevance Tier Filtering (Hide Low-Caliber Players by Default)

**Goal**: By default, show only fantasy-relevant players. Let users expand to full universe via toggle or search.

### Changes

**`live_data.py`** — `fetch_screener_query()`:
- Add a `relevance` filter mode. When `relevance=fantasy` (the default), apply WHERE clause:
  - `status IN ('Active')` AND
  - Has at least 1 game with `fantasy_points_ppr > 0` in the queried season, OR
  - `years_exp <= 1` (rookies always shown)
- When `relevance=all`, no filter applied.
- When a `search` term is provided, automatically switch to `relevance=all` so users can always find anyone.

**`lab.html`**:
- Add a toggle/pill next to the position filters: **"Fantasy Relevant" | "All Players"** (default: Fantasy Relevant).

**`lab.js`**:
- Wire the new toggle to send `relevance=fantasy` or `relevance=all` query param.
- When search box has text, send `relevance=all` automatically.

**Impact**: Default view shows ~300-500 meaningful players instead of 2,000+. Search always finds everyone. Toggle lets power users see the full universe.

---

## Phase 3: Multi-Year / Multi-Season Support

**Goal**: Let users view and compare stats across multiple seasons without leaving the page.

### Changes

**`lab.html`**:
- Replace the single season `<input>` with a multi-select or range control:
  - Default: latest season
  - Options: individual years (2020–2025) as checkable pills, plus "Career" aggregate
- Add a "Per-game averages" vs "Totals" toggle for multi-season views.

**`live_data.py`** — `fetch_screener_query()`:
- Accept `seasons` parameter (comma-separated list or `career`).
- When multiple seasons selected: aggregate `player_week_stats` across those seasons.
- When `career`: aggregate all available seasons.
- Support `agg_mode=totals` (sum) or `agg_mode=per_game` (average per game played).
- Add `games_played` as a returned metric (COUNT of weeks with stats).

**`lab.js`**:
- Wire season pills to send `seasons=2023,2024` or `seasons=career`.
- Wire aggregation toggle to send `agg_mode=totals` or `agg_mode=per_game`.
- Show the selected season range in the results header.

**Impact**: Users can now evaluate players across their full career or any combination of seasons. Per-game averages normalize volume differences.

---

## Phase 4: College Player Stats (NFL/College Toggle)

**Goal**: Same Lab page gains a toggle to switch between NFL and College universes for rookie evaluation.

### Data Source
- **College Football Data API (CFBD)** — free tier, requires API key registration at collegefootballdata.com.
- Provides per-season player stats (passing, rushing, receiving) for all FBS players.
- No cost; complies with "no paid API dependencies" rule.

### Changes

**`live_data.py`** — New functions:
- `sync_college_stats(seasons=None)`: Fetch college player stats from CFBD API, store in new `college_player_stats` table.
- `fetch_college_screener(connection, query)`: Query college stats with same filter/sort pattern as NFL screener.
- New SQLite table `college_players`: `player_id, full_name, position, team (school), conference, height, weight, year (FR/SO/JR/SR)`.
- New SQLite table `college_player_stats`: `player_id, season, category, stat_key, stat_value` (same metric-value pattern as NFL).
- College stat keys: `passing_yards, passing_tds, completions, attempts, comp_pct, rushing_yards, rushing_tds, carries, ypc, receptions, receiving_yards, receiving_tds, yards_per_reception`.

**`terminal_server.py`** — New endpoint:
- `/api/screener?universe=college` — routes to `fetch_college_screener()` instead of NFL screener.
- Same query param interface (search, position, filters, sort, limit/offset).

**`lab.html`**:
- Add universe toggle at the top of Core Screen: **"NFL" | "College"** pill group (default: NFL).
- When "College" is active:
  - Season selector shows college seasons (2018–2025).
  - Position pills stay the same (QB, RB, WR, TE) minus K, plus potential EDGE/LB/DB for IDP interest later.
  - Team filter populates with college teams/conferences instead of NFL teams.
  - Stat Window simplifies to "Season" only (no weekly granularity from CFBD).

**`lab.js`**:
- Wire universe toggle to switch between `universe=nfl` and `universe=college` on API calls.
- Swap metric catalog (column options) based on universe — college has different available stats.
- Swap default columns: college shows `school, conference, class_year` instead of `team, age, years_exp`.
- Search works the same way across both universes.

**Config**:
- CFBD API key stored in environment variable `CFBD_API_KEY` (not hardcoded).
- Add to `.env.example` for documentation.

**Impact**: Users can evaluate college prospects using the same powerful screening interface. Toggle back to NFL seamlessly. Rookies can be researched before draft day.

---

## Phase 5: Sync & API Key Setup

**`terminal_server.py`**:
- Add `/api/admin/sync-college` endpoint to trigger college data sync.
- Reuse existing sync infrastructure (background thread, status tracking).

**`lab.js`**:
- "Refresh Live DB" button syncs the active universe (NFL or College).

**`live_data.py`**:
- CFBD sync fetches latest 5 seasons by default (configurable).
- Graceful handling if API key is missing — return clear error message, college toggle disabled in UI.

---

## Execution Order

1. **Phase 1** first — fixes a visible bug, small change, immediate value.
2. **Phase 2** next — improves UX dramatically, prerequisite for phases 3-4 working well at scale.
3. **Phase 3** — multi-year is useful for NFL players independent of college.
4. **Phase 4 + 5** together — college data requires both backend (data source + storage) and frontend (toggle + column swap).

## Files Modified

| File | Phases |
|------|--------|
| `live_data.py` | 1, 2, 3, 4, 5 |
| `terminal_server.py` | 2, 4, 5 |
| `lab.html` | 2, 3, 4 |
| `lab.js` | 2, 3, 4 |
| `styles.css` | 2, 3, 4 (minor — pill/toggle styling) |
| `.env.example` | 4 (new file — CFBD_API_KEY) |

## What Won't Change
- Trade Analyzer, League Intel, Agents pages — untouched.
- Sleeper integration — untouched.
- data.js fallback — remains as-is for offline/demo mode.
- Mobile responsiveness — maintained.
- Existing saved views — backward compatible.
