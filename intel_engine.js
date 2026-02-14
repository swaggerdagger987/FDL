import { clamp, dedupe, round } from "./utils.js";

export const SLEEPER_REGULAR_SEASON_WEEKS = 18;
export const AGGRESSION_WEIGHTS = {
  tradeCount: 2.4,
  waiverCount: 1.1,
  draftPickMoves: 1.6,
  avgBidPct: 35,
  churnMoves: 0.08
};

const TRANSACTION_CACHE_TTL_MS = 10 * 60 * 1000;
const TRANSACTION_CACHE_KEY_PREFIX = "fdl_tx_cache_v2";

function readLocalCache(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeLocalCache(key, payload) {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    // Storage write errors are non-fatal for analytics.
  }
}

function resolveLeagueStart(startLeagueOrId) {
  if (!startLeagueOrId) return { leagueId: "", startLeague: null };
  if (typeof startLeagueOrId === "string") {
    return { leagueId: String(startLeagueOrId), startLeague: null };
  }
  if (typeof startLeagueOrId === "object" && startLeagueOrId.league_id) {
    return { leagueId: String(startLeagueOrId.league_id), startLeague: startLeagueOrId };
  }
  return { leagueId: "", startLeague: null };
}

export async function fetchLeagueHistoryChain(startLeagueOrId, maxSeasons, fetchSleeperJSON) {
  const depthLimit = Math.max(1, Number(maxSeasons) || 1);
  const { leagueId, startLeague } = resolveLeagueStart(startLeagueOrId);
  if (!leagueId) return [];
  const chain = [];
  const seen = new Set();

  let cursorLeague = startLeague || null;
  let currentId = leagueId;
  while (currentId && chain.length < depthLimit && !seen.has(currentId)) {
    seen.add(currentId);
    if (!cursorLeague) {
      cursorLeague = await fetchSleeperJSON(`/league/${currentId}`);
    }
    if (!cursorLeague || !cursorLeague.league_id) break;
    chain.push(cursorLeague);
    currentId = String(cursorLeague.previous_league_id || "");
    cursorLeague = null;
  }

  return chain;
}

function transactionCacheKey(leagueId, namespace) {
  return `${TRANSACTION_CACHE_KEY_PREFIX}:${namespace}:${leagueId}`;
}

export async function fetchAllTransactionsForLeague(leagueId, fetchSleeperJSON, options = {}) {
  const namespace = String(options.cacheNamespace || "intel");
  const ttlMs = Number(options.cacheTtlMs || TRANSACTION_CACHE_TTL_MS);
  const weekCount = Number(options.regularSeasonWeeks || SLEEPER_REGULAR_SEASON_WEEKS);
  const key = transactionCacheKey(leagueId, namespace);
  const now = Date.now();

  const cached = readLocalCache(key);
  if (
    cached &&
    Number.isFinite(Number(cached.cached_at_ms)) &&
    now - Number(cached.cached_at_ms) <= ttlMs &&
    Array.isArray(cached.transactions)
  ) {
    return cached.transactions;
  }

  const weeks = Array.from({ length: weekCount }, (_, index) => index + 1);
  const perWeek = await Promise.all(
    weeks.map(async (week) => {
      try {
        const weekTransactions = await fetchSleeperJSON(`/league/${leagueId}/transactions/${week}`);
        if (!Array.isArray(weekTransactions)) return [];
        return weekTransactions.map((transaction) => ({ ...transaction, _week: week }));
      } catch (error) {
        return [];
      }
    })
  );
  const transactions = perWeek.flat();
  writeLocalCache(key, {
    cached_at_ms: now,
    transactions
  });
  return transactions;
}

export async function fetchLeagueSeasonData(leagues, fetchSleeperJSON, options = {}) {
  const list = Array.isArray(leagues) ? leagues : [];
  return Promise.all(
    list.map(async (league) => {
      const [users, rosters, transactions] = await Promise.all([
        fetchSleeperJSON(`/league/${league.league_id}/users`),
        fetchSleeperJSON(`/league/${league.league_id}/rosters`),
        fetchAllTransactionsForLeague(String(league.league_id), fetchSleeperJSON, options)
      ]);
      return {
        league,
        users: Array.isArray(users) ? users : [],
        rosters: Array.isArray(rosters) ? rosters : [],
        transactions: Array.isArray(transactions) ? transactions : []
      };
    })
  );
}

export function collectSleeperPlayerIdsFromSeasonData(seasonData) {
  const ids = [];
  for (const season of seasonData || []) {
    for (const roster of season.rosters || []) {
      ids.push(...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || []));
    }
    for (const transaction of season.transactions || []) {
      ids.push(...Object.keys(transaction.adds || {}), ...Object.keys(transaction.drops || {}));
    }
  }
  return dedupe(ids.map((token) => String(token || "").trim()).filter(Boolean));
}

function isCompletedTransaction(transaction) {
  const status = String(transaction?.status || "").toLowerCase();
  if (!status) return true;
  return status === "complete" || status === "completed" || status === "accepted";
}

function normalizeSleeperPosition(position) {
  const token = String(position || "").toUpperCase();
  if (["QB", "RB", "WR", "TE"].includes(token)) return token;
  return "";
}

function ensureManager(map, userId, displayName = "") {
  const key = String(userId || "");
  if (!key) {
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

function topKey(record) {
  const entries = Object.entries(record || {});
  if (!entries.length) return "";
  entries.sort((left, right) => Number(right[1]) - Number(left[1]));
  return entries[0][0];
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
  const ageAdjustment = age <= 23 ? 1.22 : age <= 26 ? 1.08 : age <= 29 ? 0.92 : 0.74;
  return base * ageAdjustment;
}

function topPositionValue(players, starters) {
  const values = (players || []).map((player) => estimateSleeperPlayerValue(player)).sort((a, b) => b - a);
  return values.slice(0, starters).reduce((sum, value) => sum + value, 0);
}

function buildParticipantUserIds(transaction, ownerByRosterId) {
  const ids = [];
  const seen = new Set();
  const push = (candidate) => {
    if (candidate === undefined || candidate === null) return;
    const resolved = ownerByRosterId[String(candidate)] || candidate;
    const token = String(resolved || "").trim();
    if (!token || seen.has(token)) return;
    seen.add(token);
    ids.push(token);
  };

  for (const rosterId of transaction.roster_ids || []) push(rosterId);
  for (const rosterId of transaction.consenter_ids || []) push(rosterId);
  push(transaction.creator);
  return ids;
}

function managerLabelStyle(tradeCount, avgBidPct, totalMoves, tone) {
  if (tone === "terminal") {
    if (tradeCount >= 8 && avgBidPct >= 0.18) return "Hyper-aggressive";
    if (tradeCount >= 5 || totalMoves >= 35) return "Active market maker";
    if (avgBidPct >= 0.22) return "Waiver sniper";
    if (tradeCount <= 1 && totalMoves <= 10) return "Risk-averse";
    return "Balanced";
  }
  if (tradeCount >= 8 && avgBidPct >= 0.18) return "Trade Addict";
  if (tradeCount >= 5 || totalMoves >= 35) return "Active Market Maker";
  if (avgBidPct >= 0.22) return "FAAB Sniper";
  if (tradeCount <= 1 && totalMoves <= 10) return "The Hoarder";
  return "Silent Contender";
}

function buildTargetingCue(profileLabel, topPosition, tradeCount) {
  if (profileLabel === "Hyper-aggressive" || profileLabel === "Trade Addict") {
    return "Lead with a complete package and anchor negotiations early.";
  }
  if (profileLabel === "Waiver sniper" || profileLabel === "FAAB Sniper") {
    return `Pitch ${topPosition} depth before waivers run to increase response rate.`;
  }
  if (profileLabel === "Risk-averse" || profileLabel === "The Hoarder") {
    return "Offer stable floor assets; avoid volatile upside framing.";
  }
  if (tradeCount >= 5) {
    return "Run a two-step offer sequence: fair opener, then targeted sweetener.";
  }
  return "Use roster-fit framing and weekly points gain to open talks.";
}

function buildManagerInsight(manager, profileLabel, topPosition, counterpartyCount) {
  const avgBid = manager.faabBidCount ? manager.faabBidSum / manager.faabBidCount : 0;
  const maxBudget = manager.faabBudgetObserved || 100;
  const bidPct = maxBudget ? Math.round((avgBid / maxBudget) * 100) : 0;
  return `${manager.displayName} profiles as ${profileLabel}. They bias toward ${topPosition} adds, average ${bidPct}% of budget per FAAB win, and have traded with ${counterpartyCount} unique managers.`;
}

function pushTradeTimelineEvent({
  transaction,
  season,
  participantUserIds,
  ownerByRosterId,
  rosterIdsByOwner,
  displayByUserId,
  managerMap,
  sleeperPlayersById
}) {
  for (const managerUserId of participantUserIds) {
    const manager = ensureManager(managerMap, managerUserId, displayByUserId[managerUserId]);
    const managerRosterIds = new Set(rosterIdsByOwner[managerUserId] || []);
    const adds = transaction.adds || {};
    const drops = transaction.drops || {};

    const receivedPlayers = [];
    for (const [playerId, rosterId] of Object.entries(adds)) {
      if (managerRosterIds.has(String(rosterId))) receivedPlayers.push(playerId);
    }
    const sentPlayers = [];
    for (const [playerId, rosterId] of Object.entries(drops)) {
      if (managerRosterIds.has(String(rosterId))) sentPlayers.push(playerId);
    }

    const receivedValue = receivedPlayers.reduce(
      (sum, playerId) => sum + estimateSleeperPlayerValue(sleeperPlayersById[playerId]),
      0
    );
    const sentValue = sentPlayers.reduce((sum, playerId) => sum + estimateSleeperPlayerValue(sleeperPlayersById[playerId]), 0);
    const counterpartNames = participantUserIds
      .filter((userId) => String(userId) !== String(managerUserId))
      .map((userId) => displayByUserId[userId] || `user-${userId}`);

    manager.tradeTimeline.push({
      timestamp: Number(transaction.status_updated || transaction.created || 0),
      dateLabel: season ? `${season} W${Number(transaction._week || 0)}` : "Trade",
      summary: `Sent ${sentPlayers.length} · Received ${receivedPlayers.length} vs ${counterpartNames.join(", ") || "league"}`,
      delta: round(receivedValue - sentValue, 0)
    });
  }
}

function finalizeManagerProfile(manager, myUserId, tone) {
  const avgBid = manager.faabBidCount ? manager.faabBidSum / manager.faabBidCount : 0;
  const maxBudget = manager.faabBudgetObserved || 100;
  const avgBidPct = maxBudget ? avgBid / maxBudget : 0;
  const totalMoves = manager.addCount + manager.dropCount;
  const counterparties = Object.entries(manager.counterparties).sort((a, b) => Number(b[1]) - Number(a[1]));
  const counterpartyCount = counterparties.length;

  const aggressionRaw =
    manager.tradeCount * AGGRESSION_WEIGHTS.tradeCount +
    manager.waiverCount * AGGRESSION_WEIGHTS.waiverCount +
    manager.draftPickMoves * AGGRESSION_WEIGHTS.draftPickMoves +
    avgBidPct * AGGRESSION_WEIGHTS.avgBidPct +
    totalMoves * AGGRESSION_WEIGHTS.churnMoves;

  const topPosition = topKey(manager.positionAdds) || "N/A";
  const profileLabel = managerLabelStyle(manager.tradeCount, avgBidPct, totalMoves, tone);
  const targetingCue = buildTargetingCue(profileLabel, topPosition, manager.tradeCount);
  const tradeFriendlinessScore = round(clamp((manager.tradeCount * 1.7 + counterpartyCount * 2.4) / 3, 1, 10), 1);
  const riskToleranceScore = round(clamp(avgBidPct * 50 + manager.tradeCount * 0.8 + totalMoves * 0.04, 1, 10), 1);

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
    draftPickMoves: manager.draftPickMoves,
    addCount: manager.addCount,
    dropCount: manager.dropCount,
    topPositionAdds: topPosition,
    profileLabel,
    aggressionRaw,
    aggressionScore: 0,
    tradeFriendlinessScore,
    riskToleranceScore,
    targetingCue,
    insight: buildManagerInsight(manager, profileLabel, topPosition, counterpartyCount),
    counterpartyCount,
    topCounterpartyUserId: counterparties[0]?.[0] || null,
    topCounterpartyTrades: counterparties[0]?.[1] || 0,
    tradeTimeline: [...manager.tradeTimeline].sort((a, b) => Number(b.timestamp) - Number(a.timestamp)).slice(0, 8)
  };
}

export function buildAdversarialIntelReport(seasonData, myUserId, sleeperPlayersById, options = {}) {
  const tone = String(options.profileTone || "intel");
  const includeTradeTimeline = options.includeTradeTimeline !== false;
  const managerMap = new Map();
  let totalTransactions = 0;
  let totalWaivers = 0;
  let totalTrades = 0;
  let totalFaabBid = 0;

  for (const season of seasonData || []) {
    const ownerByRosterId = {};
    const rosterIdsByOwner = {};
    const displayByUserId = {};
    const waiverBudget = Number(season.league?.settings?.waiver_budget) || 100;

    for (const user of season.users || []) {
      const userId = String(user.user_id || "");
      if (!userId) continue;
      displayByUserId[userId] = user.display_name || user.username || `user-${userId}`;
    }

    for (const roster of season.rosters || []) {
      const rosterId = String(roster.roster_id || "");
      const ownerId = String(roster.owner_id || "");
      if (!rosterId || !ownerId) continue;
      ownerByRosterId[rosterId] = ownerId;
      if (!rosterIdsByOwner[ownerId]) rosterIdsByOwner[ownerId] = [];
      rosterIdsByOwner[ownerId].push(rosterId);
      ensureManager(managerMap, ownerId, displayByUserId[ownerId]);
    }

    for (const transaction of season.transactions || []) {
      if (!isCompletedTransaction(transaction)) continue;
      totalTransactions += 1;
      const type = String(transaction.type || "unknown").toLowerCase();
      if (type === "waiver") totalWaivers += 1;
      if (type === "trade") totalTrades += 1;

      const participantUserIds = buildParticipantUserIds(transaction, ownerByRosterId);
      if (!participantUserIds.length) continue;

      for (const userId of participantUserIds) {
        const manager = ensureManager(managerMap, userId, displayByUserId[userId]);
        manager.seasons.add(String(season.league?.season || ""));
        manager.totalTransactions += 1;
      }

      if (type === "waiver" || type === "free_agent") {
        const bid = Number(transaction.settings?.waiver_bid) || 0;
        if (bid > 0) totalFaabBid += bid;
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

        for (const pick of transaction.draft_picks || []) {
          const ownerId = String(pick?.owner_id || "");
          if (!ownerId) continue;
          const manager = ensureManager(managerMap, ownerId, displayByUserId[ownerId]);
          manager.draftPickMoves += 1;
        }

        if (includeTradeTimeline) {
          pushTradeTimelineEvent({
            transaction,
            season: Number(season.league?.season || 0),
            participantUserIds,
            ownerByRosterId,
            rosterIdsByOwner,
            displayByUserId,
            managerMap,
            sleeperPlayersById
          });
        }
      }

      const adds = transaction.adds || {};
      const drops = transaction.drops || {};
      for (const [playerId, rosterId] of Object.entries(adds)) {
        const ownerId = ownerByRosterId[String(rosterId)];
        if (!ownerId) continue;
        const manager = ensureManager(managerMap, ownerId, displayByUserId[ownerId]);
        manager.addCount += 1;
        const position = normalizeSleeperPosition(sleeperPlayersById[playerId]?.position);
        if (position) {
          manager.positionAdds[position] = (manager.positionAdds[position] || 0) + 1;
        }
      }
      for (const [playerId, rosterId] of Object.entries(drops)) {
        const ownerId = ownerByRosterId[String(rosterId)];
        if (!ownerId) continue;
        const manager = ensureManager(managerMap, ownerId, displayByUserId[ownerId]);
        manager.dropCount += 1;
        const position = normalizeSleeperPosition(sleeperPlayersById[playerId]?.position);
        if (position) {
          manager.positionDrops[position] = (manager.positionDrops[position] || 0) + 1;
        }
      }
    }
  }

  const managers = [...managerMap.values()].map((manager) => finalizeManagerProfile(manager, myUserId, tone));
  const maxRaw = Math.max(...managers.map((manager) => manager.aggressionRaw), 1);
  for (const manager of managers) {
    manager.aggressionScore = round((manager.aggressionRaw / maxRaw) * 100, 1);
  }
  managers.sort((left, right) => Number(right.aggressionScore) - Number(left.aggressionScore));

  return {
    summary: {
      seasonsAnalyzed: (seasonData || []).length,
      leaguesTraversed: (seasonData || []).length,
      totalTransactions,
      totalWaivers,
      totalTrades,
      totalFaabBid: round(totalFaabBid, 0),
      managersAnalyzed: managers.length
    },
    managers
  };
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
      if (grouped[position]) grouped[position].push(player);
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
      strengths[position] = { count, ratio: round(ratio, 2), label };
      weakest.push({ position, ratio });
    }
    weakest.sort((left, right) => Number(left.ratio) - Number(right.ratio));

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

export function mergeRosterContext(report, latestSeasonData, sleeperPlayersById) {
  const rosterContextByUser = buildRosterContextMap(latestSeasonData, sleeperPlayersById);
  for (const manager of report.managers || []) {
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
