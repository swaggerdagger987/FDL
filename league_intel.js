import {
  bindConnectButton,
  connectSleeperByUsername,
  currentSleeperSeason,
  fetchSleeperJSON,
  getSleeperSession,
  hydrateHeader,
  renderConnectButton,
  setSleeperSession,
  updateSelectedLeague
} from "./site_state.js";

const SLEEPER_REGULAR_SEASON_WEEKS = 18;

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

    const leagueChain = await fetchLeagueHistoryChain(state.selectedLeagueId, state.lookback);
    state.seasonData = await fetchLeagueSeasonData(leagueChain);
    state.sleeperPlayersById = await loadSleeperPlayerCatalog();
    state.report = buildAdversarialIntelReport(state.seasonData, state.session.user_id, state.sleeperPlayersById);
    mergeRosterContext(state.report, state.seasonData[0], state.sleeperPlayersById);

    renderManagerGrid();

    const query = readQueryState();
    state.detailManagerId = query.manager || "";
    renderDetail();

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

async function fetchLeagueHistoryChain(startLeagueId, maxSeasons) {
  const seen = new Set();
  const chain = [];
  let currentId = String(startLeagueId || "");
  let depth = 0;

  while (currentId && !seen.has(currentId) && depth < maxSeasons) {
    seen.add(currentId);
    const league = await fetchSleeperJSON(`/league/${currentId}`);
    chain.push(league);
    currentId = league.previous_league_id || "";
    depth += 1;
  }

  return chain;
}

async function fetchLeagueSeasonData(leagues) {
  const results = [];
  for (const league of leagues) {
    const [users, rosters, transactions] = await Promise.all([
      fetchSleeperJSON(`/league/${league.league_id}/users`),
      fetchSleeperJSON(`/league/${league.league_id}/rosters`),
      fetchAllTransactionsForLeague(league.league_id)
    ]);
    results.push({
      league,
      users: Array.isArray(users) ? users : [],
      rosters: Array.isArray(rosters) ? rosters : [],
      transactions: Array.isArray(transactions) ? transactions : []
    });
  }
  return results;
}

async function fetchAllTransactionsForLeague(leagueId) {
  const weeks = Array.from({ length: SLEEPER_REGULAR_SEASON_WEEKS }, (_, index) => index + 1);
  const byWeek = await Promise.all(
    weeks.map(async (week) => {
      try {
        const transactions = await fetchSleeperJSON(`/league/${leagueId}/transactions/${week}`);
        if (!Array.isArray(transactions)) return [];
        return transactions.map((item) => ({ ...item, _week: week }));
      } catch (error) {
        return [];
      }
    })
  );
  return byWeek.flat();
}

async function loadSleeperPlayerCatalog() {
  if (state.sleeperPlayersById) return state.sleeperPlayersById;
  const payload = await fetchSleeperJSON("/players/nfl");
  if (!payload || typeof payload !== "object") throw new Error("Could not load Sleeper player catalog.");
  state.sleeperPlayersById = payload;
  return payload;
}

function buildAdversarialIntelReport(seasonData, myUserId, sleeperPlayersById) {
  const managerMap = new Map();
  let totalTransactions = 0;
  let totalWaivers = 0;
  let totalTrades = 0;

  for (const season of seasonData) {
    const ownerByRosterId = {};
    const displayByUserId = {};
    const waiverBudget = Number(season.league?.settings?.waiver_budget) || 100;

    for (const user of season.users) {
      displayByUserId[String(user.user_id)] = user.display_name || user.username || `user-${user.user_id}`;
    }
    for (const roster of season.rosters) {
      ownerByRosterId[String(roster.roster_id)] = String(roster.owner_id || "");
      ensureManager(managerMap, String(roster.owner_id || ""), displayByUserId[String(roster.owner_id || "")]);
    }

    for (const transaction of season.transactions) {
      if (!isCompletedTransaction(transaction)) continue;
      totalTransactions += 1;

      const type = String(transaction.type || "unknown").toLowerCase();
      if (type === "waiver") totalWaivers += 1;
      if (type === "trade") totalTrades += 1;

      const participantRosterIds = dedupe([
        ...(Array.isArray(transaction.roster_ids) ? transaction.roster_ids : []),
        ...(Array.isArray(transaction.consenter_ids) ? transaction.consenter_ids : []),
        transaction.creator
      ]).filter((id) => id !== undefined && id !== null);

      const participantUserIds = dedupe(
        participantRosterIds.map((rosterId) => ownerByRosterId[String(rosterId)] || String(rosterId || "")).filter(Boolean)
      );

      for (const userId of participantUserIds) {
        const manager = ensureManager(managerMap, userId, displayByUserId[userId]);
        manager.seasons.add(String(season.league?.season || ""));
        manager.totalTransactions += 1;
      }

      if (type === "waiver" || type === "free_agent") {
        const bid = Number(transaction.settings?.waiver_bid) || 0;
        for (const userId of participantUserIds) {
          const manager = ensureManager(managerMap, userId, displayByUserId[userId]);
          manager.waiverCount += 1;
          if (bid > 0) {
            manager.faabBidSum += bid;
            manager.faabBidCount += 1;
            manager.faabMaxBid = Math.max(manager.faabMaxBid, bid);
            manager.faabBudgetObserved = Math.max(manager.faabBudgetObserved, waiverBudget);
          }
        }
      }

      if (type === "trade") {
        for (const userId of participantUserIds) {
          const manager = ensureManager(managerMap, userId, displayByUserId[userId]);
          manager.tradeCount += 1;
          for (const counterpart of participantUserIds) {
            if (counterpart === userId) continue;
            manager.counterparties[counterpart] = (manager.counterparties[counterpart] || 0) + 1;
          }
        }
      }

      const adds = transaction.adds || {};
      const drops = transaction.drops || {};
      applyRosterMoveMetrics(adds, "add", ownerByRosterId, displayByUserId, managerMap, sleeperPlayersById);
      applyRosterMoveMetrics(drops, "drop", ownerByRosterId, displayByUserId, managerMap, sleeperPlayersById);

      if (type === "trade") {
        pushTradeTimelineEvent(transaction, season.league, participantUserIds, ownerByRosterId, displayByUserId, managerMap, sleeperPlayersById);
      }
    }
  }

  const managers = [...managerMap.values()].map((manager) => finalizeManagerProfile(manager, myUserId));
  const maxRaw = Math.max(...managers.map((item) => item.aggressionRaw), 1);
  for (const manager of managers) {
    manager.aggressionScore = round((manager.aggressionRaw / maxRaw) * 100, 1);
  }
  managers.sort((a, b) => b.aggressionScore - a.aggressionScore);

  return {
    summary: {
      seasonsAnalyzed: seasonData.length,
      totalTransactions,
      totalWaivers,
      totalTrades,
      managersAnalyzed: managers.length
    },
    managers
  };
}

function ensureManager(map, userId, displayName = "") {
  const key = String(userId || "");
  if (!key) return emptyManager();
  if (!map.has(key)) {
    map.set(key, {
      userId: key,
      displayName: displayName || `Manager ${key.slice(0, 4)}`,
      seasons: new Set(),
      totalTransactions: 0,
      waiverCount: 0,
      tradeCount: 0,
      faabBidSum: 0,
      faabBidCount: 0,
      faabMaxBid: 0,
      faabBudgetObserved: 100,
      draftPickMoves: 0,
      addCount: 0,
      dropCount: 0,
      positionAdds: {},
      positionDrops: {},
      counterparties: {},
      tradeTimeline: []
    });
  }

  const manager = map.get(key);
  if (displayName) manager.displayName = displayName;
  return manager;
}

function emptyManager() {
  return {
    userId: "",
    displayName: "Unknown",
    seasons: new Set(),
    totalTransactions: 0,
    waiverCount: 0,
    tradeCount: 0,
    faabBidSum: 0,
    faabBidCount: 0,
    faabMaxBid: 0,
    faabBudgetObserved: 100,
    draftPickMoves: 0,
    addCount: 0,
    dropCount: 0,
    positionAdds: {},
    positionDrops: {},
    counterparties: {},
    tradeTimeline: []
  };
}

function applyRosterMoveMetrics(moves, mode, ownerByRosterId, displayByUserId, managerMap, sleeperPlayersById) {
  for (const [sleeperPlayerId, rosterId] of Object.entries(moves || {})) {
    const ownerId = ownerByRosterId[String(rosterId)];
    if (!ownerId) continue;
    const manager = ensureManager(managerMap, ownerId, displayByUserId[ownerId]);
    if (mode === "add") manager.addCount += 1;
    if (mode === "drop") manager.dropCount += 1;

    const player = sleeperPlayersById[sleeperPlayerId];
    const position = normalizeSleeperPosition(player?.position);
    if (!position) continue;
    if (mode === "add") {
      manager.positionAdds[position] = (manager.positionAdds[position] || 0) + 1;
    } else {
      manager.positionDrops[position] = (manager.positionDrops[position] || 0) + 1;
    }
  }
}

function pushTradeTimelineEvent(
  transaction,
  league,
  participantUserIds,
  ownerByRosterId,
  displayByUserId,
  managerMap,
  sleeperPlayersById
) {
  const timestamp = Number(transaction.status_updated || transaction.created || 0);
  const week = Number(transaction._week || 0);
  const season = Number(league?.season || 0);

  for (const userId of participantUserIds) {
    const manager = ensureManager(managerMap, userId, displayByUserId[userId]);
    const summary = summarizeTradeForManager({
      transaction,
      season,
      week,
      managerUserId: userId,
      ownerByRosterId,
      displayByUserId,
      sleeperPlayersById
    });
    manager.tradeTimeline.push(summary);
  }
}

function summarizeTradeForManager({
  transaction,
  season,
  week,
  managerUserId,
  ownerByRosterId,
  displayByUserId,
  sleeperPlayersById
}) {
  const managerRosterIds = new Set(
    Object.entries(ownerByRosterId)
      .filter(([, ownerId]) => String(ownerId) === String(managerUserId))
      .map(([rosterId]) => String(rosterId))
  );

  const adds = transaction.adds || {};
  const drops = transaction.drops || {};

  const receivedPlayers = Object.entries(adds)
    .filter(([, rosterId]) => managerRosterIds.has(String(rosterId)))
    .map(([playerId]) => playerId);
  const sentPlayers = Object.entries(drops)
    .filter(([, rosterId]) => managerRosterIds.has(String(rosterId)))
    .map(([playerId]) => playerId);

  const receivedValue = receivedPlayers.reduce((sum, playerId) => sum + estimateSleeperPlayerValue(sleeperPlayersById[playerId]), 0);
  const sentValue = sentPlayers.reduce((sum, playerId) => sum + estimateSleeperPlayerValue(sleeperPlayersById[playerId]), 0);

  const participantUserIds = dedupe(
    [...(transaction.roster_ids || []), ...(transaction.consenter_ids || []), transaction.creator]
      .map((rosterId) => ownerByRosterId[String(rosterId)] || String(rosterId || ""))
      .filter(Boolean)
  );
  const counterpartNames = participantUserIds
    .filter((userId) => String(userId) !== String(managerUserId))
    .map((userId) => displayByUserId[String(userId)] || `user-${userId}`);

  const delta = round(receivedValue - sentValue, 0);
  const dateLabel = season && week ? `${season} W${week}` : "Trade";
  const summary = `Sent ${sentPlayers.length} · Received ${receivedPlayers.length} vs ${counterpartNames.join(", ") || "league"}`;

  return {
    timestamp: Number(transaction.status_updated || 0),
    dateLabel,
    summary,
    delta
  };
}

function finalizeManagerProfile(manager, myUserId) {
  const avgBid = manager.faabBidCount ? manager.faabBidSum / manager.faabBidCount : 0;
  const maxBudget = manager.faabBudgetObserved || 100;
  const avgBidPct = maxBudget ? avgBid / maxBudget : 0;
  const totalMoves = manager.addCount + manager.dropCount;
  const counterparties = Object.entries(manager.counterparties).sort((a, b) => b[1] - a[1]);
  const counterpartyCount = counterparties.length;

  const aggressionRaw =
    manager.tradeCount * 2.4 +
    manager.waiverCount * 1.1 +
    manager.draftPickMoves * 1.5 +
    avgBidPct * 35 +
    totalMoves * 0.08;

  const topPosition = topKey(manager.positionAdds) || "N/A";
  const profileLabel = labelFromManagerTraits(manager.tradeCount, avgBidPct, totalMoves);
  const targetingCue = buildTargetingCue(profileLabel, topPosition, manager.tradeCount);
  const tradeFriendlinessScore = round(clamp((manager.tradeCount * 1.7 + counterpartyCount * 2.4) / 3, 1, 10), 1);
  const riskToleranceScore = round(clamp((avgBidPct * 50 + manager.tradeCount * 0.8 + totalMoves * 0.04), 1, 10), 1);

  return {
    userId: manager.userId,
    displayName: manager.displayName,
    isYou: String(manager.userId) === String(myUserId),
    seasonsCovered: manager.seasons.size,
    totalTransactions: manager.totalTransactions,
    waiverCount: manager.waiverCount,
    tradeCount: manager.tradeCount,
    avgFaabBid: round(avgBid, 1),
    maxFaabBid: manager.faabMaxBid,
    faabBidPct: round(avgBidPct * 100, 1),
    addCount: manager.addCount,
    dropCount: manager.dropCount,
    topPositionAdds: topPosition,
    profileLabel,
    aggressionRaw,
    aggressionScore: 0,
    tradeFriendlinessScore,
    riskToleranceScore,
    targetingCue,
    counterpartyCount,
    tradeTimeline: manager.tradeTimeline.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8)
  };
}

function mergeRosterContext(report, latestSeasonData, sleeperPlayersById) {
  const rosterContextByUser = buildRosterContextMap(latestSeasonData, sleeperPlayersById);
  for (const manager of report.managers) {
    const context = rosterContextByUser[manager.userId] || defaultRosterContext();
    manager.windowTag = context.windowTag;
    manager.weakPositions = context.weakPositions;
    manager.positionStrengths = context.positionStrengths;
    manager.avgRosterAge = context.avgRosterAge;
    manager.starterValue = context.starterValue;
    manager.faabRemaining = context.faabRemaining;
    manager.tradePattern = deriveTradePattern(manager);
  }
}

function buildRosterContextMap(seasonData, sleeperPlayersById) {
  if (!seasonData) return {};
  const result = {};
  const leagueBudget = Number(seasonData.league?.settings?.waiver_budget) || 100;
  const expectedDepth = { QB: 3, RB: 6, WR: 7, TE: 3 };

  for (const roster of seasonData.rosters || []) {
    const ownerId = String(roster.owner_id || "");
    if (!ownerId) continue;
    const playerIds = dedupe([...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || [])]);
    const grouped = { QB: [], RB: [], WR: [], TE: [] };
    let ageSum = 0;
    let ageCount = 0;

    for (const playerId of playerIds) {
      const player = sleeperPlayersById[playerId];
      const position = normalizeSleeperPosition(player?.position);
      if (grouped[position]) {
        grouped[position].push(player);
      }
      const age = inferPlayerAge(player);
      if (Number.isFinite(age)) {
        ageSum += age;
        ageCount += 1;
      }
    }

    const strengths = {};
    const weakest = [];
    for (const [position, expected] of Object.entries(expectedDepth)) {
      const count = grouped[position].length;
      const ratio = expected ? count / expected : 0;
      const label = ratio >= 1.2 ? "Elite" : ratio >= 0.95 ? "Strong" : ratio >= 0.75 ? "Average" : "WEAK";
      strengths[position] = {
        count,
        ratio: round(ratio, 2),
        label
      };
      weakest.push({ position, ratio });
    }
    weakest.sort((a, b) => a.ratio - b.ratio);

    const starterValue = round(
      topPositionValue(grouped.QB, 1) +
        topPositionValue(grouped.RB, 2) +
        topPositionValue(grouped.WR, 2) +
        topPositionValue(grouped.TE, 1),
      0
    );

    const avgRosterAge = ageCount ? round(ageSum / ageCount, 1) : 26.0;
    const usedBudget = Number(roster.settings?.waiver_budget_used || 0);
    const faabRemaining = clamp(leagueBudget - usedBudget, 0, leagueBudget);

    result[ownerId] = {
      positionStrengths: strengths,
      weakPositions: weakest.slice(0, 2).map((item) => item.position),
      avgRosterAge,
      starterValue,
      faabRemaining,
      windowTag: deriveWindowTag(avgRosterAge, starterValue)
    };
  }

  return result;
}

function defaultRosterContext() {
  return {
    positionStrengths: {
      QB: { count: 0, ratio: 0, label: "Average" },
      RB: { count: 0, ratio: 0, label: "Average" },
      WR: { count: 0, ratio: 0, label: "Average" },
      TE: { count: 0, ratio: 0, label: "Average" }
    },
    weakPositions: ["RB", "TE"],
    avgRosterAge: 26.0,
    starterValue: 30000,
    faabRemaining: 50,
    windowTag: "Competitive"
  };
}

function deriveWindowTag(avgAge, starterValue) {
  if (starterValue >= 36000 && avgAge >= 24.5 && avgAge <= 28.0) return "Contender";
  if (avgAge < 24.8) return "Rebuilder";
  if (starterValue < 28000 && avgAge > 27.5) return "Tanking";
  return "Competitive";
}

function deriveTradePattern(manager) {
  const topPosition = manager.topPositionAdds || "WR";
  return {
    buys: topPosition === "RB" ? "RB depth, immediate starters" : "young WRs, draft picks",
    sells: topPosition === "WR" ? "aging RBs, fringe veterans" : "bench depth, aging pieces",
    avoids: manager.tradeFriendlinessScore <= 3 ? "high-variance packages" : "1-for-1 QB swaps"
  };
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
    return;
  }

  const manager = state.report.managers.find((item) => item.userId === state.detailManagerId);
  if (!manager) {
    dom.detailSection.classList.add("hidden");
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

function labelFromManagerTraits(tradeCount, avgBidPct, totalMoves) {
  if (tradeCount >= 8 && avgBidPct >= 0.18) return "Trade Addict";
  if (tradeCount >= 5 || totalMoves >= 35) return "Active Market Maker";
  if (avgBidPct >= 0.22) return "FAAB Sniper";
  if (tradeCount <= 1 && totalMoves <= 10) return "The Hoarder";
  return "Silent Contender";
}

function buildTargetingCue(profileLabel, topPosition, tradeCount) {
  if (profileLabel === "Trade Addict") {
    return "Lead with a complete package and anchor negotiations early.";
  }
  if (profileLabel === "FAAB Sniper") {
    return `Pitch ${topPosition} depth before waivers run to increase response rate.`;
  }
  if (profileLabel === "The Hoarder") {
    return "Offer stable floor assets; avoid volatile upside framing.";
  }
  if (tradeCount >= 5) {
    return "Run a two-step offer sequence: fair opener, then targeted sweetener.";
  }
  return "Use roster-fit framing and weekly points gain to open talks.";
}

function isCompletedTransaction(transaction) {
  const status = String(transaction?.status || "").toLowerCase();
  if (!status) return true;
  return status === "complete" || status === "completed" || status === "accepted";
}

function normalizeSleeperPosition(position) {
  const p = String(position || "").toUpperCase();
  if (["QB", "RB", "WR", "TE"].includes(p)) return p;
  return "";
}

function topKey(record) {
  const entries = Object.entries(record || {});
  if (!entries.length) return "";
  entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  return entries[0][0];
}

function dedupe(list) {
  return [...new Set((list || []).filter((item) => item !== undefined && item !== null && item !== ""))];
}

function inferPlayerAge(player) {
  const age = Number(player?.age);
  if (Number.isFinite(age)) return age;
  const years = Number(player?.years_exp);
  if (Number.isFinite(years)) return 21 + years;
  return Number.NaN;
}

function estimateSleeperPlayerValue(player) {
  const position = normalizeSleeperPosition(player?.position) || "WR";
  const age = inferPlayerAge(player);
  const baseByPosition = { QB: 5200, RB: 3600, WR: 3800, TE: 2600 };
  const base = baseByPosition[position] || 3000;
  if (!Number.isFinite(age)) return base;
  const ageAdj = age <= 23 ? 1.22 : age <= 26 ? 1.08 : age <= 29 ? 0.92 : 0.74;
  return base * ageAdj;
}

function topPositionValue(players, starters) {
  const values = (players || []).map((player) => estimateSleeperPlayerValue(player)).sort((a, b) => b - a);
  return values.slice(0, starters).reduce((sum, value) => sum + value, 0);
}

function round(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const scale = 10 ** digits;
  return Math.round(numeric * scale) / scale;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function signed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return `${numeric >= 0 ? "+" : ""}${round(numeric, 0).toLocaleString()}`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
