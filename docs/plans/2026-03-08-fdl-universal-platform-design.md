# FDL Universal Platform Design

## Vision

Fourth Down Labs is a fantasy football Bloomberg terminal. Free data terminal that builds trust and brand through Reddit power users. Monetized through league-contextualized AI agent intelligence at $240/year.

**Business model**: Lifestyle business. Target 10k paying users at peak = $2.4M ARR. No VC. Grown organically through Reddit.

---

## Section 1: Product Architecture

FDL has three layers:

1. **The Terminal (Free)** — The Lab screener with full nflverse stat depth (100+ columns), custom formula builder, formula store, saved/shareable views with watermarked export, and generic agent queries. Monetized with Google AdSense.

2. **The Connection (Free, Sleeper-linked)** — Connect Sleeper username to see leagues, rosters, and basic league structure in League Intel. This is the conversion funnel — once users see their data in FDL, they want intelligence on top of it.

3. **The War Room (Paid, $240/year)** — Six agents operating with full league context and multi-season memory. Personalized briefings, trade strategies against specific leaguemates, championship probability for your roster, injury impact on your lineup. Sleeper username tied to FDL account — no free trial abuse.

**Pages:**
- `home.html` — Landing with live anonymized War Room demo (50-60 pre-built permutations)
- `lab.html` — The Bloomberg terminal (screener, formulas, visualizations)
- `league-intel.html` — League context view (free: roster overview, paid: full intel)
- `agents.html` — The War Room (free: generic, paid: league-contextualized)

---

## Section 2: The Lab — Bloomberg Terminal

### Data Layer
- Full nflverse stat catalog (100+ columns): box score stats, snap counts, target share, air yards, EPA, CPOE, pressure rate, time to throw, separation, route participation, man/zone splits, rushing yards before/after contact, red zone usage, etc.
- Adapter pattern for source swapping (nflverse -> NFLPA). Swapping = writing a new adapter, no other code changes.
- Multi-season career data stored.

### Core Screener
- Every stat is a filterable, sortable column.
- Advanced threshold filtering across any metric combination (e.g., "snap % > 60 AND target share > 20% AND air yards per target > 8").
- Relevance tier toggle (fantasy-relevant vs. full universe).

### Custom Formula Builder
- Users define weighted composite scores from any available stat columns.
- Simple UI: pick stats, assign percentage weights, name the formula.
- Example: "My WR Score = 30% PPR pts + 20% receptions + 40% snap % + 10% targets"
- Formulas become sortable/filterable columns just like any other stat.
- Saved per user, shareable via URL.

### Formula Store
- Users submit formulas to a public marketplace (free by default).
- Buyers see the blended score as a usable column — formula weights stay hidden (creator's IP protected).
- Optional paid listings possible in the future (FDL takes 15-20%).
- Ratings/reviews so the best formulas rise to the top.
- Creators share their store listings on Reddit — growth channel.

### Visualizations
- **Radar charts** (pentagon/hexagon) — pick 5-6 stats, see a player's "shape" at a glance. Compare two players by overlaying their radar charts.
- **Scatter plots** — any stat vs. any stat, clickable player dots.
- **Heat maps** — positional comparisons across metrics.
- **Trend charts** — stat trajectories over weeks/seasons.
- **Comparison mode** — side-by-side player profiles with stat overlays and radar charts.

### Sharing & Growth Engine
- Saved views encoded in shareable URLs (click link -> see exact same filters/columns/sort/formula).
- One-click image export with FDL watermark (bottom-right, always visible in Lab UI).
- Dedicated "Share to Reddit" button — formats image cleanly for Reddit posts.
- Manual screenshots also carry watermark naturally.

---

## Section 3: League Intel & The War Room (Paid Tier)

### Free (Sleeper connected)
- See your leagues, rosters, standings.
- Basic roster overview: bye weeks, position depth, roster construction.

### Paid — League Intel
- The Elephant builds full behavioral history of every manager across all available seasons.
- The Fox generates profiles: who panics, who hoards, who overpays in FAAB, who sells late.
- Trade deadline pressure maps — which managers are desperate and when.
- League economy trends over time.

### Paid — The War Room (agents.html)
- All six agents operate with full context: your roster, league scoring, rivals' rosters, multi-season history.
- **Hootsworth** delivers prioritized daily/weekly briefings.
- **Dr. Dolphin** flags injury risks contextualized to YOUR lineup impact.
- **Hawkeye** scouts waiver targets based on what YOUR roster needs.
- **The Fox** builds trade proposals targeting specific leaguemates based on behavioral profiles.
- **The Octopus** models YOUR championship probability and recommends optimal path.
- **The Elephant** catches historical patterns in your league.
- Agents reference each other — Hootsworth synthesizes and resolves conflicts.

### Home Page — War Room Demo
- 50-60 pre-built anonymized War Room permutations.
- Agents visibly working but content redacted (???, !!!, ...).
- Rotates on each visit.
- CTA: "This is a real manager's War Room. Connect Sleeper to get yours."

---

## Section 4: Growth Strategy & Reddit Funnel

### Organic Reddit Loop
- Target subreddits: r/fantasyfootball, r/DynastyFF, r/FantasyFootballers, r/SleeperApp
- Every Lab screenshot carries FDL watermark — free advertising from power users.
- Shareable URLs let anyone click through to the exact view posted about.
- Formula store creates community content and discussion threads.

### Conversion Funnel
1. Reddit user sees screenshot/link -> clicks through to Lab.
2. Lab is genuinely powerful for free -> user builds views, creates formulas.
3. User connects Sleeper -> sees their leagues, no friction.
4. User sees War Room demo on home page -> curiosity builds.
5. User hits a decision point -> generic agent answer is fine, but league-contextualized answer is clearly better -> converts to $240/year.

### Retention
- The Elephant's memory gets more valuable every season — switching cost increases over time.
- Saved formulas, saved views, agent history — all tied to account.
- Weekly Hootsworth briefings become habit-forming.

### Revenue Streams
1. **Primary**: Subscriptions — $240/year ($20/month), target 10k users = $2.4M ARR.
2. **Secondary**: Google AdSense on free pages — covers server costs.
3. **Tertiary**: Formula store paid listings (optional future).

---

## Section 5: Technical Architecture

### Data Layer (Adapter Pattern)
```
live_data.py (serving layer - reads from SQLite only)
    ^
adapters/
    nflverse_adapter.py  -> normalizes nflverse CSVs into common schema
    sleeper_adapter.py   -> pulls leagues/rosters/transactions
    [future] nflpa_adapter.py -> drop-in replacement for nflverse
    |
data/terminal.db (SQLite - single source of truth)
```
- Common schema: every stat from every source lands in the same table structure.
- Adapters handle fetching, cleaning, and normalizing.
- Swap a data source = write a new adapter, no other code changes.

### Auth & Payments
- Standard email/password registration (FDL account).
- Sleeper username linked during onboarding (verified via Sleeper API).
- JWT session tokens.
- Stripe subscription tied to FDL account.
- One Sleeper username per FDL account (prevents sharing).

### Frontend
- No framework. HTML/JS/CSS stays dependency-free and browser-runnable.
- Formula builder UI: stat dropdowns + weight sliders + name field.
- Charting: Canvas API or lightweight lib (Chart.js) for radar/scatter/heat/trend charts.
- Watermark: CSS-positioned fixed element in bottom-right of Lab, baked into image exports.
- Image export: HTML Canvas rendering of current view for "Share to Reddit."

### Database Schema Additions
- `users` — email, password hash, Sleeper username, created_at
- `user_formulas` — formula name, stat weights (JSON), creator, public/private flag
- `formula_store` — published formulas with ratings, download count
- `subscriptions` — user_id, plan, status, Stripe ID, expiry
- `agent_memory` — per-league, per-manager behavioral data across seasons
- `briefings` — cached Hootsworth outputs per user per week

### Infrastructure
- Render for hosting (already configured).
- SQLite — sufficient for 10k users at this scale.
- Background sync jobs for nflverse data pulls and league history ingestion.

---

## Section 6: Agent Technical Design

### How Agents Work
- Agent personas (`agent-personas/*.md`) serve as system prompts.
- **Free mode**: Agent receives user question + generic player data from SQLite. No league context.
- **Paid mode**: Agent receives user question + player data + full league context (roster, rivals, scoring, multi-season history, behavioral profiles).

### Agent Roster
1. **Dr. Dolphin** (Medical Analyst) — Injury intelligence, recovery timelines, return-to-play projections.
2. **Hawkeye** (Scout) — Player evaluation, usage trends, breakout detection, waiver recommendations.
3. **Hootsworth** (Chief of Staff) — Orchestrator, triages all agent outputs, daily briefings, routes questions.
4. **The Elephant** (Historian) — League memory, multi-season patterns, trade precedents, draft ROI.
5. **The Fox** (Diplomat) — Adversarial intel, trade negotiation strategy, FAAB bid modeling, leaguemate profiling.
6. **The Octopus** (Quant) — Valuations, projection models, championship probability, optimal path calculations.

### Agent Orchestration (Hootsworth as Router)
1. User asks a question or triggers a briefing.
2. Hootsworth parses intent -> routes to relevant specialist(s).
3. Specialists return structured JSON responses (mandatory sections enforced per persona).
4. Hootsworth synthesizes, resolves conflicts, assigns urgency tiers.
5. Final output rendered in the War Room UI.

### The Elephant's Memory Engine
- On Sleeper connection (paid), recursively pulls league history via `previous_league_id`.
- Builds per-manager behavioral profiles stored in `agent_memory`:
  - FAAB patterns (average bid, max bid, positional bias, timing)
  - Trade tendencies (who initiates, acceptance rate, buy/sell windows)
  - Draft patterns (positional preferences by round, historical ROI)
  - Panic indicators (correlation between losses and roster moves)
- Profiles update automatically on sync. More seasons = richer profiles = higher switching cost.

### War Room Demo (Home Page)
- 50-60 pre-built JSON scripts in `war-room-demos/` directory.
- Each script: sequence of agent textbox states (agent name -> display string like "???" or "!!!").
- Frontend picks random script on each load. No LLM calls — pure pre-rendered animation.

### LLM Cost Management
- Agents run on Claude API.
- Free generic queries: rate-limited (e.g., 5/day per IP).
- Paid contextual queries: higher limits, priority.
- Hootsworth weekly briefings: batch-generated during off-peak, cached in `briefings` table.

---

## Section 7: Format Coverage

FDL doesn't need format toggles. The data is universal. The formulas let users customize for their format. The agents adapt based on the user's actual league settings. The tool serves everyone because it's flexible, not because it has separate modes.

**Redraft**: Weekly stat windows, Hawkeye waiver recs, Dr. Dolphin weekly injury reads, Hootsworth game-day briefings, formulas tuned to "this week."

**Dynasty**: Multi-season data, The Elephant's full league history, The Octopus's dynasty values and pick valuations, The Fox's long-term positioning, radar charts showing player arcs over years.

**Keeper**: The Octopus values keeper cost vs. projected return, Hawkeye identifies breakout keepers at late-round cost, The Elephant tracks keeper performance history in your league.

**Best Ball**: Boom/bust profile filters, floor vs. ceiling scatter plots, formulas weighted toward upside (air yards, deep targets, TD rate).

**DFS (future)**: Ownership projection data if source available, correlation stacking via scatter plots, value formulas (projected points per salary dollar).

**IDP (future)**: nflverse defensive stats (tackles, sacks, pressures, coverage snaps) exposed as filterable columns. Agents evaluate IDP players same as offensive. No special mode needed.

---

## The Fantasy Manager's Problem Loop

Every format cycles through the same core problems. The six agents form a closed loop:

1. **"Is this player healthy?"** -> Dr. Dolphin
2. **"Who's emerging that I'm not seeing?"** -> Hawkeye
3. **"What is this player worth in MY league?"** -> The Octopus
4. **"Who should I target, and how?"** -> The Fox
5. **"Haven't I seen this before?"** -> The Elephant
6. **"Just tell me what to do right now."** -> Hootsworth
