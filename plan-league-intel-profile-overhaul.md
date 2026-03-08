# League Intel — Manager Profile Overhaul

## Goal

Transform the League Intel detail view into social-media-style manager profiles
with win/loss records, activity feeds, head-to-head rivalry data, and
season-over-season behavioral trends.

---

## Phase 1: Matchup Data + Win/Loss Records

### Data Source (Sleeper API)

- `GET /league/{league_id}/matchups/{week}` — returns array of matchup objects
  with `roster_id`, `points`, `matchup_id` (pairs opponents)
- Roster objects already have `settings.wins`, `settings.losses`, `settings.ties`
- `GET /league/{league_id}/winners_bracket` / `losers_bracket` — playoff results

### Changes to `intel_engine.js`

**A. New function: `fetchMatchupsForLeague(leagueId, fetchSleeperJSON)`**
- Fetch matchups for weeks 1-18 in parallel (same pattern as transactions)
- Cache in localStorage with `fdl_matchup_cache_v2:{namespace}:{leagueId}` key
- Returns flat array of matchup entries with `_week` tag

**B. Update `fetchLeagueSeasonData()`**
- Add matchups to the season data object alongside users/rosters/transactions
- New field: `matchups: []`

**C. New function: `buildManagerRecords(seasonData)`**
- For each manager, compute:
  - `wins`, `losses`, `ties` (from roster settings or computed from matchups)
  - `totalPointsFor`, `totalPointsAgainst` (sum of weekly matchup points)
  - `weeklyScores: [{week, points, opponentPoints, won}]`
  - `playoffAppearances`, `championshipWins` (from bracket data if available)
  - `highScore` (best single-week points)
  - `winStreak` / `loseStreak` (current and max)

**D. Merge records into manager profile in `finalizeManagerProfile()`**

---

## Phase 2: Head-to-Head Rivalry Tracking

### Changes to `intel_engine.js`

**A. New function: `buildHeadToHeadMap(seasonData, ownerByRosterId)`**
- Parse matchups to find who played who each week (matched by `matchup_id`)
- Build per-manager map: `{ opponentUserId: { wins, losses, pointsFor, pointsAgainst } }`

**B. Add to manager profile:**
- `rivalries: [{ opponentId, opponentName, wins, losses, pointsFor, pointsAgainst }]`
- Sorted by total games played (most frequent opponent first)
- `nemesis` — opponent they lose to most
- `favorite` — opponent they beat most

---

## Phase 3: Activity Feed (All Moves)

### Changes to `intel_engine.js`

**A. New function: `buildActivityFeed(manager, seasonData, sleeperPlayersById)`**
- Collect ALL transactions for this manager (not just trades)
- Each entry:
  ```js
  {
    type: "trade" | "waiver" | "free_agent" | "add" | "drop",
    timestamp: number,
    dateLabel: "2024 W3",
    description: "Added Jahmyr Gibbs (RB, DET) via waiver ($12)",
    players: [{id, name, position, team}],  // involved players
    faabBid: number | null,
    delta: number | null  // value delta for trades
  }
  ```
- Sort by timestamp descending
- Store on manager profile as `activityFeed: []`

**B. Limit:** Store up to 50 most recent events per manager, render with
"Show more" pagination in the UI.

---

## Phase 4: Season-over-Season Trends

### Changes to `intel_engine.js`

**A. New function: `buildSeasonTrends(managerRaw, seasonData, myUserId)`**
- Instead of collapsing all seasons, compute per-season metrics:
  ```js
  {
    season: 2024,
    record: "8-5",
    tradeCount: 4,
    waiverCount: 12,
    avgFaabBid: 15.2,
    aggressionScore: 72,
    totalPointsFor: 1845.3,
    profileLabel: "Active Market Maker"
  }
  ```
- Store on manager profile as `seasonTrends: []`

---

## Phase 5: Profile UI Redesign

### Changes to `league-intel.html`

Replace the current `intel-detail-section` with a profile-centric layout:

```
┌─────────────────────────────────────────────────┐
│ PROFILE HEADER                                  │
│ ┌──────┐  DisplayName         Window: Contender │
│ │ Init │  "Trade Addict"      Record: 24-12-0   │
│ │ials  │  Seasons: 3          PF: 5,234         │
│ └──────┘  Nemesis: @rival     Champ: 1x         │
├─────────────────────────────────────────────────┤
│ [Overview] [Activity] [Rivalries] [Trends]      │  ← tab nav
├─────────────────────────────────────────────────┤
│                                                 │
│ TAB CONTENT                                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Tab: Overview (existing data, rearranged)
- Score cards (Aggression, Trade Friendly, Risk Tolerance)
- Roster Composition bars
- FAAB Behavior + Predictor
- Trade Pattern summary
- Targeting cue

### Tab: Activity
- Chronological feed of all moves
- Icon per type (trade, waiver, add, drop)
- Player names with position/team
- FAAB bid amounts shown on waiver claims
- Value delta on trades
- "Show more" button for pagination (10 at a time)

### Tab: Rivalries
- Head-to-head record cards for each opponent
- Win/loss bar visualization
- Points for/against
- Nemesis and Favorite highlighted at top

### Tab: Trends
- Season-by-season stat rows (table or mini bar charts)
- Columns: Season, Record, Trades, Waivers, Avg FAAB, Aggression, PF
- Visual sparklines for aggression/trade trends (CSS-only, no chart lib)

### Changes to `styles.css`
- Profile header with initials avatar (CSS circle with first letter)
- Tab navigation pills
- Activity feed row styling
- Rivalry cards
- Trend table / sparkline bars

---

## Execution Order

1. **Phase 1** — Matchup data fetch + win/loss records (data foundation)
2. **Phase 2** — Head-to-head rivalries (depends on matchup data)
3. **Phase 3** — Activity feed (uses existing transaction data, new render)
4. **Phase 4** — Season trends (restructure existing aggregation)
5. **Phase 5** — Profile UI redesign (render all the new data)

## Files Modified

| File | Changes |
|------|---------|
| `intel_engine.js` | Matchup fetch, records, rivalries, activity feed, season trends |
| `league_intel.js` | Profile rendering, tab navigation, new render functions |
| `league-intel.html` | Profile layout, tabs, activity feed containers |
| `styles.css` | Profile header, tabs, feed rows, rivalry cards, trend bars |

## Constraints

- No new dependencies (vanilla JS, CSS-only visuals)
- All Sleeper API calls parallelized where possible
- LocalStorage caching with TTL for matchup data
- Mobile responsive (tabs stack vertically on small screens)
