import {
  bindConnectButton,
  connectSleeperByUsername,
  currentSleeperSeason,
  fetchSleeperJSON,
  getSleeperSession,
  hydrateHeader,
  renderConnectButton,
  setLeagueIntelContext,
  setSleeperSession,
  updateSelectedLeague
} from "./site_state.js";
import { clamp, dedupe, escapeHtml, round, signed } from "./utils.js";
import {
  buildAdversarialIntelReport,
  collectSleeperPlayerIdsFromSeasonData,
  fetchLeagueHistoryChain,
  fetchLeagueSeasonData,
  mergeRosterContext
} from "./intel_engine.js";

const dom = {
  gate: document.querySelector("#intel-gate"),
  content: document.querySelector("#intel-content"),
  connectForm: document.querySelector("#intel-connect-form"),
  username: document.querySelector("#intel-username"),
  season: document.querySelector("#intel-season"),
  connectBtn: document.querySelector("#intel-connect-btn"),
  gateStatus: document.querySelector("#intel-gate-status"),
  leagueSelect: document.querySelector("#intel-league-select"),
  lookback: document.querySelector("#intel-lookback"),
  refreshBtn: document.querySelector("#intel-refresh-btn"),
  status: document.querySelector("#intel-status"),
  summary: document.querySelector("#intel-summary"),
  grid: document.querySelector("#intel-manager-grid"),
  detailSection: document.querySelector("#intel-detail-section"),
  detailTitle: document.querySelector("#intel-detail-title"),
  detailSubhead: document.querySelector("#intel-detail-subhead"),
  overviewCards: document.querySelector("#intel-overview-cards"),
  rosterBars: document.querySelector("#intel-roster-bars"),
  rosterMeta: document.querySelector("#intel-roster-meta"),
  faabStats: document.querySelector("#intel-faab-stats"),
  faabPredictor: document.querySelector("#intel-faab-predictor"),
  tradePattern: document.querySelector("#intel-trade-pattern"),
  tradeTimeline: document.querySelector("#intel-trade-timeline"),
  backBtn: document.querySelector("#intel-back-btn")
};

const state = {
  session: null,
  selectedLeagueId: "",
  lookback: 2,
  seasonData: [],
  report: null,
  detailManagerId: "",
  sleeperPlayersById: null
};

initialize();

async function initialize() {
  hydrateHeader("intel");
  bindConnectButton({
    onConnected: async (session) => {
      state.session = session;
      setGateVisible(false);
      await loadIntel();
    },
    onDisconnected: () => {
      state.session = null;
      setGateVisible(true);
      setStatus("Sleeper disconnected.", "info");
    }
  });

  wireEvents();

  dom.season.value = String(currentSleeperSeason());
  const query = readQueryState();
  if (query.lookback) {
    state.lookback = query.lookback;
    dom.lookback.value = String(query.lookback);
  }

  const session = getSleeperSession();
  if (!session) {
    setGateVisible(true);
    setGateStatus("Connect Sleeper to unlock League Intel.", "info");
    return;
  }

  state.session = session;
  setGateVisible(false);
  await loadIntel();
}

function wireEvents() {
  dom.connectForm?.addEventListener("submit", onGateConnect);
  dom.leagueSelect?.addEventListener("change", async (event) => {
    state.selectedLeagueId = String(event.target.value || "");
    updateSelectedLeague(state.selectedLeagueId);
    syncQueryState();
    await loadIntel();
  });
  dom.lookback?.addEventListener("change", async (event) => {
    state.lookback = clamp(Number(event.target.value) || 2, 1, 4);
    syncQueryState();
    await loadIntel();
  });
  dom.refreshBtn?.addEventListener("click", loadIntel);
  dom.grid?.addEventListener("click", onManagerGridClick);
  dom.backBtn?.addEventListener("click", () => {
    state.detailManagerId = "";
    syncQueryState();
    renderDetail();
  });
}

async function onGateConnect(event) {
  event.preventDefault();
  const username = String(dom.username?.value || "").trim();
  const season = Number(dom.season?.value || currentSleeperSeason());
  if (!username) {
    setGateStatus("Enter a Sleeper username first.", "error");
    return;
  }

  dom.connectBtn.disabled = true;
  dom.connectBtn.textContent = "Connecting...";
  setGateStatus("Connecting...", "info");

  try {
    const session = await connectSleeperByUsername(username, season);
    state.session = session;
    state.lookback = clamp(Number(dom.lookback.value) || 2, 1, 4);
    renderConnectButton();
    setGateVisible(false);
    setGateStatus("", "info");
    await loadIntel();
  } catch (error) {
    setGateStatus(error.message, "error");
  } finally {
    dom.connectBtn.disabled = false;
    dom.connectBtn.textContent = "Connect";
  }
}

function setGateVisible(show) {
  dom.gate.classList.toggle("hidden", !show);
  dom.content.classList.toggle("hidden", show);
}

function setGateStatus(message, level = "info") {
  dom.gateStatus.textContent = message;
  dom.gateStatus.dataset.level = level;
}

function setStatus(message, level = "info") {
  dom.status.textContent = message;
  dom.status.dataset.level = level;
}

async function loadIntel() {
  if (!state.session) return;
  try {
    setStatus("Loading league intelligence...", "info");
    dom.refreshBtn.disabled = true;

    await refreshSessionLeagues();
    renderLeagueOptions();

    if (!state.selectedLeagueId) {
      setStatus("No leagues found for this Sleeper account/season.", "error");
      dom.grid.innerHTML = `<p class="chip-empty">No leagues available. Try another season.</p>`;
      return;
    }

    const leagueChain = await fetchLeagueHistoryChainForIntel(state.selectedLeagueId, state.lookback);
    state.seasonData = await fetchLeagueSeasonDataForIntel(leagueChain);
    state.report = await buildIntelReport(state.seasonData, state.session.user_id);

    renderManagerGrid();

    const query = readQueryState();
    state.detailManagerId = query.manager || "";
    renderDetail();
    publishIntelContext();

    setStatus(
      `Computed intel for ${state.report.managers.length} managers across ${state.report.summary.seasonsAnalyzed} season(s).`,
      "success"
    );
  } catch (error) {
    setStatus(`League intel failed: ${error.message}`, "error");
  } finally {
    dom.refreshBtn.disabled = false;
  }
}

async function refreshSessionLeagues() {
  const session = state.session;
  if (!session) return;

  const leagues = await fetchSleeperJSON(`/user/${encodeURIComponent(session.user_id)}/leagues/nfl/${session.season}`);
  session.leagues = Array.isArray(leagues)
    ? leagues
        .map((league) => ({
          league_id: String(league.league_id || ""),
          name: league.name || "Sleeper League",
          season: Number(league.season || session.season),
          total_rosters: Number(league.total_rosters || 0),
          previous_league_id: league.previous_league_id || ""
        }))
        .sort((a, b) => (b.total_rosters || 0) - (a.total_rosters || 0))
    : [];

  const query = readQueryState();
  const candidate = query.league || session.selected_league_id || session.leagues[0]?.league_id || "";
  state.selectedLeagueId = session.leagues.some((item) => item.league_id === candidate)
    ? candidate
    : session.leagues[0]?.league_id || "";

  session.selected_league_id = state.selectedLeagueId;
  setSleeperSession(session);
}

function renderLeagueOptions() {
  const leagues = state.session?.leagues || [];
  dom.leagueSelect.innerHTML =
    `<option value="">Select league...</option>` +
    leagues
      .map(
        (league) =>
          `<option value="${escapeHtml(league.league_id)}" ${
            league.league_id === state.selectedLeagueId ? "selected" : ""
          }>${escapeHtml(league.name)} (${league.total_rosters || "?"} teams)</option>`
      )
      .join("");
}

async function fetchLeagueHistoryChainForIntel(startLeagueId, maxSeasons) {
  return fetchLeagueHistoryChain(startLeagueId, maxSeasons, fetchSleeperJSON);
}

async function fetchLeagueSeasonDataForIntel(leagues) {
  return fetchLeagueSeasonData(leagues, fetchSleeperJSON, {
    cacheNamespace: "league_intel"
  });
}

async function buildIntelReport(seasonData, myUserId) {
  const referencedPlayerIds = collectSleeperPlayerIdsFromSeasonData(seasonData);
  state.sleeperPlayersById = await loadSleeperPlayerCatalog(referencedPlayerIds);
  const report = buildAdversarialIntelReport(seasonData, myUserId, state.sleeperPlayersById, {
    profileTone: "intel",
    includeTradeTimeline: true
  });
  mergeRosterContext(report, seasonData[0], state.sleeperPlayersById);
  return report;
}

async function loadSleeperPlayerCatalog(requestedIds = []) {
  const requested = dedupe((requestedIds || []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!requested.length) {
    return state.sleeperPlayersById || {};
  }

  if (!state.sleeperPlayersById) {
    state.sleeperPlayersById = {};
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
    throw new Error(`Could not load Sleeper player subset (HTTP ${response.status}).`);
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
  return state.sleeperPlayersById;
}

function renderManagerGrid() {
  if (!state.report || !state.report.managers.length) {
    dom.summary.textContent = "No managers available.";
    dom.grid.innerHTML = `<p class="chip-empty">No manager data available for this league.</p>`;
    return;
  }

  dom.summary.textContent = `${state.report.summary.managersAnalyzed} managers · ${state.report.summary.totalTransactions} transactions analyzed`;

  dom.grid.innerHTML = state.report.managers
    .map((manager) => {
      return `
        <article class="manager-card">
          <div class="manager-card-head">
            <h3>${escapeHtml(manager.displayName)}${manager.isYou ? " (You)" : ""}</h3>
            <span class="window-tag window-${escapeHtml(manager.windowTag.toLowerCase())}">${escapeHtml(manager.windowTag)}</span>
          </div>

          <p class="manager-style">"${escapeHtml(manager.profileLabel)}"</p>

          <div class="manager-bar-row">
            <span>Aggression</span>
            <div class="manager-bar-track"><div class="manager-bar-fill" style="width:${clamp(manager.aggressionScore, 1, 100)}%"></div></div>
            <strong>${round(manager.aggressionScore / 10, 1)}</strong>
          </div>

          <div class="manager-bar-row">
            <span>Trade Friendly</span>
            <div class="manager-bar-track"><div class="manager-bar-fill alt" style="width:${clamp(
              manager.tradeFriendlinessScore * 10,
              1,
              100
            )}%"></div></div>
            <strong>${manager.tradeFriendlinessScore}</strong>
          </div>

          <p class="manager-weakness">Weak: ${escapeHtml(manager.weakPositions.join(", "))}</p>
          <p class="manager-targeting">${escapeHtml(manager.targetingCue)}</p>

          <button class="secondary-btn manager-scout-btn" type="button" data-manager-id="${escapeHtml(manager.userId)}">Scout →</button>
        </article>
      `;
    })
    .join("");
}

function onManagerGridClick(event) {
  const button = event.target.closest("button[data-manager-id]");
  if (!button) return;
  state.detailManagerId = String(button.dataset.managerId || "");
  syncQueryState();
  renderDetail();
}

function renderDetail() {
  if (!state.report || !state.detailManagerId) {
    dom.detailSection.classList.add("hidden");
    publishIntelContext();
    return;
  }

  const manager = state.report.managers.find((item) => item.userId === state.detailManagerId);
  if (!manager) {
    dom.detailSection.classList.add("hidden");
    publishIntelContext();
    return;
  }

  dom.detailSection.classList.remove("hidden");
  dom.detailTitle.textContent = `Scouting Report: ${manager.displayName}`;
  dom.detailSubhead.textContent = `${activeLeagueName()} · ${state.lookback} season lookback`;

  dom.overviewCards.innerHTML = `
    ${renderScoreCard("Aggression", `${round(manager.aggressionScore / 10, 1)}/10`, manager.aggressionScore)}
    ${renderScoreCard("Trade Friendly", `${manager.tradeFriendlinessScore}/10`, manager.tradeFriendlinessScore * 10)}
    ${renderScoreCard("Risk Tolerance", `${manager.riskToleranceScore}/10`, manager.riskToleranceScore * 10)}
  `;

  renderRosterComposition(manager);
  renderFaabSection(manager);
  renderTradeSection(manager);
  publishIntelContext();
}

function publishIntelContext() {
  const summary = state.report?.summary || null;
  const selectedManager = state.report?.managers?.find((item) => item.userId === state.detailManagerId) || null;
  const managers = Array.isArray(state.report?.managers) ? state.report.managers : [];
  const topAggression = [...managers]
    .filter((manager) => !manager.isYou)
    .sort((a, b) => Number(b.aggressionScore || 0) - Number(a.aggressionScore || 0))
    .slice(0, 3)
    .map((manager) => ({
      display_name: manager.displayName,
      aggression_score: Number(manager.aggressionScore || 0),
      weak_positions: Array.isArray(manager.weakPositions) ? manager.weakPositions : []
    }));

  setLeagueIntelContext({
    league_id: state.selectedLeagueId,
    league_name: activeLeagueName(),
    lookback: Number(state.lookback || 2),
    managers_analyzed: Number(summary?.managersAnalyzed || managers.length || 0),
    seasons_analyzed: Number(summary?.seasonsAnalyzed || 0),
    total_transactions: Number(summary?.totalTransactions || 0),
    selected_manager: selectedManager
      ? {
          user_id: selectedManager.userId,
          display_name: selectedManager.displayName,
          profile_label: selectedManager.profileLabel,
          weak_positions: Array.isArray(selectedManager.weakPositions) ? selectedManager.weakPositions : [],
          targeting_cue: selectedManager.targetingCue || "",
          trade_pattern: selectedManager.tradePattern || null
        }
      : null,
    top_aggressive_managers: topAggression
  });
}

function renderScoreCard(label, value, pct) {
  return `
    <article class="intel-score-card">
      <p class="kpi-label">${escapeHtml(label)}</p>
      <p class="kpi-value">${escapeHtml(value)}</p>
      <div class="manager-bar-track"><div class="manager-bar-fill" style="width:${clamp(pct, 1, 100)}%"></div></div>
    </article>
  `;
}

function renderRosterComposition(manager) {
  const positions = ["QB", "RB", "WR", "TE"];
  dom.rosterBars.innerHTML = positions
    .map((position) => {
      const entry = manager.positionStrengths?.[position] || { ratio: 0, label: "Average" };
      const pct = clamp(entry.ratio * 100, 1, 100);
      const tone = entry.label === "WEAK" ? "weak" : entry.label === "Elite" ? "elite" : "";
      return `
        <div class="roster-bar-row">
          <span>${position}</span>
          <div class="manager-bar-track"><div class="manager-bar-fill ${tone}" style="width:${pct}%"></div></div>
          <strong>${escapeHtml(entry.label)}</strong>
        </div>
      `;
    })
    .join("");

  dom.rosterMeta.innerHTML = `
    ${metadataItem("Avg Roster Age", manager.avgRosterAge)}
    ${metadataItem("Projected Starter Value", `${Number(manager.starterValue || 0).toLocaleString()} KTC`) }
    ${metadataItem("Weak Positions", manager.weakPositions.join(", "))}
  `;
}

function renderFaabSection(manager) {
  const predictor = buildFaabPredictor(manager);
  dom.faabStats.innerHTML = `
    ${metadataItem("Avg Bid", `$${round(manager.avgFaabBid, 1)}`)}
    ${metadataItem("Max Bid", `$${round(manager.maxFaabBid, 0)}`)}
    ${metadataItem("Avg Bid % Budget", `${round(manager.faabBidPct, 1)}%`)}
    ${metadataItem("FAAB Remaining", `$${round(manager.faabRemaining || 0, 0)}`)}
  `;

  dom.faabPredictor.innerHTML = `
    <p><strong>Predicted bid:</strong> $${predictor.low} - $${predictor.high}</p>
    <p><strong>Confidence:</strong> ${predictor.confidence}</p>
    <p>${escapeHtml(predictor.reasoning)}</p>
  `;
}

function buildFaabPredictor(manager) {
  const base = Number(manager.avgFaabBid || 8);
  const spread = Math.max(2, Math.round(base * (0.2 + manager.aggressionScore / 180)));
  const low = Math.max(1, Math.round(base - spread * 0.5));
  const high = Math.max(low + 1, Math.round(base + spread));
  const confidence = manager.waiverCount >= 18 ? "High" : manager.waiverCount >= 8 ? "Medium" : "Low";
  const reasoning = `Needs at ${manager.weakPositions.join(", ")}, style "${manager.profileLabel}", and aggression ${round(
    manager.aggressionScore / 10,
    1
  )}/10 suggest a ${confidence.toLowerCase()} confidence bid range.`;
  return { low, high, confidence, reasoning };
}

function renderTradeSection(manager) {
  const pattern = manager.tradePattern || { buys: "N/A", sells: "N/A", avoids: "N/A" };
  dom.tradePattern.innerHTML = `
    ${metadataItem("Trades Completed", manager.tradeCount)}
    ${metadataItem("Most Active Position", manager.topPositionAdds || "N/A")}
    ${metadataItem("Buys", pattern.buys)}
    ${metadataItem("Sells", pattern.sells)}
    ${metadataItem("Avoids", pattern.avoids)}
  `;

  const entries = manager.tradeTimeline || [];
  if (!entries.length) {
    dom.tradeTimeline.innerHTML = `<p class="chip-empty">No recent trade timeline available for this lookback window.</p>`;
    return;
  }

  dom.tradeTimeline.innerHTML = entries
    .slice(0, 5)
    .map((entry) => {
      const win = Number(entry.delta) >= 0;
      return `
        <div class="trade-event-row">
          <div class="trade-event-date">${escapeHtml(entry.dateLabel)}</div>
          <div class="trade-event-copy">
            <p>${escapeHtml(entry.summary)}</p>
            <p class="${win ? "good" : "bad"}">${win ? "✓" : "✕"} Value delta ${signed(entry.delta)}</p>
          </div>
        </div>
      `;
    })
    .join("");
}

function metadataItem(label, value) {
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value ?? "-"))}</p>`;
}

function readQueryState() {
  const params = new URLSearchParams(window.location.search);
  const lookback = clamp(Number(params.get("lookback") || 2), 1, 4);
  return {
    league: String(params.get("league") || ""),
    manager: String(params.get("manager") || ""),
    lookback
  };
}

function syncQueryState() {
  const params = new URLSearchParams();
  if (state.selectedLeagueId) params.set("league", state.selectedLeagueId);
  if (state.detailManagerId) params.set("manager", state.detailManagerId);
  params.set("lookback", String(state.lookback));
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, "", next);
}

function activeLeagueName() {
  const league = (state.session?.leagues || []).find((item) => item.league_id === state.selectedLeagueId);
  return league?.name || "Sleeper League";
}
