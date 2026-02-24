import { PLAYERS, PLAYER_MAP, SAMPLE_LEAGUES, STARTER_FORMAT } from "./data.js";
import {
  clamp,
  dedupe,
  escapeHtml,
  normalizeToken as normalize,
  round,
  signed,
  sleep
} from "./utils.js";
import {
  buildAdversarialIntelReport,
  collectSleeperPlayerIdsFromSeasonData,
  fetchLeagueHistoryChain,
  fetchLeagueSeasonData
} from "./intel_engine.js";

const FREE_DAILY_LIMIT = 3;
const FREE_USAGE_STORAGE_KEY = "fdl_free_usage";
const SLEEPER_FETCH_TIMEOUT_MS = 15_000;
const BYE_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
const CATALOG_WARM_LIMIT = 350;
const DATALIST_OPTION_LIMIT = 30;
const REMOTE_SUGGESTION_LIMIT = 40;
const REMOTE_SEARCH_MIN_CHARS = 2;
const REMOTE_SEARCH_DEBOUNCE_MS = 300;
const PLAYER_CATALOG_CACHE_KEY = "fdl_player_catalog_cache_v1";
const PLAYER_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SLEEPER_SUBSET_CACHE_KEY = "fdl_sleeper_subset_cache_v1";
const SLEEPER_SUBSET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SLEEPER_SUBSET_CACHE_MAX = 5000;

let suggestionRequestCounter = 0;
let suggestionDebounceTimer = null;

const state = {
  teamAGives: [],
  teamBGives: [],
  scoring: "ppr",
  userSide: "A",
  proMode: false,
  sleeperUsername: "",
  sleeperSeason: currentSleeperSeason(),
  sleeperUserId: "",
  availableLeagues: [],
  sleeperPlayersById: null,
  syncedLeagueId: "",
  syncedRoster: [],
  syncedLeagueSummary: "",
  syncedSource: "none",
  syncedLiveLeague: null,
  syncedOwnerId: "",
  intelLookback: 2,
  intelReport: null,
  catalogPlayers: [...PLAYERS],
  catalogMap: { ...PLAYER_MAP },
  playerNameIndex: buildPlayerNameIndex(PLAYERS),
  databaseConnected: false,
  freeUsage: null,
  analysis: null
};

const dom = {
  teamAInput: document.querySelector("#team-a-input"),
  teamBInput: document.querySelector("#team-b-input"),
  addTeamA: document.querySelector("#add-team-a"),
  addTeamB: document.querySelector("#add-team-b"),
  teamAList: document.querySelector("#team-a-list"),
  teamBList: document.querySelector("#team-b-list"),
  analyzeBtn: document.querySelector("#analyze-btn"),
  scoringFormat: document.querySelector("#scoring-format"),
  userSide: document.querySelector("#user-side"),
  proModeToggle: document.querySelector("#pro-mode-toggle"),
  sleeperUsername: document.querySelector("#sleeper-username"),
  sleeperSeason: document.querySelector("#sleeper-season"),
  loadLeaguesBtn: document.querySelector("#load-leagues-btn"),
  leagueSelect: document.querySelector("#league-select"),
  syncLeagueBtn: document.querySelector("#sync-league-btn"),
  refreshDataBtn: document.querySelector("#refresh-data-btn"),
  dbStatus: document.querySelector("#db-status"),
  aiLookback: document.querySelector("#ai-lookback"),
  buildIntelBtn: document.querySelector("#build-intel-btn"),
  syncStatus: document.querySelector("#sync-status"),
  analysisStatus: document.querySelector("#analysis-status"),
  intelStatus: document.querySelector("#intel-status"),
  intelSection: document.querySelector("#intel-section"),
  intelKpis: document.querySelector("#intel-kpis"),
  intelBars: document.querySelector("#intel-bars"),
  intelProfiles: document.querySelector("#intel-profiles"),
  freeRemaining: document.querySelector("#free-remaining"),
  resultsSection: document.querySelector("#results-section"),
  freeSummary: document.querySelector("#free-summary"),
  valueBarInner: document.querySelector("#value-bar-inner"),
  projectionRows: document.querySelector("#projection-rows"),
  paywallCard: document.querySelector("#paywall-card"),
  paywallText: document.querySelector("#paywall-text"),
  proReport: document.querySelector("#pro-report"),
  proValueSummary: document.querySelector("#pro-value-summary"),
  proAccretion: document.querySelector("#pro-accretion"),
  proVolatility: document.querySelector("#pro-volatility"),
  proByeImpact: document.querySelector("#pro-bye-impact"),
  proRosterFit: document.querySelector("#pro-roster-fit"),
  verdictGrade: document.querySelector("#verdict-grade"),
  verdictSummary: document.querySelector("#verdict-summary"),
  verdictConfidence: document.querySelector("#verdict-confidence"),
  feedbackForm: document.querySelector("#feedback-form"),
  feedbackEmail: document.querySelector("#feedback-email"),
  feedbackNotes: document.querySelector("#feedback-notes"),
  feedbackMessage: document.querySelector("#feedback-message"),
  downloadFeedbackBtn: document.querySelector("#download-feedback-btn"),
  datalist: document.querySelector("#player-options")
};

initialize();

function initialize() {
  initializeCatalog();
  hydrateCatalogFromCache();
  hydrateFreeUsage();
  renderPlayerOptions();
  renderLeagueOptions();
  dom.sleeperSeason.value = String(state.sleeperSeason);
  dom.aiLookback.value = String(state.intelLookback);
  wireEvents();
  updateFreeUsageUI();
  renderTradeLists();
  renderSyncStatus();
  renderIntelReport();
  probeDatabaseConnection();
  loadCatalogFromDatabase();
}

function hydrateFreeUsage() {
  const today = getTodayIso();
  const fallback = { date: today, count: 0 };

  try {
    const parsed = JSON.parse(localStorage.getItem(FREE_USAGE_STORAGE_KEY) || "null");
    if (!parsed || parsed.date !== today) {
      state.freeUsage = fallback;
      localStorage.setItem(FREE_USAGE_STORAGE_KEY, JSON.stringify(fallback));
      return;
    }
    state.freeUsage = {
      date: today,
      count: Math.max(0, Number(parsed.count) || 0)
    };
  } catch (error) {
    state.freeUsage = fallback;
    localStorage.setItem(FREE_USAGE_STORAGE_KEY, JSON.stringify(fallback));
  }
}

function wireEvents() {
  dom.addTeamA.addEventListener("click", () => addFromInput("A"));
  dom.addTeamB.addEventListener("click", () => addFromInput("B"));

  dom.teamAInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFromInput("A");
    }
  });
  dom.teamBInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFromInput("B");
    }
  });

  dom.teamAInput.addEventListener("input", () => scheduleRemoteSuggestions(dom.teamAInput.value));
  dom.teamBInput.addEventListener("input", () => scheduleRemoteSuggestions(dom.teamBInput.value));

  dom.scoringFormat.addEventListener("change", (event) => {
    state.scoring = event.target.value;
  });

  dom.userSide.addEventListener("change", (event) => {
    state.userSide = event.target.value;
  });

  dom.proModeToggle.addEventListener("change", (event) => {
    state.proMode = event.target.checked;
    setStatus(
      state.proMode
        ? "Pro preview enabled. Full six-section report unlocked."
        : "Free mode enabled. You have limited daily analyses.",
      "info"
    );
    updateFreeUsageUI();
    if (state.analysis) {
      renderAnalysis();
    }
  });

  dom.sleeperUsername.addEventListener("input", (event) => {
    state.sleeperUsername = event.target.value.trim();
  });

  dom.sleeperSeason.addEventListener("change", (event) => {
    state.sleeperSeason = Number(event.target.value) || currentSleeperSeason();
  });

  dom.loadLeaguesBtn.addEventListener("click", handleLoadLeagues);

  dom.leagueSelect.addEventListener("change", (event) => {
    state.syncedLeagueId = event.target.value;
  });

  dom.aiLookback.addEventListener("change", (event) => {
    state.intelLookback = Number(event.target.value) || 2;
  });

  dom.syncLeagueBtn.addEventListener("click", handleLeagueSync);
  if (dom.refreshDataBtn) {
    dom.refreshDataBtn.addEventListener("click", handleRefreshLiveDatabase);
  }
  dom.buildIntelBtn.addEventListener("click", handleBuildOpponentProfiles);
  dom.analyzeBtn.addEventListener("click", handleAnalyzeTrade);
  dom.feedbackForm.addEventListener("submit", handleFeedbackSubmit);
  dom.downloadFeedbackBtn.addEventListener("click", downloadFeedback);
}

function renderPlayerOptions(players = state.catalogPlayers, query = "") {
  const token = normalize(String(query || ""));
  const source = Array.isArray(players) ? players : state.catalogPlayers;
  const sortedPlayers = [...source]
    .filter((player) => {
      if (!token) return true;
      return normalize(player.name).includes(token);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, DATALIST_OPTION_LIMIT);

  const options = sortedPlayers
    .map((player) => `<option value="${player.name} (${player.position}, ${player.team})"></option>`)
    .join("");
  dom.datalist.innerHTML = options;
}

function scheduleRemoteSuggestions(rawValue) {
  const query = String(rawValue || "").trim();
  clearTimeout(suggestionDebounceTimer);
  suggestionDebounceTimer = setTimeout(() => {
    refreshRemoteSuggestions(query);
  }, REMOTE_SEARCH_DEBOUNCE_MS);
}

async function refreshRemoteSuggestions(query) {
  const token = String(query || "").trim();
  if (token.length < REMOTE_SEARCH_MIN_CHARS) {
    renderPlayerOptions(state.catalogPlayers, token);
    return;
  }

  const requestId = ++suggestionRequestCounter;
  try {
    const response = await fetch(
      `/api/players?search=${encodeURIComponent(token)}&limit=${REMOTE_SUGGESTION_LIMIT}&sort=name`
    );
    if (!response.ok) return;
    const payload = await response.json();
    if (requestId !== suggestionRequestCounter) return;

    const rows = Array.isArray(payload.items) ? payload.items : [];
    const suggestions = [];
    let catalogChanged = false;

    for (const row of rows) {
      const player = buildLivePlayerModel(row);
      if (!player) continue;
      suggestions.push(player);
      if (upsertCatalogPlayer(player)) {
        catalogChanged = true;
      }
    }

    if (catalogChanged) {
      rebuildCatalogIndexes();
    }
    if (suggestions.length) {
      renderPlayerOptions(suggestions, token);
    }
  } catch (error) {
    // Keep local-only suggestions on fetch errors.
  }
}

function renderLeagueOptions() {
  const liveOptions = state.availableLeagues.map(
    (league) =>
      `<option value="live:${league.league_id}">${league.name || "Sleeper League"} (${inferScoringFormatFromLeague(league).toUpperCase()}, ${league.total_rosters || "?"} teams)</option>`
  );

  const sampleOptions = SAMPLE_LEAGUES.map(
    (league) =>
      `<option value="sample:${league.id}">${league.name} [Sample] (${league.scoring.toUpperCase()}, ${league.record})</option>`
  ).join("");

  dom.leagueSelect.innerHTML = `<option value="">Select league to sync...</option>${liveOptions.join("")}${sampleOptions}`;
}

function addFromInput(side) {
  const input = side === "A" ? dom.teamAInput : dom.teamBInput;
  const resolved = resolvePlayerFromInput(input.value);
  if (!resolved) {
    setStatus("Player not found. Use autocomplete format: Name (POS, TEAM).", "error");
    return;
  }

  if (state.teamAGives.includes(resolved.id) || state.teamBGives.includes(resolved.id)) {
    setStatus(`${resolved.name} is already in this trade package.`, "error");
    return;
  }

  if (side === "A") {
    state.teamAGives.push(resolved.id);
  } else {
    state.teamBGives.push(resolved.id);
  }

  input.value = "";
  setStatus(`${resolved.name} added to Team ${side}.`, "success");
  renderTradeLists();
}

function resolvePlayerFromInput(raw) {
  if (!raw || !raw.trim()) {
    return null;
  }

  const trimmed = raw.trim();
  const exactOptionMatch = trimmed.match(/^(.*)\s\([A-Z]{2,3},\s[A-Z]{2,3}\)$/);
  const name = exactOptionMatch ? exactOptionMatch[1].trim() : trimmed;
  const normalized = normalize(name);

  const directId = state.playerNameIndex.get(normalized);
  if (directId) {
    return getCatalogPlayer(directId);
  }
  return state.catalogPlayers.find((player) => normalize(player.name) === normalized) || null;
}

function renderTradeLists() {
  dom.teamAList.innerHTML = renderPlayerChips(state.teamAGives, "A");
  dom.teamBList.innerHTML = renderPlayerChips(state.teamBGives, "B");

  dom.teamAList.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => removePlayer("A", button.dataset.id));
  });
  dom.teamBList.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => removePlayer("B", button.dataset.id));
  });
}

function renderPlayerChips(ids, side) {
  if (!ids.length) {
    return `<li class="chip chip-empty">No players added yet.</li>`;
  }

  const chips = ids
    .map((id) => {
      const player = getCatalogPlayer(id);
      if (!player) return "";
      return `
        <li class="chip">
          <span>${player.name}</span>
          <small>${player.position} • ${player.team}</small>
          <button data-id="${id}" aria-label="Remove ${player.name} from team ${side}">remove</button>
        </li>
      `;
    })
    .filter(Boolean)
    .join("");

  return chips || `<li class="chip chip-empty">No players added yet.</li>`;
}

function removePlayer(side, id) {
  if (side === "A") {
    state.teamAGives = state.teamAGives.filter((playerId) => playerId !== id);
  } else {
    state.teamBGives = state.teamBGives.filter((playerId) => playerId !== id);
  }
  renderTradeLists();
}

async function handleLoadLeagues() {
  const username = (state.sleeperUsername || dom.sleeperUsername.value || "").trim();
  const season = Number(state.sleeperSeason || dom.sleeperSeason.value);

  if (!username) {
    setStatus("Enter your Sleeper username, then click Load Leagues.", "error");
    return;
  }
  if (!season || season < 2017) {
    setStatus("Enter a valid NFL season year (2017+).", "error");
    return;
  }

  state.sleeperUsername = username;
  state.sleeperSeason = season;
  state.intelReport = null;
  renderIntelReport();

  try {
    setStatus(`Looking up Sleeper user "${username}"...`, "info");
    dom.loadLeaguesBtn.disabled = true;
    dom.loadLeaguesBtn.textContent = "Loading...";

    const user = await fetchSleeperJSON(`/user/${encodeURIComponent(username)}`);
    if (!user || !user.user_id) {
      throw new Error("Sleeper user not found.");
    }

    state.sleeperUserId = user.user_id;
    setStatus(`Loading ${season} leagues for ${username}...`, "info");

    const leagues = await fetchSleeperJSON(`/user/${user.user_id}/leagues/nfl/${season}`);
    if (!Array.isArray(leagues)) {
      throw new Error("Unexpected Sleeper leagues response.");
    }

    state.availableLeagues = leagues.sort((a, b) => (b.total_rosters || 0) - (a.total_rosters || 0));
    renderLeagueOptions();

    if (state.availableLeagues.length > 0) {
      state.syncedLeagueId = `live:${state.availableLeagues[0].league_id}`;
      dom.leagueSelect.value = state.syncedLeagueId;
      setStatus(`Loaded ${state.availableLeagues.length} Sleeper leagues. Select one and click Sync League.`, "success");
      setIntelStatus("Leagues loaded. Sync one, then run opponent profile analysis.", "info");
    } else {
      state.syncedLeagueId = "";
      setStatus(`No leagues found for ${username} in ${season}. You can still sync a sample league.`, "info");
      setIntelStatus("No live leagues found for that season.", "error");
    }
  } catch (error) {
    setStatus(`Sleeper league load failed: ${error.message}`, "error");
    setIntelStatus("Sleeper lookup failed. Check username and season.", "error");
  } finally {
    dom.loadLeaguesBtn.disabled = false;
    dom.loadLeaguesBtn.textContent = "Load Leagues";
  }
}

async function handleLeagueSync() {
  if (!state.syncedLeagueId) {
    setStatus("Pick a league before syncing.", "error");
    return;
  }

  if (state.syncedLeagueId.startsWith("sample:")) {
    const sampleId = state.syncedLeagueId.slice("sample:".length);
    const selected = SAMPLE_LEAGUES.find((league) => league.id === sampleId);
    if (!selected) {
      setStatus("Selected sample league was not found.", "error");
      return;
    }

    state.syncedRoster = [...selected.roster];
    state.syncedSource = "sample";
    state.syncedLeagueSummary = `${selected.name} [Sample]`;
    state.syncedLiveLeague = null;
    state.syncedOwnerId = "";
    state.intelReport = null;
    renderIntelReport();
    state.scoring = selected.scoring;
    dom.scoringFormat.value = selected.scoring;
    renderSyncStatus();
    setStatus(
      `Synced sample league ${selected.name}: ${selected.roster.length} players with ${selected.scoring.toUpperCase()} scoring.`,
      "success"
    );
    setIntelStatus("Sample leagues do not include multi-season transaction history. Sync a live Sleeper league for adversarial profiles.", "info");
    return;
  }

  if (!state.syncedLeagueId.startsWith("live:")) {
    setStatus("Invalid league selection.", "error");
    return;
  }

  const leagueId = state.syncedLeagueId.slice("live:".length);
  const selectedLeague = state.availableLeagues.find((league) => String(league.league_id) === leagueId);
  if (!selectedLeague) {
    setStatus("League details not found. Reload leagues and try again.", "error");
    return;
  }

  try {
    dom.syncLeagueBtn.disabled = true;
    dom.syncLeagueBtn.textContent = "Syncing...";
    setStatus("Syncing league rosters from Sleeper...", "info");

    const [rosters, users] = await Promise.all([
      fetchSleeperJSON(`/league/${leagueId}/rosters`),
      fetchSleeperJSON(`/league/${leagueId}/users`)
    ]);

    if (!Array.isArray(rosters) || !Array.isArray(users)) {
      throw new Error("Unexpected Sleeper roster response.");
    }

    let myRoster = rosters.find((roster) => userOwnsRoster(roster, state.sleeperUserId));
    if (!myRoster) {
      throw new Error("Could not find your roster in that league.");
    }

    const rosterSleeperIds = dedupe([...(myRoster.players || []), ...(myRoster.reserve || []), ...(myRoster.taxi || [])]);
    setStatus("Loading Sleeper player subset for roster mapping...", "info");
    const sleeperPlayersById = await loadSleeperPlayerCatalog(rosterSleeperIds);
    const mapped = mapSleeperRosterToInternalIds(myRoster, sleeperPlayersById);

    if (mapped.ids.length === 0) {
      throw new Error("No roster players mapped to the current beta player universe.");
    }

    state.syncedRoster = ensureBetaCompatibleRoster(mapped.ids);
    state.syncedSource = "live";
    state.syncedLeagueSummary = selectedLeague.name || `Sleeper league ${leagueId}`;
    state.syncedLiveLeague = selectedLeague;
    state.syncedOwnerId = state.sleeperUserId;
    state.intelReport = null;
    renderIntelReport();

    const inferredScoring = inferScoringFormatFromLeague(selectedLeague);
    state.scoring = inferredScoring;
    dom.scoringFormat.value = inferredScoring;

    const owner = users.find((u) => String(u.user_id) === String(state.sleeperUserId));
    const displayOwner = owner?.display_name || owner?.username || state.sleeperUsername;

    renderSyncStatus();
    setStatus(
      `Synced ${state.syncedLeagueSummary} for ${displayOwner}: mapped ${mapped.mappedCount}/${mapped.totalCount} roster players.`,
      "success"
    );
    setIntelStatus("League synced. Build opponent profiles to analyze FAAB and trade behavior.", "info");
  } catch (error) {
    setStatus(`Sleeper sync failed: ${error.message}`, "error");
    setIntelStatus("Sync failed, so adversarial profile build is unavailable.", "error");
  } finally {
    dom.syncLeagueBtn.disabled = false;
    dom.syncLeagueBtn.textContent = "Sync League";
  }
}

function renderSyncStatus() {
  if (!state.syncedRoster.length) {
    dom.syncStatus.textContent = "No league synced. Using default beta roster assumptions.";
    return;
  }

  const starters = optimizeLineup(state.syncedRoster, state.scoring).lineup
    .map((entry) => `${entry.slot}: ${entry.player.name}`)
    .join(" | ");
  dom.syncStatus.textContent = `${state.syncedLeagueSummary || "League synced"} (${state.syncedSource}) -> ${starters}`;
}

async function handleBuildOpponentProfiles() {
  if (!state.syncedLiveLeague || !state.syncedOwnerId) {
    setIntelStatus("Sync a live Sleeper league first to build opponent profiles.", "error");
    return;
  }

  const lookback = clamp(Number(state.intelLookback) || 2, 1, 4);
  dom.buildIntelBtn.disabled = true;
  dom.buildIntelBtn.textContent = "Building...";
  setIntelStatus("Loading league history chain...", "info");

  try {
    const leagueChain = await fetchLeagueHistoryChainForTerminal(state.syncedLiveLeague, lookback);
    setIntelStatus("Fetching rosters, users, and transactions across seasons...", "info");
    const seasonData = await fetchLeagueSeasonDataForTerminal(leagueChain);

    setIntelStatus("Computing adversarial manager profiles...", "info");
    const report = await buildTerminalIntelReport(seasonData, state.syncedOwnerId);
    state.intelReport = report;
    renderIntelReport();
    setIntelStatus(
      `Profiles built for ${report.summary.managersAnalyzed} managers across ${report.summary.seasonsAnalyzed} season(s).`,
      "success"
    );
  } catch (error) {
    setIntelStatus(`Could not build profiles: ${error.message}`, "error");
  } finally {
    dom.buildIntelBtn.disabled = false;
    dom.buildIntelBtn.textContent = "Build Opponent Profiles";
  }
}

function setIntelStatus(message, level = "info") {
  dom.intelStatus.textContent = message;
  dom.intelStatus.dataset.level = level;
}

function renderIntelReport() {
  if (!state.intelReport) {
    dom.intelSection.classList.add("hidden");
    return;
  }

  const report = state.intelReport;
  dom.intelSection.classList.remove("hidden");

  dom.intelKpis.innerHTML = `
    ${renderKpi("Seasons", report.summary.seasonsAnalyzed)}
    ${renderKpi("Leagues", report.summary.leaguesTraversed)}
    ${renderKpi("Transactions", report.summary.totalTransactions)}
    ${renderKpi("Waivers", report.summary.totalWaivers)}
    ${renderKpi("Trades", report.summary.totalTrades)}
    ${renderKpi("FAAB Bid $", report.summary.totalFaabBid)}
  `;

  dom.intelBars.innerHTML = report.managers
    .slice(0, 12)
    .map(
      (manager) => `
        <div class="intel-bar-row">
          <div class="intel-name">${escapeHtml(manager.displayName)}</div>
          <div class="intel-bar-track"><div class="intel-bar-fill" style="width:${clamp(manager.aggressionScore, 1, 100)}%"></div></div>
          <div class="intel-score">${manager.aggressionScore}</div>
        </div>
      `
    )
    .join("");

  dom.intelProfiles.innerHTML = report.managers
    .slice(0, 10)
    .map(
      (manager) => `
        <article class="profile-card">
          <div class="profile-head">
            <h3 class="profile-name">${escapeHtml(manager.displayName)}${manager.isYou ? " (You)" : ""}</h3>
            <strong>${manager.profileLabel}</strong>
          </div>
          <p class="profile-meta">
            Aggression ${manager.aggressionScore} | Trades ${manager.tradeCount} | Waivers ${manager.waiverCount}
            | Avg FAAB $${manager.avgFaabBid}
          </p>
          <p>${escapeHtml(manager.insight)}</p>
          <p class="profile-meta">Targeting cue: ${escapeHtml(manager.targetingCue)}</p>
        </article>
      `
    )
    .join("");
}

function renderKpi(label, value) {
  return `
    <div class="kpi">
      <p class="kpi-label">${label}</p>
      <p class="kpi-value">${value}</p>
    </div>
  `;
}

async function fetchLeagueHistoryChainForTerminal(startLeague, maxSeasons) {
  return fetchLeagueHistoryChain(startLeague, maxSeasons, fetchSleeperJSON);
}

async function fetchLeagueSeasonDataForTerminal(leagues) {
  return fetchLeagueSeasonData(leagues, fetchSleeperJSON, {
    cacheNamespace: "terminal"
  });
}

async function buildTerminalIntelReport(seasonData, myUserId) {
  const referencedPlayerIds = collectSleeperPlayerIdsFromSeasonData(seasonData);
  const sleeperPlayersById = await loadSleeperPlayerCatalog(referencedPlayerIds);
  return buildAdversarialIntelReport(seasonData, myUserId, sleeperPlayersById, {
    profileTone: "terminal",
    includeTradeTimeline: false
  });
}

function initializeCatalog() {
  state.catalogPlayers = [...PLAYERS];
  state.catalogMap = { ...PLAYER_MAP };
  state.playerNameIndex = buildPlayerNameIndex(state.catalogPlayers);
}

function getCatalogPlayer(id) {
  return state.catalogMap[id] || null;
}

function upsertCatalogPlayer(player) {
  if (!player || !player.id) return false;
  const existing = state.catalogMap[player.id];
  if (existing) {
    Object.assign(existing, player);
    return false;
  }
  state.catalogPlayers.push(player);
  state.catalogMap[player.id] = player;
  const normalized = normalize(player.name);
  state.playerNameIndex.set(normalized, player.id);
  state.playerNameIndex.set(normalize(player.name.replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "").trim()), player.id);
  return true;
}

function rebuildCatalogIndexes() {
  state.catalogMap = Object.fromEntries(state.catalogPlayers.map((player) => [player.id, player]));
  // Name index is kept current incrementally by upsertCatalogPlayer.
  // Full rebuild only needed on explicit reset (initializeCatalog).
}

async function probeDatabaseConnection() {
  if (!dom.dbStatus) {
    return;
  }
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    state.databaseConnected = true;
    const synced = payload.last_sync_at ? `Last sync: ${payload.last_sync_at}` : "No sync yet";
    dom.dbStatus.textContent = `Database status: connected (${payload.players} players, ${payload.stats_rows} stat rows). ${synced}.`;
  } catch (error) {
    state.databaseConnected = false;
    dom.dbStatus.textContent = "Database status: offline. Start terminal_server.py to enable live data.";
  }
}

async function loadCatalogFromDatabase(options = {}) {
  const { force } = options;
  const cacheStatus = hydrateCatalogFromCache();
  if (!force && cacheStatus === "fresh") {
    return;
  }

  try {
    const response = await fetch(`/api/players?limit=${CATALOG_WARM_LIMIT}&sort=points_desc`);
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      return;
    }

    let added = 0;
    for (const row of items) {
      const livePlayer = buildLivePlayerModel(row);
      if (!livePlayer) continue;
      if (upsertCatalogPlayer(livePlayer)) {
        added += 1;
      }
    }

    if (added > 0) {
      rebuildCatalogIndexes();
    }
    persistCatalogCache();
    renderPlayerOptions(state.catalogPlayers);
  } catch (error) {
    // Fall back silently to seeded local catalog.
  }
}

function buildLivePlayerModel(row) {
  const name = String(row.full_name || "").trim();
  const position = String(row.position || "").toUpperCase();
  if (!name || !["QB", "RB", "WR", "TE", "K"].includes(position)) {
    return null;
  }

  const points = Number(row.latest_fantasy_points_ppr);
  const rec = Number(row.latest_receptions);
  const ppr = Number.isFinite(points) ? points : defaultProjectionByPosition(position);
  const receptions = Number.isFinite(rec) ? rec : 0;
  const std = Math.max(ppr - receptions, 0);
  const ros = ppr;
  const ceiling = ppr * 1.35 + 2;
  const floor = Math.max(ppr * 0.65 - 1, 0);

  return {
    id: String(row.player_id),
    name,
    position,
    team: row.team || "FA",
    byeWeek: 10,
    projStd: round(std, 1),
    projPpr: round(ppr, 1),
    ros: round(ros, 1),
    ceiling: round(ceiling, 1),
    floor: round(floor, 1),
    volatility: 0.56,
    marketValue: estimateMarketValue(position, ppr),
    targetShare: 0,
    opportunityShare: 0
  };
}

function defaultProjectionByPosition(position) {
  if (position === "QB") return 16.5;
  if (position === "RB") return 10.5;
  if (position === "WR") return 10.0;
  if (position === "TE") return 8.2;
  if (position === "K") return 8.0;
  return 8.0;
}

function estimateMarketValue(position, ppr) {
  const base = Math.max(ppr, 1);
  const multiplier = position === "QB" ? 1.45 : position === "RB" ? 1.85 : position === "WR" ? 1.8 : 1.4;
  return round(clamp(base * multiplier, 8, 58), 1);
}

async function handleRefreshLiveDatabase() {
  const season = state.sleeperSeason || currentSleeperSeason();
  try {
    if (dom.refreshDataBtn) {
      dom.refreshDataBtn.disabled = true;
      dom.refreshDataBtn.textContent = "Refreshing...";
    }
    setStatus("Refreshing live database from sources...", "info");
    const response = await fetch(`/api/admin/sync?season=${season}`);
    if (!response.ok && response.status !== 202) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (response.status === 202 || payload.queued) {
      setStatus("Sync started in background. This can take a few minutes on first run.", "info");
      await waitForSyncToFinishInTerminal();
      return;
    }
    const summary = payload.summary || {};
    await probeDatabaseConnection();
    await loadCatalogFromDatabase({ force: true });
    setStatus(
      `Live database refreshed: ${summary.players_upserted || 0} players, ${summary.stats_rows_upserted || 0} stat rows.`,
      "success"
    );
  } catch (error) {
    setStatus(`Live database refresh failed: ${error.message}`, "error");
  } finally {
    if (dom.refreshDataBtn) {
      dom.refreshDataBtn.disabled = false;
      dom.refreshDataBtn.textContent = "Refresh Live DB";
    }
  }
}

async function waitForSyncToFinishInTerminal() {
  const startedAt = Date.now();
  const maxMs = 6 * 60 * 1000;

  while (Date.now() - startedAt < maxMs) {
    await sleep(3000);
    const response = await fetch("/api/admin/sync/status");
    if (!response.ok) continue;
    const payload = await response.json();
    const status = payload.status || {};
    if (status.running) {
      setStatus("Sync in progress... building live stats database.", "info");
      continue;
    }
    if (status.last_error) {
      setStatus(`Live database sync failed: ${status.last_error}`, "error");
      return;
    }
    const summary = status.last_summary || {};
    await probeDatabaseConnection();
    await loadCatalogFromDatabase({ force: true });
    setStatus(
      `Live database refreshed: ${summary.players_upserted || 0} players, ${summary.stats_rows_upserted || 0} stat rows.`,
      "success"
    );
    return;
  }

  setStatus("Sync still running in background. Try refresh again shortly.", "info");
}

function handleAnalyzeTrade() {
  if (!state.teamAGives.length || !state.teamBGives.length) {
    setStatus("Add at least one player to each side before running analysis.", "error");
    return;
  }

  let activeScoring = state.scoring;
  if (!state.proMode && state.scoring === "half") {
    activeScoring = "ppr";
    setStatus("Half-PPR customization is a Pro feature. Free mode used PPR for this run.", "info");
  }

  if (!state.proMode && getFreeRunsRemaining() <= 0) {
    setStatus("Daily free limit reached. Enable Pro preview to continue beta testing.", "error");
    dom.paywallCard.classList.remove("hidden");
    dom.paywallText.textContent = "You have used 3/3 free analyses today. Pro preview unlocks unlimited runs.";
    updateFreeUsageUI();
    return;
  }

  const teamAPlayers = state.teamAGives.map((id) => getCatalogPlayer(id)).filter(Boolean);
  const teamBPlayers = state.teamBGives.map((id) => getCatalogPlayer(id)).filter(Boolean);

  const analysis = createTradeAnalysis({
    teamAPlayers,
    teamBPlayers,
    scoring: activeScoring,
    userSide: state.userSide,
    rosterIds: getActiveRoster()
  });

  if (!state.proMode) {
    consumeFreeRun();
    updateFreeUsageUI();
  }

  state.analysis = analysis;
  renderAnalysis();
  setStatus("Analysis complete.", "success");
}

function getActiveRoster() {
  if (state.syncedRoster.length) {
    return [...state.syncedRoster];
  }
  return [...SAMPLE_LEAGUES[0].roster];
}

async function fetchSleeperJSON(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLEEPER_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${SLEEPER_API_BASE}${path}`, { signal: controller.signal });
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Resource not found.");
      }
      throw new Error(`Sleeper API returned ${response.status}.`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSleeperPlayerCatalog(requestedIds = []) {
  const requested = dedupe((requestedIds || []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!requested.length) {
    return state.sleeperPlayersById || {};
  }

  if (!state.sleeperPlayersById) {
    hydrateSleeperSubsetFromCache();
    if (!state.sleeperPlayersById) {
      state.sleeperPlayersById = {};
    }
  }

  const missing = requested.filter((playerId) => !state.sleeperPlayersById[playerId]);
  if (!missing.length) {
    return state.sleeperPlayersById;
  }

  const response = await fetch("/api/sleeper/players/by-ids", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: missing })
  });
  if (!response.ok) {
    throw new Error(`Sleeper player cache API returned ${response.status}.`);
  }
  const payload = await response.json();
  const players = payload?.players;
  if (!players || typeof players !== "object") {
    throw new Error("Sleeper player subset payload was not usable.");
  }

  state.sleeperPlayersById = {
    ...state.sleeperPlayersById,
    ...players
  };
  trimSleeperSubsetCache();
  persistSleeperSubsetCache();
  return state.sleeperPlayersById;
}

function hydrateCatalogFromCache() {
  const payload = readCachedJson(PLAYER_CATALOG_CACHE_KEY);
  if (!payload || !Array.isArray(payload.players) || payload.players.length === 0) {
    return "miss";
  }

  const status = isCacheFresh(payload.timestamp, PLAYER_CATALOG_CACHE_TTL_MS) ? "fresh" : "stale";
  let merged = 0;
  for (const cachedPlayer of payload.players) {
    if (!cachedPlayer || !cachedPlayer.id || !cachedPlayer.name) {
      continue;
    }
    if (upsertCatalogPlayer(cachedPlayer)) {
      merged += 1;
    }
  }
  if (merged > 0) {
    rebuildCatalogIndexes();
  }
  return status;
}

function persistCatalogCache() {
  writeCachedJson(PLAYER_CATALOG_CACHE_KEY, {
    timestamp: Date.now(),
    players: state.catalogPlayers.slice(0, CATALOG_WARM_LIMIT)
  });
}

function hydrateSleeperSubsetFromCache() {
  const payload = readCachedJson(SLEEPER_SUBSET_CACHE_KEY);
  if (!payload || !payload.players || typeof payload.players !== "object") {
    return "miss";
  }
  state.sleeperPlayersById = payload.players;
  return isCacheFresh(payload.timestamp, SLEEPER_SUBSET_CACHE_TTL_MS) ? "fresh" : "stale";
}

function persistSleeperSubsetCache() {
  if (!state.sleeperPlayersById || typeof state.sleeperPlayersById !== "object") {
    return;
  }
  writeCachedJson(SLEEPER_SUBSET_CACHE_KEY, {
    timestamp: Date.now(),
    players: state.sleeperPlayersById
  });
}

function trimSleeperSubsetCache() {
  const entries = Object.entries(state.sleeperPlayersById || {});
  if (entries.length <= SLEEPER_SUBSET_CACHE_MAX) {
    return;
  }
  state.sleeperPlayersById = Object.fromEntries(entries.slice(entries.length - SLEEPER_SUBSET_CACHE_MAX));
}

function readCachedJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    return null;
  }
}

function writeCachedJson(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    // Ignore quota or serialization failures and continue without cache.
  }
}

function isCacheFresh(timestamp, ttlMs) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts <= ttlMs;
}

function mapSleeperRosterToInternalIds(roster, sleeperPlayersById) {
  const sleeperIds = dedupe([...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || [])]);
  const mappedIds = [];
  let catalogChanged = false;

  for (const sleeperId of sleeperIds) {
    if (state.catalogMap[String(sleeperId)]) {
      mappedIds.push(String(sleeperId));
      continue;
    }

    const sleeperPlayer = sleeperPlayersById[sleeperId];
    if (!sleeperPlayer) {
      continue;
    }

    const fullName = sleeperPlayer.full_name || `${sleeperPlayer.first_name || ""} ${sleeperPlayer.last_name || ""}`.trim();
    const normalized = normalize(fullName);
    if (!normalized) {
      continue;
    }

    const internalId = state.playerNameIndex.get(normalized);
    if (internalId) {
      mappedIds.push(internalId);
      continue;
    }

    const synthesized = buildSleeperFallbackPlayerModel(sleeperId, sleeperPlayer, fullName);
    if (synthesized) {
      if (upsertCatalogPlayer(synthesized)) {
        catalogChanged = true;
      }
      mappedIds.push(synthesized.id);
    }
  }

  if (catalogChanged) {
    rebuildCatalogIndexes();
  }

  return {
    ids: dedupe(mappedIds),
    mappedCount: dedupe(mappedIds).length,
    totalCount: sleeperIds.length
  };
}

function buildSleeperFallbackPlayerModel(sleeperId, sleeperPlayer, fullName) {
  const position = String(sleeperPlayer?.position || "").toUpperCase();
  if (!["QB", "RB", "WR", "TE", "K"].includes(position)) {
    return null;
  }
  const ppr = defaultProjectionByPosition(position);
  const receptions = position === "WR" || position === "TE" ? 4 : position === "RB" ? 2 : 0;
  const std = Math.max(ppr - receptions, 0);
  const age = Number(sleeperPlayer?.age);
  const youthBoost = Number.isFinite(age) ? (age <= 24 ? 1.12 : age <= 27 ? 1.03 : age <= 30 ? 0.93 : 0.82) : 1;

  return {
    id: String(sleeperId),
    name: String(fullName || `Player ${sleeperId}`),
    position,
    team: sleeperPlayer?.team || "FA",
    byeWeek: 10,
    projStd: round(std, 1),
    projPpr: round(ppr, 1),
    ros: round(ppr * youthBoost, 1),
    ceiling: round(ppr * 1.32, 1),
    floor: round(Math.max(ppr * 0.62 - 1, 0), 1),
    volatility: position === "QB" ? 0.44 : position === "RB" ? 0.61 : 0.56,
    marketValue: estimateMarketValue(position, ppr * youthBoost),
    targetShare: 0,
    opportunityShare: 0
  };
}

function ensureBetaCompatibleRoster(rosterIds) {
  const required = { QB: 1, RB: 2, WR: 2, TE: 1 };
  const merged = dedupe([...rosterIds]);
  const fallbackIds = SAMPLE_LEAGUES[0].roster;

  const hasRequirement = (position) =>
    merged.filter((id) => getCatalogPlayer(id)?.position === position).length >= required[position];
  for (const position of Object.keys(required)) {
    if (!hasRequirement(position)) {
      for (const fallbackId of fallbackIds) {
        const fallbackPlayer = getCatalogPlayer(fallbackId);
        if (fallbackPlayer?.position === position && !merged.includes(fallbackId)) {
          merged.push(fallbackId);
        }
        if (hasRequirement(position)) {
          break;
        }
      }
    }
  }

  for (const fallbackId of fallbackIds) {
    if (merged.length >= 12) {
      break;
    }
    if (!merged.includes(fallbackId)) {
      merged.push(fallbackId);
    }
  }

  return merged;
}

function inferScoringFormatFromLeague(league) {
  const rec = Number(league?.scoring_settings?.rec);
  if (Number.isFinite(rec) && rec >= 0.9) {
    return "ppr";
  }
  if (Number.isFinite(rec) && rec >= 0.4) {
    return "half";
  }
  return "std";
}

function userOwnsRoster(roster, sleeperUserId) {
  if (!roster || !sleeperUserId) return false;
  if (String(roster.owner_id) === String(sleeperUserId)) return true;
  if (Array.isArray(roster.co_owners)) {
    return roster.co_owners.some((ownerId) => String(ownerId) === String(sleeperUserId));
  }
  return false;
}

function createTradeAnalysis({ teamAPlayers, teamBPlayers, scoring, userSide, rosterIds }) {
  const valueA = round(sum(teamAPlayers.map((player) => computeTradeValue(player, scoring))), 1);
  const valueB = round(sum(teamBPlayers.map((player) => computeTradeValue(player, scoring))), 1);

  const outgoing = userSide === "A" ? teamAPlayers : teamBPlayers;
  const incoming = userSide === "A" ? teamBPlayers : teamAPlayers;
  const incomingValue = round(sum(incoming.map((player) => computeTradeValue(player, scoring))), 1);
  const outgoingValue = round(sum(outgoing.map((player) => computeTradeValue(player, scoring))), 1);
  const userNetValue = round(incomingValue - outgoingValue, 1);

  const beforeRoster = dedupe(rosterIds);
  const afterRoster = applyTradeToRoster(beforeRoster, outgoing, incoming);

  const beforeLineup = optimizeLineup(beforeRoster, scoring);
  const afterLineup = optimizeLineup(afterRoster, scoring);

  const accretionDelta = round(afterLineup.points - beforeLineup.points, 2);
  const ceilingDelta = round(afterLineup.ceiling - beforeLineup.ceiling, 2);
  const floorDelta = round(afterLineup.floor - beforeLineup.floor, 2);

  const volatility = computeVolatility(beforeLineup.lineup, afterLineup.lineup, incoming, outgoing, scoring);
  const byeImpact = computeByeImpact(beforeLineup.lineup, afterLineup.lineup);
  const rosterFit = computeRosterFit(beforeRoster, afterRoster, incoming, outgoing, scoring);

  const verdict = generateVerdict({
    userNetValue,
    accretionDelta,
    ceilingDelta,
    floorDelta,
    volatilityAfter: volatility.after,
    byeImprovement: byeImpact.improvement,
    rosterFitScore: rosterFit.score
  });

  return {
    scoring,
    valueA,
    valueB,
    winningSide: valueA > valueB ? "A" : valueB > valueA ? "B" : "TIE",
    incomingValue,
    outgoingValue,
    userNetValue,
    playersInTrade: [...teamAPlayers, ...teamBPlayers],
    projections: {
      before: beforeLineup,
      after: afterLineup
    },
    accretion: {
      points: accretionDelta,
      ceiling: ceilingDelta,
      floor: floorDelta
    },
    volatility,
    byeImpact,
    rosterFit,
    verdict,
    teasers: {
      championshipOddsDelta: round(accretionDelta * 2.0 + rosterFit.score * 0.06 - volatility.after * 4.0, 1),
      hiddenInsight:
        accretionDelta >= 0
          ? "Your projected starting lineup improves when optimized."
          : "Your projected lineup declines unless you rebalance depth."
    }
  };
}

function computeTradeValue(player, scoring) {
  const weekly = projectionForScoring(player, scoring);
  const roleBonus = (1 - player.volatility) * 5;
  const usageBonus = (player.targetShare || 0) * 14 + (player.opportunityShare || 0) * 8;
  const ceilingSpread = Math.max(player.ceiling - player.floor, 0) * 0.15;

  let positionWeight = 0;
  if (player.position === "QB") {
    positionWeight = 0.8;
  } else if (player.position === "RB") {
    positionWeight = scoring === "std" ? 2.0 : 1.2;
  } else if (player.position === "WR") {
    positionWeight = scoring === "ppr" ? 2.2 : 1.4;
  } else if (player.position === "TE") {
    positionWeight = 1.8;
  }

  return (
    player.marketValue * 0.64 +
    player.ros * 1.15 +
    weekly * 0.92 +
    roleBonus +
    usageBonus +
    ceilingSpread +
    positionWeight
  );
}

function optimizeLineup(rosterIds, scoring) {
  const rosterPlayers = rosterIds
    .map((id) => getCatalogPlayer(id))
    .filter(Boolean)
    .sort((a, b) => projectionForScoring(b, scoring) - projectionForScoring(a, scoring));

  const used = new Set();
  const lineup = [];

  addByPosition("QB", STARTER_FORMAT.QB, lineup, rosterPlayers, used, scoring);
  addByPosition("RB", STARTER_FORMAT.RB, lineup, rosterPlayers, used, scoring);
  addByPosition("WR", STARTER_FORMAT.WR, lineup, rosterPlayers, used, scoring);
  addByPosition("TE", STARTER_FORMAT.TE, lineup, rosterPlayers, used, scoring);

  const flex = rosterPlayers
    .filter((player) => !used.has(player.id) && ["RB", "WR", "TE"].includes(player.position))
    .sort((a, b) => projectionForScoring(b, scoring) - projectionForScoring(a, scoring))[0];
  if (flex) {
    used.add(flex.id);
    lineup.push({ slot: "FLEX", player: flex });
  }

  const points = sum(lineup.map((entry) => projectionForScoring(entry.player, scoring)));
  const ceiling = sum(lineup.map((entry) => entry.player.ceiling));
  const floor = sum(lineup.map((entry) => entry.player.floor));

  return {
    lineup,
    points: round(points, 2),
    ceiling: round(ceiling, 2),
    floor: round(floor, 2)
  };
}

function addByPosition(position, count, lineup, rosterPlayers, used, scoring) {
  const candidates = rosterPlayers
    .filter((player) => !used.has(player.id) && player.position === position)
    .sort((a, b) => projectionForScoring(b, scoring) - projectionForScoring(a, scoring))
    .slice(0, count);

  for (const player of candidates) {
    used.add(player.id);
    lineup.push({ slot: position, player });
  }
}

function computeVolatility(beforeLineup, afterLineup, incoming, outgoing, scoring) {
  const weightedBefore = weightedVolatility(beforeLineup, scoring);
  const weightedAfter = weightedVolatility(afterLineup, scoring);
  const incomingRisk = average(incoming.map((player) => player.volatility));
  const outgoingRisk = average(outgoing.map((player) => player.volatility));

  return {
    before: round(weightedBefore, 3),
    after: round(weightedAfter, 3),
    change: round(weightedAfter - weightedBefore, 3),
    incomingRisk: round(incomingRisk, 3),
    outgoingRisk: round(outgoingRisk, 3),
    labelBefore: riskLabel(weightedBefore),
    labelAfter: riskLabel(weightedAfter)
  };
}

function weightedVolatility(lineupEntries, scoring) {
  if (!lineupEntries.length) {
    return 0;
  }

  const totalProjection = sum(lineupEntries.map((entry) => projectionForScoring(entry.player, scoring)));
  if (!totalProjection) {
    return 0;
  }

  return (
    sum(
      lineupEntries.map(
        (entry) => entry.player.volatility * projectionForScoring(entry.player, scoring)
      )
    ) / totalProjection
  );
}

function riskLabel(score) {
  if (score >= 0.6) {
    return "High-beta";
  }
  if (score <= 0.48) {
    return "Low-beta";
  }
  return "Balanced";
}

function computeByeImpact(beforeLineup, afterLineup) {
  const before = byeConflictSummary(beforeLineup);
  const after = byeConflictSummary(afterLineup);
  const improvement = before.deadWeeks - after.deadWeeks;

  return {
    before,
    after,
    improvement,
    summary:
      improvement > 0
        ? "Trade reduces bye-week landmines in your projected starters."
        : improvement < 0
        ? "Trade introduces extra bye-week conflict risk."
        : "Bye-week conflict profile is mostly unchanged."
  };
}

function byeConflictSummary(lineupEntries) {
  const counts = {};
  for (const week of BYE_WEEKS) {
    counts[week] = 0;
  }

  for (const entry of lineupEntries) {
    const byeWeek = entry.player.byeWeek;
    if (counts[byeWeek] !== undefined) {
      counts[byeWeek] += 1;
    }
  }

  const deadWeeks = Object.values(counts).filter((count) => count >= 3).length;
  const tightWeeks = Object.values(counts).filter((count) => count === 2).length;
  const worstWeek = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  return {
    deadWeeks,
    tightWeeks,
    worstWeek: Number(worstWeek[0]),
    worstWeekCount: worstWeek[1]
  };
}

function computeRosterFit(beforeRoster, afterRoster, incoming, outgoing, scoring) {
  const beforeStrength = positionStrength(beforeRoster, scoring);
  const afterStrength = positionStrength(afterRoster, scoring);

  const weightedDelta =
    (afterStrength.QB - beforeStrength.QB) * 0.12 +
    (afterStrength.RB - beforeStrength.RB) * 0.28 +
    (afterStrength.WR - beforeStrength.WR) * 0.28 +
    (afterStrength.TE - beforeStrength.TE) * 0.16;

  const weakestBefore = Object.entries(beforeStrength)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([position]) => position);

  const needBonus = incoming.filter((player) => weakestBefore.includes(player.position)).length * 5;
  const redundancyPenalty =
    incoming.filter((player) => player.position === "QB").length > 0 && beforeStrength.QB > 35 ? 4 : 0;

  const rawScore = 50 + weightedDelta * 0.65 + needBonus - redundancyPenalty;
  const score = round(clamp(rawScore, 0, 100), 1);

  const strengths = Object.entries(afterStrength)
    .sort((a, b) => b[1] - a[1])
    .map(([position, value]) => `${position} ${round(value, 1)}`);

  return {
    score,
    weakestBefore,
    strengths,
    deltaByPosition: {
      QB: round(afterStrength.QB - beforeStrength.QB, 1),
      RB: round(afterStrength.RB - beforeStrength.RB, 1),
      WR: round(afterStrength.WR - beforeStrength.WR, 1),
      TE: round(afterStrength.TE - beforeStrength.TE, 1)
    }
  };
}

function positionStrength(rosterIds, scoring) {
  const roster = rosterIds.map((id) => getCatalogPlayer(id)).filter(Boolean);
  return {
    QB: topPositionSum(roster, "QB", 2, scoring),
    RB: topPositionSum(roster, "RB", 4, scoring),
    WR: topPositionSum(roster, "WR", 4, scoring),
    TE: topPositionSum(roster, "TE", 2, scoring)
  };
}

function topPositionSum(roster, position, count, scoring) {
  return sum(
    roster
      .filter((player) => player.position === position)
      .sort((a, b) => projectionForScoring(b, scoring) - projectionForScoring(a, scoring))
      .slice(0, count)
      .map((player) => projectionForScoring(player, scoring))
  );
}

function generateVerdict({
  userNetValue,
  accretionDelta,
  ceilingDelta,
  floorDelta,
  volatilityAfter,
  byeImprovement,
  rosterFitScore
}) {
  const compositeScore =
    userNetValue * 0.9 +
    accretionDelta * 1.6 +
    ceilingDelta * 0.25 +
    floorDelta * 0.35 +
    byeImprovement * 1.8 +
    (rosterFitScore - 50) * 0.4 -
    volatilityAfter * 3.5;

  const grade = gradeFromScore(compositeScore);
  const confidence = clamp(58 + Math.abs(compositeScore) * 1.5 - volatilityAfter * 8, 40, 95);

  let summary = "";
  if (compositeScore >= 8) {
    summary =
      "This trade improves your projected starters and aligns with roster construction needs. It is a clear accept if market sentiment is close.";
  } else if (compositeScore >= 1) {
    summary =
      "This is a mild positive. You gain structural value, but the edge is not large enough to overpay with extra picks or depth.";
  } else if (compositeScore >= -4) {
    summary =
      "This is close to neutral and mostly preference-driven. Negotiate for a small add-on before accepting.";
  } else {
    summary =
      "You are giving up too much relative lineup value or introducing avoidable risk. Decline unless league settings strongly favor your incoming side.";
  }

  return {
    grade,
    summary,
    confidence: round(confidence, 1),
    compositeScore: round(compositeScore, 2)
  };
}

function gradeFromScore(score) {
  if (score >= 18) return "A";
  if (score >= 12) return "A-";
  if (score >= 8) return "B+";
  if (score >= 4) return "B";
  if (score >= 1) return "B-";
  if (score >= -2) return "C";
  if (score >= -5) return "C-";
  if (score >= -9) return "D";
  return "F";
}

function renderAnalysis() {
  if (!state.analysis) {
    return;
  }

  const analysis = state.analysis;
  dom.resultsSection.classList.remove("hidden");

  const totalValue = analysis.valueA + analysis.valueB;
  const sideAPct = totalValue ? (analysis.valueA / totalValue) * 100 : 50;
  dom.valueBarInner.style.width = `${clamp(sideAPct, 4, 96)}%`;

  const winnerLabel =
    analysis.winningSide === "TIE"
      ? "Even"
      : analysis.winningSide === "A"
      ? "Team A edge"
      : "Team B edge";
  dom.freeSummary.innerHTML = `
    <p><strong>Raw Value:</strong> Team A ${analysis.valueA} vs Team B ${analysis.valueB} (${winnerLabel})</p>
    <p><strong>Your Side (${state.userSide}):</strong> incoming ${analysis.incomingValue} vs outgoing ${analysis.outgoingValue} (${signed(analysis.userNetValue)} delta)</p>
    <p><strong>Scoring Used:</strong> ${analysis.scoring.toUpperCase()}</p>
    <p><strong>Daily Free Remaining:</strong> ${state.proMode ? "Unlimited (Pro preview)" : getFreeRunsRemaining()}</p>
  `;

  dom.projectionRows.innerHTML = [...analysis.playersInTrade]
    .sort((a, b) => computeTradeValue(b, analysis.scoring) - computeTradeValue(a, analysis.scoring))
    .map(
      (player) => `
        <tr>
          <td>${player.name}</td>
          <td>${player.position}</td>
          <td>${round(projectionForScoring(player, analysis.scoring), 1)}</td>
          <td>${round(computeTradeValue(player, analysis.scoring), 1)}</td>
        </tr>
      `
    )
    .join("");

  if (!state.proMode) {
    dom.paywallCard.classList.remove("hidden");
    dom.paywallText.textContent = `Unlock the full report: projected championship odds delta ${signed(
      analysis.teasers.championshipOddsDelta
    )}% and roster-level risk profile.`;
    dom.proReport.classList.add("hidden");
    return;
  }

  dom.paywallCard.classList.add("hidden");
  dom.proReport.classList.remove("hidden");

  dom.proValueSummary.innerHTML = `
    <p>Incoming package value: <strong>${analysis.incomingValue}</strong></p>
    <p>Outgoing package value: <strong>${analysis.outgoingValue}</strong></p>
    <p>Net value delta: <strong>${signed(analysis.userNetValue)}</strong></p>
  `;

  dom.proAccretion.innerHTML = `
    <p>Starter points delta: <strong>${signed(analysis.accretion.points)}</strong> per week</p>
    <p>Ceiling delta: <strong>${signed(analysis.accretion.ceiling)}</strong></p>
    <p>Floor delta: <strong>${signed(analysis.accretion.floor)}</strong></p>
  `;

  dom.proVolatility.innerHTML = `
    <p>Before: <strong>${analysis.volatility.before}</strong> (${analysis.volatility.labelBefore})</p>
    <p>After: <strong>${analysis.volatility.after}</strong> (${analysis.volatility.labelAfter})</p>
    <p>Change: <strong>${signed(analysis.volatility.change)}</strong></p>
  `;

  dom.proByeImpact.innerHTML = `
    <p>Worst week before: <strong>W${analysis.byeImpact.before.worstWeek}</strong> (${analysis.byeImpact.before.worstWeekCount} starters on bye)</p>
    <p>Worst week after: <strong>W${analysis.byeImpact.after.worstWeek}</strong> (${analysis.byeImpact.after.worstWeekCount} starters on bye)</p>
    <p>${analysis.byeImpact.summary}</p>
  `;

  dom.proRosterFit.innerHTML = `
    <p>Roster fit score: <strong>${analysis.rosterFit.score}/100</strong></p>
    <p>Weakest positions before trade: <strong>${analysis.rosterFit.weakestBefore.join(", ")}</strong></p>
    <p>Delta by position: QB ${signed(analysis.rosterFit.deltaByPosition.QB)} | RB ${signed(
      analysis.rosterFit.deltaByPosition.RB
    )} | WR ${signed(analysis.rosterFit.deltaByPosition.WR)} | TE ${signed(
      analysis.rosterFit.deltaByPosition.TE
    )}</p>
  `;

  dom.verdictGrade.textContent = analysis.verdict.grade;
  dom.verdictSummary.textContent = analysis.verdict.summary;
  dom.verdictConfidence.textContent = `Model confidence: ${analysis.verdict.confidence}%`;
}

function projectionForScoring(player, scoring) {
  if (scoring === "std") {
    return player.projStd;
  }
  if (scoring === "half") {
    return (player.projStd + player.projPpr) / 2;
  }
  return player.projPpr;
}

function applyTradeToRoster(beforeRoster, outgoing, incoming) {
  const updated = new Set(beforeRoster);
  for (const player of outgoing) {
    updated.delete(player.id);
  }
  for (const player of incoming) {
    updated.add(player.id);
  }
  return [...updated];
}

function setStatus(message, level = "info") {
  dom.analysisStatus.textContent = message;
  dom.analysisStatus.dataset.level = level;
}

function updateFreeUsageUI() {
  const remaining = state.proMode ? "Unlimited" : String(getFreeRunsRemaining());
  dom.freeRemaining.textContent = remaining;
}

function getFreeUsage() {
  if (!state.freeUsage) {
    hydrateFreeUsage();
  }
  const today = getTodayIso();
  if (state.freeUsage.date !== today) {
    state.freeUsage = { date: today, count: 0 };
    try {
      localStorage.setItem(FREE_USAGE_STORAGE_KEY, JSON.stringify(state.freeUsage));
    } catch (_error) {
      // Non-fatal if storage is unavailable.
    }
  }
  return state.freeUsage;
}

function getFreeRunsRemaining() {
  const usage = getFreeUsage();
  return Math.max(FREE_DAILY_LIMIT - usage.count, 0);
}

function consumeFreeRun() {
  const usage = getFreeUsage();
  const next = {
    date: getTodayIso(),
    count: Math.min(usage.count + 1, FREE_DAILY_LIMIT)
  };
  state.freeUsage = next;
  try {
    localStorage.setItem(FREE_USAGE_STORAGE_KEY, JSON.stringify(next));
  } catch (_error) {
    // Non-fatal if storage is unavailable.
  }
}

function handleFeedbackSubmit(event) {
  event.preventDefault();
  const email = dom.feedbackEmail.value.trim();
  const notes = dom.feedbackNotes.value.trim();

  if (!notes) {
    dom.feedbackMessage.textContent = "Add notes before submitting feedback.";
    return;
  }

  const payload = {
    createdAt: new Date().toISOString(),
    email,
    notes,
    trade: {
      teamAGives: [...state.teamAGives],
      teamBGives: [...state.teamBGives],
      userSide: state.userSide,
      scoring: state.scoring,
      proMode: state.proMode
    },
    verdict: state.analysis ? state.analysis.verdict : null
  };

  const existing = getStoredFeedback();
  existing.push(payload);
  localStorage.setItem("fdl_beta_feedback", JSON.stringify(existing));

  dom.feedbackForm.reset();
  dom.feedbackMessage.textContent = `Feedback saved locally (${existing.length} total).`;
}

function getStoredFeedback() {
  try {
    const parsed = JSON.parse(localStorage.getItem("fdl_beta_feedback") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function downloadFeedback() {
  const feedback = getStoredFeedback();
  if (!feedback.length) {
    dom.feedbackMessage.textContent = "No feedback to export yet.";
    return;
  }

  const blob = new Blob([JSON.stringify(feedback, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fdl-beta-feedback-${getTodayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  dom.feedbackMessage.textContent = `Exported ${feedback.length} feedback entries.`;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentSleeperSeason(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 8 ? year : year - 1;
}

function buildPlayerNameIndex(players = []) {
  const index = new Map();
  for (const player of players) {
    const normalized = normalize(player.name);
    index.set(normalized, player.id);
    index.set(normalize(player.name.replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "").trim()), player.id);
  }
  return index;
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}
