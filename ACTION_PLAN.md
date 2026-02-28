# FDL Scalability & Reliability Action Plan

This document is the engineering action plan derived from a full codebase audit. Each item describes the exact problem, where it lives, why it's dangerous, and precisely what to do about it.

---

## Phase 1: Critical — Server Will Break Under Load

### 1.1 In-Memory Sleeper Player Cache Bottleneck

**Files:** `live_data.py:247-359`

**The problem:** Every call to `/api/sleeper/players/by-ids` (used by the trade analyzer, league intel, and roster sync) calls `fetch_sleeper_players_cached()`. That function reads `data/cache/sleeper_players_nfl.json` from disk (~40-60MB), parses the entire JSON into a Python dict of ~10,000 player objects, and returns the whole thing — even if the caller only needs 30 players. This happens under a global `threading.Lock` (`SLEEPER_CACHE_LOCK`), so every concurrent request serializes behind one giant file parse.

**Why it's dangerous:** On Render's free tier (512MB RAM), parsing 40-60MB of JSON allocates 150-200MB of Python objects (dicts have high overhead). Two concurrent requests = 300-400MB. Three = OOM kill. Even on larger instances, the lock serialization means request latency spikes to seconds while one thread holds the lock doing I/O.

**What to fix:**
- Add a module-level in-memory cache variable (`_SLEEPER_PLAYERS_CACHE: dict | None = None`) alongside a timestamp (`_SLEEPER_PLAYERS_CACHE_AT: float | None`).
- On first call, load from disk into this variable. On subsequent calls within the TTL, return the in-memory reference directly — no file I/O, no JSON parsing, no lock contention.
- The lock only needs to be held during the initial load or a TTL-triggered refresh.
- `sleeper_player_subset_by_ids()` already filters down to the requested IDs, so the full dict stays in memory once but each response is small.
- Estimated memory cost: ~150MB resident for the full cache. This is a one-time cost instead of per-request.

**Acceptance criteria:** `sleeper_player_subset_by_ids()` completes in <5ms for cache hits. No file I/O or JSON parsing on hot path. Lock is only held during cache miss/refresh.

---

### 1.2 Rate-Limit and Authenticate the LLM Proxy Endpoint

**Files:** `terminal_server.py:299-366`

**The problem:** The `/api/agents/recommend` endpoint accepts a POST with an `api_key`, `model`, `persona`, and `scenario`, then makes a synchronous HTTP call to OpenRouter (or any URL the client provides via `base_url`) with a 20-second timeout. There is:
- No authentication — anyone on the internet can call it
- No rate limiting — an attacker can fire thousands of requests
- No concurrency cap — each request holds a Python thread for up to 20 seconds
- No origin validation — `base_url` can be pointed at any URL, turning your server into an open proxy
- CORS is `*` so any website can call this endpoint via JavaScript

**Why it's dangerous:** An attacker can: (a) exhaust your thread pool with 20-second hanging requests, denying service to all other users; (b) use your server as a proxy to any HTTP endpoint; (c) if users enter their own API keys in the browser and those keys are sent through your server, you're a MITM; (d) rack up costs on whatever API key is provided.

**What to fix:**
- Add an in-memory rate limiter keyed by client IP. Use a simple token-bucket or sliding window. Limit to ~10 requests per minute per IP.
- Add a global concurrency semaphore (`threading.Semaphore(4)`) so at most 4 LLM proxy requests run simultaneously. Return 429 when the semaphore can't be acquired within 1 second.
- Lock down `base_url` to an allowlist of known LLM providers (OpenRouter, OpenAI, Anthropic). Reject arbitrary URLs.
- Remove the wildcard CORS. Replace `Access-Control-Allow-Origin: *` with a configurable allowlist defaulting to `localhost` origins. The v2 backend (`main.py:38-45`) already does this correctly — port the pattern to v1.
- Strip stack traces from error responses in production (see 1.3).

**Acceptance criteria:** `/api/agents/recommend` rejects >10 req/min per IP with 429. Max 4 concurrent LLM calls. `base_url` is validated against allowlist. CORS is locked to configured origins.

---

### 1.3 Stop Leaking Stack Traces to Clients

**Files:** `terminal_server.py:434-441`

**The problem:** The catch-all error handler in `handle_api` sends the full Python traceback to the client:
```python
self.send_json(500, {"error": str(error), "traceback": traceback.format_exc(limit=6)})
```
This leaks internal file paths (`/home/user/FDL/live_data.py`), library versions, Python version, and code structure to anyone who triggers a 500 error.

**Why it's dangerous:** Attackers use this information to identify vulnerable library versions and understand code flow for targeted attacks.

**What to fix:**
- Log the full traceback server-side with `print()` or `logging.exception()`.
- Return a generic error to the client: `{"error": "Internal server error"}`.
- Only include the traceback in the response if a debug env var is set (e.g., `FDL_DEBUG=1`).

**Acceptance criteria:** Production 500 responses contain no traceback. Debug mode still returns traces for local development.

---

### 1.4 Full-Table Window Functions During Sync

**Files:** `live_data.py:553-643` (`refresh_latest_metrics`), `live_data.py:461-471` (`player_latest_stats` view)

**The problem:** `refresh_latest_metrics()` runs during every sync and executes:
```sql
CREATE TEMP TABLE latest_metric_snapshot AS
WITH ranked AS (
  SELECT ..., ROW_NUMBER() OVER (
    PARTITION BY pwm.player_id, pwm.stat_key
    ORDER BY pwm.season DESC, pwm.week DESC, ...
  ) AS rn
  FROM player_week_metrics pwm
)
SELECT ... FROM ranked WHERE rn = 1
```
This scans the entire `player_week_metrics` table. With nflverse enabled, this table has: 18 weeks × 1,500+ players × 50+ stat keys × 2 sources = **2.7 million+ rows**. SQLite must sort all 2.7M rows to compute the window function, holding intermediate results in memory. This runs inside a transaction that also blocks all reads on the database.

Separately, `player_latest_stats` is a VIEW (not a table) that does the same ROW_NUMBER pattern over `player_week_stats` (~54,000 rows). This view is joined in every `/api/players` and every `/api/screener` query, meaning SQLite re-materializes the view on every single API request.

**Why it's dangerous:** Sync takes 30-120 seconds during which the database is locked. API requests during sync either queue or fail with "database is locked." Memory spikes to 500MB+ during the window function computation.

**What to fix:**

For `refresh_latest_metrics()`:
- Instead of scanning the full `player_week_metrics` table, maintain a `sync_state` key like `last_metric_refresh_season_week` that records the latest (season, week) pair that was already processed.
- On incremental sync, only compute the window function for rows where `(season, week) >= last_processed`. Then upsert only those results into `player_latest_metrics`.
- For a full rebuild (first sync or forced), keep the current approach but run it in smaller batches partitioned by `stat_key` ranges.

For `player_latest_stats` VIEW:
- The v2 codebase already has the fix: `player_latest_stats_current` is a real table that gets refreshed by `bootstrap_repository.refresh_latest_stats_current()`. But the v1 API still uses the VIEW.
- Update `fetch_players()` and `fetch_screener()` in `live_data.py` to join against `player_latest_stats_current` instead of `player_latest_stats`. Then drop the view.

**Acceptance criteria:** Incremental sync only processes new week data, completing in <5 seconds. API queries join a materialized table, not a view. Full sync still works but is only triggered on first run or explicit force.

---

## Phase 2: High — Severe Inefficiency

### 2.1 Sequential 18-Week Stats Fetch With No Incremental Sync

**Files:** `live_data.py:830-911` (`sync_sleeper_weekly_stats`)

**The problem:** Every sync iterates `range(1, 19)` and fetches each week from Sleeper sequentially. For each week, `fetch_sleeper_week_data()` spawns a ThreadPoolExecutor with 2 workers to race the `.app` and `.com` endpoints (15s timeout each). This is 18 sequential network round-trips. If 14 weeks have already been synced and nothing changed, we still re-fetch all 18 weeks and re-upsert all their data.

Total time for a full sync: 18 × ~1-2 seconds per week = 20-35 seconds just for Sleeper stats (best case). Worst case with timeouts: 18 × 15 seconds = 270 seconds.

**Why it's dangerous:** Users trigger sync from the UI and wait. 30+ seconds of blocking sync is unacceptable UX. During this time, the database is being written to, blocking reads.

**What to fix:**
- Track the last successfully synced week in `sync_state` (e.g., key `sleeper_stats_last_week_{season}`, value `14`).
- On sync, start fetching from `last_synced_week + 1` instead of week 1. If that week returns empty data, the season hasn't progressed — stop early.
- Optionally, always re-fetch the last 2 synced weeks (in case of stat corrections) but skip weeks 1 through `last_synced - 2`.
- Parallelize the remaining week fetches using `ThreadPoolExecutor` across weeks (not just across endpoints for a single week). Fetch 4-6 weeks concurrently.

**Acceptance criteria:** Mid-season incremental sync fetches only 2-4 weeks instead of 18. Total sync time for an incremental update is <8 seconds.

---

### 2.2 N-Join Screener Query Explosion

**Files:** `live_data.py:1380-1547` (`fetch_screener_query` in v1), `src/backend/db/repositories/screener_repository.py` (v2)

**The problem (v1):** Each user filter in the screener adds a `JOIN player_latest_metrics mfN ON ...` to the query. With the maximum 24 filters, the query has 24 self-joins on the same million-row table. Then it does another `LEFT JOIN player_latest_metrics mv ON mv.stat_key IN (...)` with up to 80 metric keys, producing a Cartesian expansion (each player row is multiplied by each matching metric key).

**The v2 repository already partially fixes this** by using `EXISTS` subqueries instead of JOINs for filters, and by doing a separate follow-up query for metric values after the main player query completes. This is the right pattern.

**What remains wrong in v1:** The v1 `fetch_screener_query()` is still the active code path for the live site. It still uses N JOINs.

**What to fix:**
- Port the v2 screener repository pattern into the v1 `live_data.py:fetch_screener_query()`:
  - Replace `JOIN player_latest_metrics mfN` with `EXISTS (SELECT 1 FROM player_latest_metrics WHERE ...)` subqueries.
  - After the main player query returns its result set (max 200 rows), do a second query: `SELECT player_id, stat_key, stat_value FROM player_latest_metrics WHERE player_id IN (...) AND stat_key IN (...)` to load metric columns.
  - This turns an O(players × filters × columns) join into O(players) + O(results × columns), which is dramatically faster.
- Add a composite index `(player_id, stat_key, stat_value)` on `player_latest_metrics` if it doesn't exist (v2 bootstrap already adds `idx_plm_key_player_value` but the column order is `stat_key, player_id, stat_value` — add `(player_id, stat_key, stat_value)` too for the follow-up query).

**Acceptance criteria:** Screener query with 10+ filters returns in <500ms. No self-joins in the generated SQL.

---

### 2.3 Frontend 18-Request Sleeper Barrage

**Files:** `intel_engine.js:73-108` (`fetchAllTransactionsForLeague`)

**The problem:** `fetchAllTransactionsForLeague()` fires 18 `Promise.all` requests simultaneously (one per regular-season week) to Sleeper's API. If the user sets lookback=4, `fetchLeagueSeasonData()` calls this for each of 4 seasons — that's 4 leagues × (18 weeks of transactions + 1 roster + 1 users) = **80 concurrent HTTP requests** to Sleeper's free API with zero concurrency control.

**Why it's dangerous:** Sleeper will rate-limit or ban the user's IP. Requests start failing silently (the code catches errors and returns `[]`), producing incomplete intel reports that look correct but are missing data. The user has no way to know their report is based on partial data.

**What to fix:**
- Add a concurrency limiter. Create a simple semaphore utility:
  ```javascript
  function createSemaphore(max) {
    let active = 0;
    const queue = [];
    return async function acquire(fn) {
      if (active >= max) await new Promise(r => queue.push(r));
      active++;
      try { return await fn(); } finally { active--; if (queue.length) queue.shift()(); }
    };
  }
  ```
- Wrap all `fetchSleeperJSON` calls through a shared semaphore with max concurrency of 5.
- Add a failed-request counter. If more than 3 requests fail in a single intel build, surface a warning to the user: "Some transaction data may be missing due to API rate limits."
- Add a 100ms delay between batches of requests to stay well under Sleeper's rate limit.

**Acceptance criteria:** Maximum 5 concurrent Sleeper API requests at any time. User sees a warning if requests fail. Intel reports note when data is partial.

---

### 2.4 Catalog Warm-Up Fires on Every Page Load

**Files:** `app.js:116-131` (`initialize`), `app.js:723-758` (`loadCatalogFromDatabase`)

**The problem:** On every page load, `initialize()` calls `loadCatalogFromDatabase()` which fetches `/api/players?limit=350&sort=points_desc`. Even though `hydrateCatalogFromCache()` runs first, `loadCatalogFromDatabase()` always fires the network request unless the cache status is exactly `"fresh"` (within 6 hours). On a stale cache, the function fires the request, processes 350 player rows, upserts each into the catalog, rebuilds all indexes, then persists to localStorage — all blocking the main thread during page initialization.

**Why it's dangerous:** 350 player rows is ~100KB of JSON. On slow connections, this delays page interactivity by 1-3 seconds. The `rebuildCatalogIndexes()` call at the end iterates the full catalog array twice (once for `Object.fromEntries`, once for `buildPlayerNameIndex`). This is wasted work on every single page load.

**What to fix:**
- Separate the cache hydration (synchronous, fast) from the network refresh (async, background).
- On page load: hydrate from localStorage immediately, render the UI. If cache is stale, fire the network request in the background without blocking interaction.
- Debounce `rebuildCatalogIndexes()` — don't call it after every single `upsertCatalogPlayer`. Instead, batch all upserts from the API response, then rebuild once at the end. (The code at `app.js:741-752` already batches correctly by tracking an `added` counter, but `refreshRemoteSuggestions` at line `269-280` calls `rebuildCatalogIndexes()` on every keystroke that returns results.)
- Set the cache TTL to a shorter window (1 hour instead of 6) so the background refresh is less frequent but the data is fresher.

**Acceptance criteria:** Page is interactive within 200ms of DOM ready. Network catalog fetch is non-blocking. Index rebuilds happen at most once per fetch cycle.

---

## Phase 3: Medium — Security & Architecture Debt

### 3.1 Add Basic Auth to Admin Endpoints

**Files:** `terminal_server.py:402-431` (`/api/admin/sync`), `terminal_server.py:234-241` (`/api/admin/sync/status`)

**The problem:** The `/api/admin/sync` endpoint triggers a full database sync (20-120 seconds of heavy work). The `/api/admin/sync/status` endpoint exposes internal sync state. Both are accessible to anyone with no authentication. A bot or attacker can trigger continuous syncs, keeping the database locked permanently.

**What to fix:**
- Add a simple shared-secret auth check for admin endpoints. Read `FDL_ADMIN_SECRET` from environment.
- Require an `Authorization: Bearer <secret>` header or `?token=<secret>` query parameter on all `/api/admin/*` routes.
- If the secret is not configured (local dev), allow unauthenticated access with a console warning.
- The v2 endpoints (`/api/v2/sync/jobs`) should get the same treatment.

**Acceptance criteria:** `/api/admin/sync` returns 401 without a valid token. Local dev works without configuration.

---

### 3.2 Consolidate V1 and V2 Database Access

**Files:** `live_data.py:362-366` (raw sqlite3), `src/backend/db/engine.py` (SQLAlchemy), `src/backend/services/sync_service.py:82-83` (mixing both)

**The problem:** Two independent database access layers exist:
- **V1:** `live_data.get_connection()` returns a raw `sqlite3.Connection` with `row_factory = sqlite3.Row`. Every call creates a new connection (no pooling). Schema managed by `CREATE TABLE IF NOT EXISTS`.
- **V2:** `src/backend/db/engine.py` creates a SQLAlchemy engine with `check_same_thread=False` and connection pooling. Schema managed by Alembic migrations.

Both point at the same SQLite file. `SyncService._run_job()` calls `live_data.get_connection()` (v1) to run the sync, then calls `db_transaction()` (v2 SQLAlchemy) to update the sync job status. This means two different connection objects are hitting the same database file simultaneously — one from sqlite3, one from SQLAlchemy's pool. SQLite's WAL mode allows concurrent reads but only one writer. If both connections try to write at overlapping times, you get `database is locked` errors.

**What to fix:**
- This is a phased migration. Don't try to rewrite everything at once.
- **Immediate:** Add connection pooling to v1. Replace `live_data.get_connection()` with a module-level connection pool (a simple `queue.Queue` of pre-created connections with a max size of 4). Connections are checked out, used, and returned.
- **Immediate:** In `SyncService._run_job()`, use the same connection for both the sync and the job status update. Pass the connection through instead of opening separate ones.
- **Later:** Migrate v1 query functions one at a time into the v2 repository layer. Start with `fetch_players` and `fetch_screener` since v2 versions already exist. Update v1 API routes to call v2 repositories.
- **Later:** Once all v1 queries are ported, remove `live_data.get_connection()` entirely.

**Acceptance criteria (immediate):** Connection pooling with max 4 connections. No `database is locked` errors under concurrent load. Sync jobs use a single connection path.

---

### 3.3 CORS Lockdown on V1 Server

**Files:** `terminal_server.py:443-453`

**The problem:** Every response sets `Access-Control-Allow-Origin: *`. This means any website on the internet can make JavaScript requests to the API, including the LLM proxy and admin sync endpoints.

**What to fix:**
- Read allowed origins from `FDL_CORS_ORIGINS` env var (default: `http://localhost:8000,http://localhost:5173`).
- In `end_headers()`, check the `Origin` request header against the allowlist. Only echo back the origin if it matches. Otherwise, omit the CORS header entirely.
- The v2 backend already does this correctly via FastAPI's `CORSMiddleware` with `settings.cors_allow_origins`.

**Acceptance criteria:** Only configured origins get CORS headers. Requests from unknown origins are rejected by browser CORS policy.

---

### 3.4 Fix Deprecated `datetime.utcnow()` Usage

**Files:** `live_data.py:91-97`

**The problem:** `datetime.utcnow()` is deprecated since Python 3.12. It returns a naive datetime (no timezone info), which can cause subtle bugs when comparing with timezone-aware datetimes from other sources.

**What to fix:**
- Replace all `dt.datetime.utcnow()` calls with `dt.datetime.now(dt.timezone.utc)`.
- Update `utc_now_iso()` to:
  ```python
  def utc_now_iso():
      return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
  ```
- Update `current_nfl_season()` similarly.
- Grep for any other `utcnow()` calls across the codebase and fix them.

**Acceptance criteria:** Zero uses of `datetime.utcnow()` in the codebase. All timestamps are timezone-aware.

---

### 3.5 Silent JSON Parse Failures on POST Bodies

**Files:** `terminal_server.py:476-492`

**The problem:** `read_json_body()` catches `json.JSONDecodeError` and silently returns `{}`. This means if a client sends malformed JSON to `/api/agents/recommend`, the handler proceeds with an empty body, hits the `if not api_key` check, and returns 400 — but the error message says "api_key is required" instead of "invalid JSON body." For other endpoints like `/api/screener/query`, the empty body results in a default query being executed (all players, no filters), which is a silent wrong result.

**What to fix:**
- When `Content-Type` is `application/json` and the body fails to parse, return 400 immediately with `{"error": "Invalid JSON body"}`.
- Only return `{}` when the body is legitimately empty (no Content-Length or Content-Length: 0).

**Acceptance criteria:** Malformed JSON POST bodies return 400 with a clear error message. Empty bodies still work for GET-style POST endpoints.

---

### 3.6 API Key Storage in localStorage

**Files:** `agents.js:3` (`AGENT_CONFIG_STORAGE_KEY`)

**The problem:** Users enter their OpenRouter API keys in the Agents UI. These keys are stored in `localStorage` as plaintext JSON. Any XSS vulnerability (now or in the future) would allow an attacker to exfiltrate all stored API keys. While the codebase currently uses `escapeHtml()` consistently, a single missed spot in a future PR creates a key-stealing XSS.

**What to fix:**
- **Immediate (low effort):** Add a prominent UI warning: "Your API key is stored locally in your browser and sent directly to the LLM provider. It is never stored on our servers."
- **Immediate:** Set `SameSite=Strict` on any cookies. Add `Content-Security-Policy` headers to prevent inline script injection.
- **Later:** Move the LLM proxy to use server-side API key management. Users configure their key once via the admin UI, it's stored server-side (encrypted at rest), and the frontend never sees it. This eliminates the client-side storage risk entirely.

**Acceptance criteria (immediate):** User sees a clear warning about key storage. CSP headers prevent inline script execution.

---

## Phase 4: Low — Code Quality & Future-Proofing

### 4.1 Add V1 Schema Migration Support

**Files:** `live_data.py:369-474` (`initialize_database`)

**The problem:** The v1 schema is managed entirely by `CREATE TABLE IF NOT EXISTS` statements. There is no way to alter an existing table — no migration system, no version tracking. If you need to add a column to `player_week_stats`, you must either: (a) add it with `ALTER TABLE` manually, (b) drop and recreate the table (losing all data), or (c) add a conditional `ALTER TABLE` that catches the "column already exists" error. The code already calls `initialize_database()` on every request (via `fetch_players`, `fetch_screener`, etc.), which is wasteful for a schema that never changes at runtime.

**What to fix:**
- Add a `schema_version` key to the `sync_state` table.
- On startup (once, not per-request), check the current schema version. If it's behind, run the necessary `ALTER TABLE` statements in order.
- Remove the `initialize_database()` calls from `fetch_players()`, `fetch_screener()`, `fetch_filter_options()`, `fetch_player_history()`, and `fetch_health_summary()`. Only call it once in `main()` and in `run_full_sync()`.
- The v2 codebase uses Alembic for migrations — this is the right long-term approach. For v1, a simple version-check-and-migrate is sufficient.

**Acceptance criteria:** Schema changes can be applied without data loss. `initialize_database()` runs only once at startup.

---

### 4.2 Eliminate Duplicate V1/V2 Query Code

**Files:** `live_data.py:1172-1577` (v1 query functions), `src/backend/db/repositories/players_repository.py`, `src/backend/db/repositories/screener_repository.py`

**The problem:** `fetch_players`, `fetch_filter_options`, and `fetch_screener_query` each exist in two places: `live_data.py` (raw sqlite3, used by v1 API) and `src/backend/db/repositories/` (SQLAlchemy text queries, used by v2 API). Bug fixes must be applied twice. The implementations have already diverged — the v2 screener uses `EXISTS` subqueries (better) while v1 uses `JOIN` (worse).

**What to fix:**
- Make the v1 API routes call the v2 repository functions. The v2 repositories accept a SQLAlchemy `Connection` object. In `terminal_server.py`, use the SQLAlchemy engine to get a connection and pass it to the v2 repositories.
- Alternatively (simpler): have the v1 routes call the v2 FastAPI endpoints internally via `localhost`. This is more wasteful but requires zero code changes to the v1 handler.
- Best approach: refactor the v2 repositories to accept either a raw sqlite3 connection or a SQLAlchemy connection by using raw SQL strings. Then the v1 handler can call the same function with its sqlite3 connection. Since the v2 repositories already use `text()` SQL, the actual queries are plain SQL strings that work with either driver.
- Delete the duplicate functions from `live_data.py` once the v1 routes are migrated.

**Acceptance criteria:** One implementation per query function. V1 and V2 routes share the same query code.

---

### 4.3 Hardcoded Static Player Data in `data.js`

**Files:** `data.js:1-796`, `app.js:760-792` (`buildLivePlayerModel`)

**The problem:** `data.js` contains 46 hardcoded player objects with projections (`projPpr: 24.4`, `ceiling: 32.1`, etc.) that were presumably accurate at one point in time but become stale within a week of any NFL game. The live database overlay (`buildLivePlayerModel`) synthesizes projections with naive formulas:
```javascript
const ceiling = ppr * 1.35 + 2;
const floor = Math.max(ppr * 0.65 - 1, 0);
```
These are not statistical projections — they're arbitrary multipliers that produce meaningless values. A player with 20 PPR points last week gets `ceiling = 29` and `floor = 12`, regardless of position, matchup, or usage.

**What to fix:**
- **Immediate:** Add a `data_as_of` date field to the static dataset so the UI can show "Projections as of Week X, 2024" and users know the data is stale.
- **Immediate:** In `buildLivePlayerModel()`, use position-specific multipliers derived from actual historical variance ranges:
  - QB ceiling/floor: ±30% (QBs have lower variance)
  - RB ceiling/floor: ±40% (high variance)
  - WR ceiling/floor: ±45% (highest variance)
  - TE ceiling/floor: ±35%
- **Later:** Replace the static dataset entirely with database-backed projections. On first page load, if the database has player data, use it exclusively. Only fall back to the static dataset if the database is offline.
- **Later:** Compute `volatility` from actual week-to-week standard deviation in `player_week_stats` instead of using hardcoded values.

**Acceptance criteria (immediate):** UI shows when projection data is from. Position-specific variance bands. Static data is clearly marked as fallback.

---

### 4.4 innerHTML Rendering for Large Tables

**Files:** `lab.js` (entire file), `league_intel.js:299-343`, `app.js:1529-1617`

**The problem:** All UI rendering uses string concatenation + `innerHTML` assignment. The Lab screener table can show 200 rows × 10+ columns = 2,000+ cells. Every sort change, column toggle, or filter update rebuilds the entire table as an HTML string, assigns it to `innerHTML`, and forces the browser to re-parse and re-render the entire DOM subtree. This causes:
- Layout thrashing (forced reflow on every render)
- Loss of scroll position
- Janky UI during rapid interactions (typing in filter fields)

**What to fix:**
- **Immediate:** For the Lab table, switch to incremental DOM updates. Only replace rows that changed. Use `DocumentFragment` to batch DOM insertions.
- **Immediate:** For sort changes (which reorder but don't change cell content), use CSS-based reordering or swap DOM nodes instead of rebuilding innerHTML.
- **Later:** Consider a lightweight virtual scrolling approach for the 200-row table — only render the ~20 visible rows plus a buffer. This eliminates the 2,000-cell DOM entirely.
- The manager grid in `league_intel.js` (max 12 cards) and the trade analysis in `app.js` (max ~20 rows) are small enough that innerHTML is fine. Focus optimization on the Lab screener.

**Acceptance criteria:** Lab table re-renders in <50ms for sort/filter changes. Scroll position is preserved across re-renders.

---

### 4.5 Unbounded Array Spread in `collectSleeperPlayerIdsFromSeasonData`

**Files:** `intel_engine.js:129-140`

**The problem:**
```javascript
ids.push(...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || []));
```
The spread operator `...` with `push()` passes each array element as a separate function argument. V8 has a maximum argument limit (~65,536). While normal rosters won't hit this, if the Sleeper API returns unexpected data (e.g., a malformed response with a huge array), this will throw a `RangeError: Maximum call stack size exceeded`.

**What to fix:**
- Replace spread-push with concat or a loop:
  ```javascript
  for (const list of [roster.players, roster.reserve, roster.taxi]) {
    if (Array.isArray(list)) ids.push(...list.slice(0, 200));
  }
  ```
- Or use `Array.prototype.concat`:
  ```javascript
  ids = ids.concat(roster.players || [], roster.reserve || [], roster.taxi || []);
  ```
- Add a defensive size cap (e.g., 200 per roster list) to guard against malformed API responses.

**Acceptance criteria:** No spread-push on potentially unbounded arrays. Defensive caps on array sizes from external data.

---

### 4.6 Sleeper Cache File Write Durability

**Files:** `live_data.py:266-275` (`save_sleeper_players_cache`)

**The problem:** The cache file is written via temp file + atomic rename, which is good. But the temp file is not `fsync()`'d before the rename. On power loss or OS crash between the write and the filesystem flush, the renamed file could be empty or partially written.

**What to fix:**
```python
def save_sleeper_players_cache(players, fetched_at=None):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = fetched_at or utc_now_iso()
    document = {"fetched_at": timestamp, "players": players}
    temp_path = SLEEPER_PLAYERS_CACHE_PATH.with_suffix(".json.tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(document, f)
        f.flush()
        os.fsync(f.fileno())
    temp_path.replace(SLEEPER_PLAYERS_CACHE_PATH)
```

**Acceptance criteria:** Cache file writes are durable. Power loss cannot produce a corrupt cache.

---

## Implementation Order

| Week | Items | Effort | Impact |
|------|-------|--------|--------|
| 1 | 1.1 (memory cache), 1.3 (stack traces), 3.4 (utcnow), 3.5 (JSON parse) | Small | Eliminates OOM and info leaks |
| 1 | 1.2 (rate limit + CORS), 3.1 (admin auth), 3.3 (CORS lockdown) | Medium | Closes all security holes |
| 2 | 1.4 (materialized view + incremental metrics), 2.1 (incremental sync) | Medium | Sync goes from minutes to seconds |
| 2 | 2.2 (screener query rewrite) | Medium | Screener goes from 30s to <500ms |
| 3 | 2.3 (Sleeper concurrency limit), 2.4 (catalog warm-up) | Small | Frontend stops hammering APIs |
| 3 | 3.2 (consolidate DB access) | Medium | Eliminates lock contention |
| 4 | 4.1 (schema migrations), 4.2 (dedupe code) | Medium | Maintainability |
| 4 | 4.3 (projections), 4.4 (DOM rendering), 4.5 (array safety), 4.6 (fsync) | Small | Polish and correctness |
