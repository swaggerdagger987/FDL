const FALLBACK_METRIC_KEYS = [
  "fantasy_points_ppr",
  "fantasy_points_half_ppr",
  "fantasy_points_std",
  "age",
  "years_exp",
  "passing_yards",
  "passing_tds",
  "interceptions",
  "passing_air_yards",
  "passing_yards_after_catch",
  "rushing_attempts",
  "rushing_yards",
  "rushing_tds",
  "rushing_epa",
  "rushing_yards_after_contact",
  "receiving_targets",
  "receptions",
  "receiving_yards",
  "receiving_tds",
  "receiving_air_yards",
  "receiving_yards_after_catch",
  "air_yards_share",
  "target_share",
  "wopr",
  "red_zone_targets",
  "goal_line_carries",
  "yards_per_route_run",
  "yards_per_reception",
  "yards_per_target",
  "completion_percentage",
  "yards_per_pass_attempt",
  "yards_per_rush_attempt",
  "touchdowns",
  "turnovers",
  "fumbles_lost",
  "snap_pct",
  "special_teams_tds"
];

const dom = {
  search: document.querySelector("#screen-search"),
  position: document.querySelector("#screen-position"),
  team: document.querySelector("#screen-team"),
  metricSearch: document.querySelector("#metric-search"),
  metricSelect: document.querySelector("#metric-select"),
  addMetricBtn: document.querySelector("#screen-add-metric"),
  customMetric: document.querySelector("#screen-custom-metric"),
  addCustomMetricBtn: document.querySelector("#screen-add-custom-metric"),
  activeFilters: document.querySelector("#screen-active-filters"),
  clearFilters: document.querySelector("#screen-clear-filters"),
  runBtn: document.querySelector("#screen-run"),
  refreshBtn: document.querySelector("#screen-refresh-db"),
  status: document.querySelector("#screen-status"),
  count: document.querySelector("#screen-count"),
  head: document.querySelector("#screen-results-head"),
  results: document.querySelector("#screen-results")
};

const state = {
  metricOptions: [],
  metricIndex: new Map(),
  activeFilters: []
};

initialize();

async function initialize() {
  wireEvents();
  await Promise.all([loadTeamOptions(), loadMetricOptions()]);
  renderMetricOptions();
  renderActiveFilters();
  await runScreen();
}

function wireEvents() {
  dom.runBtn.addEventListener("click", runScreen);
  dom.refreshBtn.addEventListener("click", refreshDatabase);
  dom.clearFilters.addEventListener("click", clearFilters);
  dom.metricSearch.addEventListener("input", renderMetricOptions);
  dom.metricSelect.addEventListener("dblclick", addSelectedMetric);
  dom.addMetricBtn.addEventListener("click", addSelectedMetric);
  dom.addCustomMetricBtn.addEventListener("click", addCustomMetric);
  dom.customMetric.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomMetric();
    }
  });
  dom.activeFilters.addEventListener("click", onActiveFilterClick);
  dom.activeFilters.addEventListener("input", onActiveFilterInput);
  dom.activeFilters.addEventListener("change", onActiveFilterChange);

  [dom.search, dom.position, dom.team].forEach((element) => {
    element.addEventListener("change", () => runScreen());
  });
  dom.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runScreen();
    }
  });
}

async function loadTeamOptions() {
  try {
    const response = await fetch("/api/players?limit=5000&sort=name");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const teams = [...new Set((payload.items || []).map((item) => item.team).filter(Boolean))].sort();
    dom.team.innerHTML =
      `<option value="">All Teams</option>` +
      teams.map((team) => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`).join("");
  } catch (error) {
    setStatus(
      `Could not load teams from API (${error.message}). Start server with: python3 terminal_server.py`,
      "error"
    );
  }
}

async function loadMetricOptions() {
  try {
    const response = await fetch("/api/filter-options?limit=3000");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const items = (payload.items || []).filter((item) => item && item.key);
    if (!items.length) {
      applyFallbackMetricOptions();
      setStatus("Metric catalog is empty. Run Refresh Live DB to populate all stats.", "info");
      return;
    }
    state.metricOptions = items.map((item) => ({
      key: String(item.key),
      label: String(item.label || item.key),
      minValue: Number(item.min_value),
      maxValue: Number(item.max_value),
      playerCount: Number(item.player_count || 0)
    }));
    state.metricIndex = new Map(state.metricOptions.map((item) => [item.key, item]));
  } catch (error) {
    applyFallbackMetricOptions();
    setStatus(
      `Live metric catalog unavailable (${error.message}). Using fallback list; API calls require terminal_server.py.`,
      "error"
    );
  }
}

function applyFallbackMetricOptions() {
  state.metricOptions = FALLBACK_METRIC_KEYS.map((key) => ({
    key,
    label: prettifyStatKey(key),
    minValue: Number.NaN,
    maxValue: Number.NaN,
    playerCount: 0
  }));
  state.metricIndex = new Map(state.metricOptions.map((item) => [item.key, item]));
}

function renderMetricOptions() {
  const query = String(dom.metricSearch.value || "").trim().toLowerCase();
  const currentValue = String(dom.metricSelect.value || "");

  const filtered = state.metricOptions
    .filter((item) => {
      if (!query) return true;
      return item.key.toLowerCase().includes(query) || item.label.toLowerCase().includes(query);
    })
    .slice(0, 3000);

  if (!filtered.length) {
    dom.metricSelect.innerHTML = `<option value="" disabled>No metrics match your search</option>`;
    return;
  }

  dom.metricSelect.innerHTML = filtered
    .map((item) => {
      const selected = item.key === currentValue ? "selected" : "";
      const range = formatRange(item.minValue, item.maxValue);
      const suffix = Number.isFinite(item.playerCount) && item.playerCount > 0 ? ` | ${item.playerCount} players` : "";
      return `<option value="${escapeHtml(item.key)}" ${selected}>${escapeHtml(item.label)} (${escapeHtml(
        item.key
      )}) | ${escapeHtml(range)}${escapeHtml(suffix)}</option>`;
    })
    .join("");
}

function addSelectedMetric() {
  const key = String(dom.metricSelect.value || "").trim();
  if (!key) return;
  addFilter(key);
}

function addCustomMetric() {
  const key = normalizeMetricKey(dom.customMetric.value);
  if (!key) return;
  addFilter(key);
  dom.customMetric.value = "";
}

function renderActiveFilters() {
  if (!state.activeFilters.length) {
    dom.activeFilters.innerHTML = `<p class="chip-empty">No active metric filters.</p>`;
    return;
  }

  dom.activeFilters.innerHTML = state.activeFilters
    .map((filter, index) => {
      const between = filter.op === "between";
      return `
        <div class="active-filter-row" data-index="${index}">
          <div class="active-filter-copy">
            <p class="active-filter-title">${escapeHtml(filter.label)}</p>
            <p class="active-filter-meta">${escapeHtml(filter.key)}</p>
          </div>
          <div class="active-filter-controls">
            <select data-field="op">
              ${operatorOptionsMarkup(filter.op)}
            </select>
            <input data-field="value" type="number" step="0.01" placeholder="Value" value="${escapeHtml(
              filter.value
            )}" />
            <input data-field="value_max" type="number" step="0.01" placeholder="Max" value="${escapeHtml(
              filter.valueMax
            )}" class="${between ? "" : "hidden"}" />
            <button class="secondary-btn" type="button" data-action="remove-filter">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function onActiveFilterClick(event) {
  const button = event.target.closest("button[data-action='remove-filter']");
  if (!button) return;
  const row = button.closest(".active-filter-row");
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isInteger(index)) return;
  state.activeFilters.splice(index, 1);
  renderActiveFilters();
}

function onActiveFilterInput(event) {
  const row = event.target.closest(".active-filter-row");
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isInteger(index) || !state.activeFilters[index]) return;
  const field = event.target.dataset.field;
  if (!field) return;

  if (field === "value") {
    state.activeFilters[index].value = event.target.value;
  } else if (field === "value_max") {
    state.activeFilters[index].valueMax = event.target.value;
  }
}

function onActiveFilterChange(event) {
  const row = event.target.closest(".active-filter-row");
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isInteger(index) || !state.activeFilters[index]) return;
  const field = event.target.dataset.field;
  if (field !== "op") return;

  const value = String(event.target.value || "gte");
  state.activeFilters[index].op = value;
  if (value !== "between") {
    state.activeFilters[index].valueMax = "";
  }
  renderActiveFilters();
}

function addFilter(key) {
  if (state.activeFilters.some((entry) => entry.key === key)) {
    setStatus(`Filter "${key}" is already active.`, "info");
    return;
  }
  const option = state.metricIndex.get(key);
  state.activeFilters.push({
    key,
    label: option?.label || prettifyStatKey(key),
    op: "gte",
    value: "",
    valueMax: ""
  });
  renderActiveFilters();
  setStatus(`Added filter: ${option?.label || key}. Set a value, then Run Screen.`, "info");
}

function clearFilters() {
  state.activeFilters = [];
  renderActiveFilters();
  setStatus("Cleared all metric filters.", "info");
}

function buildFiltersPayload() {
  const filters = [];
  for (const filter of state.activeFilters) {
    const key = String(filter.key || "").trim();
    const op = String(filter.op || "gte").trim();
    const value = toNumberOrNull(filter.value);
    const valueMax = toNumberOrNull(filter.valueMax);

    if (!key) continue;
    if (op === "between") {
      if (value === null || valueMax === null) continue;
      filters.push({ key, op, value, value_max: valueMax });
      continue;
    }
    if (value === null) continue;
    filters.push({ key, op, value });
  }
  return filters;
}

async function runScreen() {
  try {
    setStatus("Running screen...", "info");
    dom.runBtn.disabled = true;

    const filters = buildFiltersPayload();
    const metricColumns = uniqueKeys(["fantasy_points_ppr", ...state.activeFilters.map((item) => item.key)]);
    const request = {
      search: dom.search.value,
      position: dom.position.value,
      team: dom.team.value,
      limit: 300,
      offset: 0,
      sort_key: "fantasy_points_ppr",
      sort_direction: "desc",
      filters,
      columns: metricColumns
    };

    const response = await fetch("/api/screener/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const items = payload.items || [];
    renderResults(items, metricColumns);

    dom.count.textContent = `${payload.count || items.length} players`;
    setStatus(`Screen complete. Applied ${filters.length} metric filter${filters.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    setStatus(`Screen failed: ${error.message}. Make sure you started: python3 terminal_server.py`, "error");
  } finally {
    dom.runBtn.disabled = false;
  }
}

function renderResults(items, metricColumns) {
  const columns = uniqueKeys(metricColumns);
  dom.head.innerHTML = `
    <tr>
      <th>Player</th>
      <th>Pos</th>
      <th>Team</th>
      ${columns.map((key) => `<th>${escapeHtml(getMetricLabel(key))}</th>`).join("")}
      <th>Season</th>
      <th>Week</th>
    </tr>
  `;

  dom.results.innerHTML = items
    .map((item) => {
      const metrics = item.metrics || {};
      return `
        <tr>
          <td>${escapeHtml(item.full_name || "Unknown")}</td>
          <td>${escapeHtml(item.position || "-")}</td>
          <td>${escapeHtml(item.team || "-")}</td>
          ${columns
            .map((key) => `<td>${formatMetricValue(resolveMetricValue(item, metrics, key), key)}</td>`)
            .join("")}
          <td>${escapeHtml(item.latest_season || "-")}</td>
          <td>${escapeHtml(item.latest_week || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

async function refreshDatabase() {
  const season = currentSleeperSeason();
  try {
    setStatus("Refreshing live database...", "info");
    dom.refreshBtn.disabled = true;
    const response = await fetch(`/api/admin/sync?season=${season}`, { method: "POST" });
    if (!response.ok && response.status !== 202) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (response.status === 202 || payload.queued) {
      setStatus("Sync started in background. This can take a few minutes on first run.", "info");
      await waitForSyncToFinish();
      return;
    }

    const summary = payload.summary || {};
    setStatus(
      `DB refreshed: players ${summary.players_upserted || 0}, stats ${summary.stats_rows_upserted || 0}, metrics ${
        summary.metrics_rows_upserted || 0
      }.`,
      "success"
    );

    await Promise.all([loadTeamOptions(), loadMetricOptions()]);
    renderMetricOptions();
    renderActiveFilters();
    await runScreen();
  } catch (error) {
    setStatus(`Refresh failed: ${error.message}. Start API server with python3 terminal_server.py`, "error");
  } finally {
    dom.refreshBtn.disabled = false;
  }
}

async function waitForSyncToFinish() {
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
      setStatus(`Sync failed: ${status.last_error}`, "error");
      return;
    }
    const summary = status.last_summary || {};
    setStatus(
      `DB refreshed: players ${summary.players_upserted || 0}, stats ${summary.stats_rows_upserted || 0}, metrics ${
        summary.metrics_rows_upserted || 0
      }.`,
      "success"
    );
    await Promise.all([loadTeamOptions(), loadMetricOptions()]);
    renderMetricOptions();
    renderActiveFilters();
    await runScreen();
    return;
  }

  setStatus("Sync still running in background. Refresh again in a minute.", "info");
}

function resolveMetricValue(item, metrics, key) {
  if (Object.prototype.hasOwnProperty.call(metrics, key)) {
    return metrics[key];
  }
  if (key === "age") return item.age;
  if (key === "years_exp") return item.years_exp;

  const fallbackMap = {
    fantasy_points_ppr: item.latest_fantasy_points_ppr,
    passing_yards: item.latest_passing_yards,
    rushing_yards: item.latest_rushing_yards,
    receiving_yards: item.latest_receiving_yards,
    receptions: item.latest_receptions,
    touchdowns: item.latest_touchdowns
  };
  if (Object.prototype.hasOwnProperty.call(fallbackMap, key)) {
    return fallbackMap[key];
  }
  return null;
}

function getMetricLabel(key) {
  const option = state.metricIndex.get(key);
  if (option?.label) return option.label;
  return prettifyStatKey(key);
}

function operatorOptionsMarkup(selected) {
  const options = [
    { value: "gte", label: ">=" },
    { value: "lte", label: "<=" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "eq", label: "=" },
    { value: "between", label: "Between" }
  ];
  return options
    .map(
      (item) =>
        `<option value="${item.value}" ${item.value === selected ? "selected" : ""}>${item.label}</option>`
    )
    .join("");
}

function formatMetricValue(value, key) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";

  let digits = 2;
  if (key === "fantasy_points_ppr" || key.includes("points")) digits = 1;
  if (key === "age" || key === "years_exp" || key.includes("td")) digits = 0;
  if (Math.abs(numeric) >= 100) digits = 0;
  return numeric.toFixed(digits);
}

function formatRange(minValue, maxValue) {
  const min = Number(minValue);
  const max = Number(maxValue);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return "no range";
  if (!Number.isFinite(min)) return `<= ${formatCompact(max)}`;
  if (!Number.isFinite(max)) return `>= ${formatCompact(min)}`;
  return `${formatCompact(min)} to ${formatCompact(max)}`;
}

function formatCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  if (Math.abs(numeric) >= 1000) return Math.round(numeric).toLocaleString();
  if (Math.abs(numeric) >= 100) return numeric.toFixed(0);
  if (Math.abs(numeric) >= 10) return numeric.toFixed(1);
  return numeric.toFixed(2);
}

function normalizeMetricKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/%/g, "pct")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function prettifyStatKey(value) {
  const raw = String(value || "");
  return raw
    .split("_")
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (["ppr", "std", "yac", "epa", "cpoe", "qb", "wr", "rb", "te", "td"].includes(lower)) {
        return lower.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function setStatus(message, level = "info") {
  dom.status.textContent = message;
  dom.status.dataset.level = level;
}

function uniqueKeys(keys) {
  const seen = new Set();
  const items = [];
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function currentSleeperSeason(now = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() + 1 >= 8 ? year : year - 1;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
