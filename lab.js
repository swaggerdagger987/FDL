import { bindConnectButton, getSleeperSession, hydrateHeader, updateSelectedLeague } from "./site_state.js";

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

const STORAGE_KEYS = {
  savedViews: "fdl_saved_lab_views_v2",
  lastView: "fdl_last_lab_view_v2"
};

const BUILTIN_COLUMNS = [
  { key: "player_name", label: "Player", locked: true },
  { key: "position", label: "Pos", locked: false },
  { key: "age", label: "Age", locked: false },
  { key: "team", label: "Team", locked: false }
];

const DEFAULT_COLUMNS = [
  "player_name",
  "position",
  "age",
  "team",
  "fantasy_points_ppr",
  "receiving_yards",
  "receiving_yards_after_catch",
  "target_share"
];

const METRIC_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "bio", label: "Bio" },
  { key: "production", label: "Production" },
  { key: "efficiency", label: "Efficiency" },
  { key: "advanced", label: "Advanced" },
  { key: "dynasty", label: "Dynasty" },
  { key: "my_league", label: "My League" }
];

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "PICK"];

const dom = {
  search: document.querySelector("#screen-search"),
  team: document.querySelector("#screen-team"),
  ageMin: document.querySelector("#screen-age-min"),
  ageMax: document.querySelector("#screen-age-max"),
  positionPills: document.querySelector("#screen-position-pills"),
  metricSearch: document.querySelector("#metric-search"),
  metricCategories: document.querySelector("#screen-metric-categories"),
  metricSelect: document.querySelector("#metric-select"),
  addColumnBtn: document.querySelector("#screen-add-column"),
  addMetricBtn: document.querySelector("#screen-add-metric"),
  customMetric: document.querySelector("#screen-custom-metric"),
  addCustomColumnBtn: document.querySelector("#screen-add-custom-column"),
  addCustomMetricBtn: document.querySelector("#screen-add-custom-metric"),
  activeColumns: document.querySelector("#screen-active-columns"),
  resetColumnsBtn: document.querySelector("#screen-reset-columns"),
  activeFilters: document.querySelector("#screen-active-filters"),
  clearFilters: document.querySelector("#screen-clear-filters"),
  savedViews: document.querySelector("#screen-saved-views"),
  clearSavedViewsBtn: document.querySelector("#screen-clear-saved-views"),
  saveViewBtn: document.querySelector("#screen-save-view"),
  shareViewBtn: document.querySelector("#screen-share-view"),
  runBtn: document.querySelector("#screen-run"),
  refreshBtn: document.querySelector("#screen-refresh-db"),
  status: document.querySelector("#screen-status"),
  count: document.querySelector("#screen-count"),
  sort: document.querySelector("#screen-sort"),
  head: document.querySelector("#screen-results-head"),
  results: document.querySelector("#screen-results")
};

const state = {
  metricOptions: [],
  metricIndex: new Map(),
  activeColumns: [...DEFAULT_COLUMNS],
  activeFilters: [],
  selectedPositions: new Set(),
  selectedCategory: "all",
  sortKey: "fantasy_points_ppr",
  sortDirection: "desc",
  savedViews: [],
  expandedPlayerIds: new Set(),
  lastItems: [],
  draggingColumnKey: ""
};

initialize();

async function initialize() {
  hydrateHeader("lab");
  bindConnectButton({
    onConnected: () => setStatus("Sleeper connected.", "success"),
    onDisconnected: () => setStatus("Sleeper disconnected.", "info")
  });

  wireEvents();
  loadSavedViews();
  renderPositionPills();

  const sharedView = readSharedViewFromUrl();
  const persistedView = readLastView();
  const initialView = sharedView || persistedView;

  await Promise.all([loadTeamOptions(), loadMetricOptions()]);

  if (initialView) {
    applyViewConfig(initialView);
  } else {
    ensureDefaultColumns();
  }

  renderPositionPills();
  renderMetricCategories();
  renderMetricOptions();
  renderActiveColumns();
  renderActiveFilters();
  renderSavedViews();
  updateSortLabel();

  await runScreen();

  if (sharedView) {
    setStatus("Shared Lab view loaded.", "success");
  }
}

function wireEvents() {
  dom.runBtn.addEventListener("click", runScreen);
  dom.refreshBtn.addEventListener("click", refreshDatabase);
  dom.clearFilters.addEventListener("click", clearFilters);
  dom.resetColumnsBtn.addEventListener("click", resetColumns);
  dom.clearSavedViewsBtn.addEventListener("click", clearSavedViews);
  dom.saveViewBtn.addEventListener("click", saveCurrentView);
  dom.shareViewBtn.addEventListener("click", shareCurrentView);

  dom.metricSearch.addEventListener("input", renderMetricOptions);
  dom.metricSelect.addEventListener("dblclick", addSelectedAsColumn);
  dom.addColumnBtn.addEventListener("click", addSelectedAsColumn);
  dom.addMetricBtn.addEventListener("click", addSelectedAsFilter);
  dom.addCustomColumnBtn.addEventListener("click", addCustomColumn);
  dom.addCustomMetricBtn.addEventListener("click", addCustomFilter);

  dom.customMetric.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCustomColumn();
  });

  dom.metricCategories.addEventListener("click", onMetricCategoryClick);
  dom.positionPills.addEventListener("click", onPositionPillClick);

  dom.activeColumns.addEventListener("click", onActiveColumnClick);
  dom.activeColumns.addEventListener("dragstart", onColumnDragStart);
  dom.activeColumns.addEventListener("dragover", onColumnDragOver);
  dom.activeColumns.addEventListener("drop", onColumnDrop);
  dom.activeColumns.addEventListener("dragend", onColumnDragEnd);

  dom.activeFilters.addEventListener("click", onActiveFilterClick);
  dom.activeFilters.addEventListener("input", onActiveFilterInput);
  dom.activeFilters.addEventListener("change", onActiveFilterChange);

  dom.savedViews.addEventListener("click", onSavedViewsClick);
  dom.head.addEventListener("click", onResultsHeadClick);
  dom.results.addEventListener("click", onResultsBodyClick);

  [dom.search, dom.team, dom.ageMin, dom.ageMax].forEach((element) => {
    element.addEventListener("change", () => runScreen());
  });

  dom.search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    runScreen();
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

    state.metricOptions = items.map((item) => {
      const key = String(item.key);
      return {
        key,
        label: String(item.label || item.key),
        minValue: Number(item.min_value),
        maxValue: Number(item.max_value),
        playerCount: Number(item.player_count || 0),
        category: categorizeMetricKey(key)
      };
    });
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
    playerCount: 0,
    category: categorizeMetricKey(key)
  }));
  state.metricIndex = new Map(state.metricOptions.map((item) => [item.key, item]));
}

function onPositionPillClick(event) {
  const button = event.target.closest("button.position-pill");
  if (!button) return;

  const position = String(button.dataset.position || "").trim().toUpperCase();
  if (!position) {
    state.selectedPositions.clear();
    renderPositionPills();
    runScreen();
    return;
  }

  if (state.selectedPositions.has(position)) {
    state.selectedPositions.delete(position);
  } else {
    state.selectedPositions.add(position);
  }

  renderPositionPills();
  runScreen();
}

function renderPositionPills() {
  const hasSelection = state.selectedPositions.size > 0;
  dom.positionPills.querySelectorAll("button.position-pill").forEach((button) => {
    const position = String(button.dataset.position || "").trim().toUpperCase();
    if (!position) {
      button.classList.toggle("active", !hasSelection);
      return;
    }
    button.classList.toggle("active", state.selectedPositions.has(position));
  });
}

function onMetricCategoryClick(event) {
  const button = event.target.closest("button.metric-category-btn");
  if (!button) return;
  const category = String(button.dataset.category || "all");
  state.selectedCategory = category;
  renderMetricCategories();
  renderMetricOptions();
}

function renderMetricCategories() {
  const counts = countMetricsByCategory();
  dom.metricCategories.innerHTML = METRIC_CATEGORIES.filter((item) => item.key !== "my_league" || counts.my_league > 0)
    .map((item) => {
      const selected = item.key === state.selectedCategory;
      const count = item.key === "all" ? state.metricOptions.length : counts[item.key] || 0;
      return `
        <button
          type="button"
          class="metric-category-btn ${selected ? "active" : ""}"
          data-category="${escapeHtml(item.key)}"
        >
          ${escapeHtml(item.label)}
          <span>${count}</span>
        </button>
      `;
    })
    .join("");
}

function countMetricsByCategory() {
  const counts = {
    bio: 0,
    production: 0,
    efficiency: 0,
    advanced: 0,
    dynasty: 0,
    my_league: 0
  };
  for (const item of state.metricOptions) {
    const category = item.category;
    if (counts[category] !== undefined) {
      counts[category] += 1;
    } else {
      counts.advanced += 1;
    }
  }
  return counts;
}

function renderMetricOptions() {
  const query = String(dom.metricSearch.value || "").trim().toLowerCase();
  const currentValue = String(dom.metricSelect.value || "");

  const filtered = state.metricOptions
    .filter((item) => {
      if (state.selectedCategory !== "all" && item.category !== state.selectedCategory) {
        return false;
      }
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

function addSelectedAsColumn() {
  const key = String(dom.metricSelect.value || "").trim();
  if (!key) return;
  addColumn(key);
}

function addSelectedAsFilter() {
  const key = String(dom.metricSelect.value || "").trim();
  if (!key) return;
  addFilter(key);
}

function addCustomColumn() {
  const key = normalizeMetricKey(dom.customMetric.value);
  if (!key) return;
  addColumn(key);
  dom.customMetric.value = "";
}

function addCustomFilter() {
  const key = normalizeMetricKey(dom.customMetric.value);
  if (!key) return;
  addFilter(key);
  dom.customMetric.value = "";
}

function ensureDefaultColumns() {
  if (state.activeColumns.length) {
    state.activeColumns = normalizeColumns(state.activeColumns);
    return;
  }
  state.activeColumns = normalizeColumns(DEFAULT_COLUMNS);
}

function normalizeColumns(columns) {
  const requested = uniqueKeys(columns.map((item) => String(item || "").trim())).filter(Boolean);
  const withoutBuiltins = requested.filter((key) => !isBuiltinColumn(key));
  return uniqueKeys([...BUILTIN_COLUMNS.map((item) => item.key), ...withoutBuiltins]);
}

function addColumn(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (state.activeColumns.includes(normalizedKey)) {
    setStatus(`Column "${getColumnLabel(normalizedKey)}" is already active.`, "info");
    return;
  }

  state.activeColumns.push(normalizedKey);
  state.activeColumns = normalizeColumns(state.activeColumns);
  renderActiveColumns();
  setStatus(`Added column: ${getColumnLabel(normalizedKey)}.`, "info");
}

function resetColumns() {
  state.activeColumns = normalizeColumns(DEFAULT_COLUMNS);
  renderActiveColumns();
  setStatus("Columns reset to default view.", "info");
}

function renderActiveColumns() {
  if (!state.activeColumns.length) {
    dom.activeColumns.innerHTML = `<p class="chip-empty">No active columns. Add metrics from the picker.</p>`;
    return;
  }

  dom.activeColumns.innerHTML = state.activeColumns
    .map((key, index) => {
      const isLocked = isLockedColumn(key);
      return `
        <div
          class="active-column-chip ${isLocked ? "locked" : ""}"
          data-key="${escapeHtml(key)}"
          draggable="${isLocked ? "false" : "true"}"
        >
          <span class="column-chip-handle" aria-hidden="true">${isLocked ? "•" : "⋮⋮"}</span>
          <span class="column-chip-label">${escapeHtml(getColumnLabel(key))}</span>
          <div class="column-chip-actions">
            <button type="button" class="secondary-btn" data-action="move-left" ${index <= 1 ? "disabled" : ""}>←</button>
            <button type="button" class="secondary-btn" data-action="move-right" ${
              index === state.activeColumns.length - 1 ? "disabled" : ""
            }>→</button>
            <button type="button" class="secondary-btn" data-action="remove-column" ${
              isLocked ? "disabled" : ""
            }>×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function onActiveColumnClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const chip = button.closest(".active-column-chip");
  if (!chip) return;

  const key = String(chip.dataset.key || "");
  const action = String(button.dataset.action || "");
  const index = state.activeColumns.indexOf(key);
  if (index === -1) return;

  if (action === "remove-column") {
    if (isLockedColumn(key)) return;
    state.activeColumns.splice(index, 1);
    if (state.sortKey === key) {
      state.sortKey = "fantasy_points_ppr";
      state.sortDirection = "desc";
      updateSortLabel();
    }
    renderActiveColumns();
    return;
  }

  if (action === "move-left") {
    moveColumn(index, index - 1);
    return;
  }

  if (action === "move-right") {
    moveColumn(index, index + 1);
  }
}

function moveColumn(fromIndex, toIndex) {
  if (fromIndex <= 0 || fromIndex >= state.activeColumns.length) return;
  if (toIndex < 1 || toIndex >= state.activeColumns.length) return;

  const [item] = state.activeColumns.splice(fromIndex, 1);
  state.activeColumns.splice(toIndex, 0, item);
  renderActiveColumns();
}

function onColumnDragStart(event) {
  const chip = event.target.closest(".active-column-chip");
  if (!chip) return;
  const key = String(chip.dataset.key || "");
  if (isLockedColumn(key)) {
    event.preventDefault();
    return;
  }
  state.draggingColumnKey = key;
  chip.classList.add("dragging");
}

function onColumnDragOver(event) {
  if (!state.draggingColumnKey) return;
  event.preventDefault();
}

function onColumnDrop(event) {
  if (!state.draggingColumnKey) return;
  event.preventDefault();

  const targetChip = event.target.closest(".active-column-chip");
  if (!targetChip) return;
  const targetKey = String(targetChip.dataset.key || "");
  if (!targetKey || targetKey === state.draggingColumnKey) return;

  const fromIndex = state.activeColumns.indexOf(state.draggingColumnKey);
  const toIndex = state.activeColumns.indexOf(targetKey);
  if (fromIndex === -1 || toIndex === -1) return;

  if (toIndex === 0) return;

  const [moved] = state.activeColumns.splice(fromIndex, 1);
  const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  state.activeColumns.splice(adjustedToIndex, 0, moved);
  renderActiveColumns();
}

function onColumnDragEnd() {
  state.draggingColumnKey = "";
  dom.activeColumns.querySelectorAll(".active-column-chip.dragging").forEach((node) => {
    node.classList.remove("dragging");
  });
}

function addFilter(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (state.activeFilters.some((entry) => entry.key === normalizedKey)) {
    setStatus(`Filter "${getColumnLabel(normalizedKey)}" is already active.`, "info");
    return;
  }
  const option = state.metricIndex.get(normalizedKey);
  state.activeFilters.push({
    key: normalizedKey,
    label: option?.label || prettifyStatKey(normalizedKey),
    op: "gte",
    value: "",
    valueMax: ""
  });
  renderActiveFilters();
  setStatus(`Added filter: ${option?.label || normalizedKey}. Set a value, then run screen.`, "info");
}

function clearFilters() {
  state.activeFilters = [];
  renderActiveFilters();
  setStatus("Cleared all metric filters.", "info");
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
    state.expandedPlayerIds.clear();

    const filters = buildFiltersPayload();
    const selectedPositions = [...state.selectedPositions];
    const ageMin = toNumberOrNull(dom.ageMin.value);
    const ageMax = toNumberOrNull(dom.ageMax.value);
    const metricColumns = buildRequestedMetricColumns(filters);
    const sortIsBuiltin = isBuiltinColumn(state.sortKey);

    const request = {
      search: dom.search.value,
      team: dom.team.value,
      positions: selectedPositions,
      age_min: ageMin,
      age_max: ageMax,
      limit: 400,
      offset: 0,
      sort_key: sortIsBuiltin ? "fantasy_points_ppr" : state.sortKey,
      sort_direction: state.sortDirection,
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
    state.lastItems = items;

    const sortedItems = sortItems(items);
    renderResults(sortedItems);
    dom.count.textContent = `${sortedItems.length} players`;
    updateSortLabel();
    persistLastView();

    setStatus(
      `Screen complete. ${sortedItems.length} players · ${filters.length} metric filter${
        filters.length === 1 ? "" : "s"
      }.`,
      "success"
    );
  } catch (error) {
    setStatus(`Screen failed: ${error.message}. Make sure you started: python3 terminal_server.py`, "error");
  } finally {
    dom.runBtn.disabled = false;
  }
}

function buildRequestedMetricColumns(filters) {
  return uniqueKeys([
    ...state.activeColumns.filter((key) => !isBuiltinColumn(key)),
    ...filters.map((item) => item.key),
    isBuiltinColumn(state.sortKey) ? "" : state.sortKey,
    "fantasy_points_ppr"
  ]).filter(Boolean);
}

function sortItems(items) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  const key = state.sortKey;

  return [...items].sort((a, b) => {
    const left = getColumnRawValue(a, key);
    const right = getColumnRawValue(b, key);

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const numericSort = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

    if (numericSort) {
      if (leftNumber === rightNumber) {
        return compareText(a.full_name, b.full_name);
      }
      return leftNumber > rightNumber ? direction : -direction;
    }

    const textCompare = compareText(left, right);
    if (textCompare === 0) {
      return compareText(a.full_name, b.full_name);
    }
    return textCompare * direction;
  });
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base", numeric: true });
}

function onResultsHeadClick(event) {
  const button = event.target.closest("button[data-sort-key]");
  if (!button) return;

  const key = String(button.dataset.sortKey || "");
  if (!key) return;

  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = isSortKeyNumeric(key) ? "desc" : "asc";
  }

  const sortedItems = sortItems(state.lastItems);
  renderResults(sortedItems);
  updateSortLabel();
  persistLastView();
}

function renderResults(items) {
  const columns = normalizeColumns(state.activeColumns);
  state.activeColumns = columns;

  dom.head.innerHTML = `
    <tr>
      ${columns.map((columnKey, index) => renderHeaderCell(columnKey, index === 0)).join("")}
    </tr>
  `;

  dom.results.innerHTML = items
    .map((item) => {
      const row = `
        <tr class="screener-row" data-player-id="${escapeHtml(item.player_id || "")}">
          ${columns.map((columnKey, index) => renderCell(item, columnKey, index === 0)).join("")}
        </tr>
      `;

      if (!state.expandedPlayerIds.has(item.player_id)) {
        return row;
      }

      return `${row}${renderDetailRow(item, columns.length)}`;
    })
    .join("");
}

function renderHeaderCell(columnKey, sticky) {
  const isSorted = state.sortKey === columnKey;
  const arrow = isSorted ? (state.sortDirection === "asc" ? "↑" : "↓") : "↕";
  return `
    <th class="${sticky ? "sticky-col" : ""} ${isSorted ? "sorted" : ""}">
      <button type="button" class="sort-btn ${isSorted ? "sorted" : ""}" data-sort-key="${escapeHtml(columnKey)}">
        ${escapeHtml(getColumnLabel(columnKey))}
        <span class="sort-arrow">${arrow}</span>
      </button>
    </th>
  `;
}

function renderCell(item, columnKey, sticky) {
  const rawValue = getColumnRawValue(item, columnKey);

  if (columnKey === "player_name") {
    return `<td class="${sticky ? "sticky-col" : ""} player-cell"><span class="player-name">${escapeHtml(
      rawValue || "Unknown"
    )}</span></td>`;
  }

  if (columnKey === "position") {
    const position = String(rawValue || "-").toUpperCase();
    return `<td><span class="pos-pill pos-${escapeHtml(position.toLowerCase())}">${escapeHtml(position)}</span></td>`;
  }

  if (columnKey === "age") {
    const numeric = Number(rawValue);
    const value = Number.isFinite(numeric) ? numeric.toFixed(1) : "-";
    return `<td class="num"><span class="age-pill ${ageClassName(numeric)}">${escapeHtml(value)}</span></td>`;
  }

  if (columnKey === "team") {
    return `<td>${escapeHtml(rawValue || "-")}</td>`;
  }

  const numeric = Number(rawValue);
  const formatted = formatMetricValue(rawValue, columnKey);
  return `<td class="${Number.isFinite(numeric) ? "num metric-cell" : "metric-cell"}">${escapeHtml(formatted)}</td>`;
}

function renderDetailRow(item, colspan) {
  const metrics = item.metrics || {};
  const production = [
    detailKv("Fantasy PPR", resolveMetricValue(item, metrics, "fantasy_points_ppr"), "fantasy_points_ppr"),
    detailKv("Receptions", resolveMetricValue(item, metrics, "receptions"), "receptions"),
    detailKv("Rec Yards", resolveMetricValue(item, metrics, "receiving_yards"), "receiving_yards"),
    detailKv("Targets", resolveMetricValue(item, metrics, "receiving_targets"), "receiving_targets")
  ].join("");

  const efficiency = [
    detailKv("YAC", resolveMetricValue(item, metrics, "receiving_yards_after_catch"), "receiving_yards_after_catch"),
    detailKv("Air Yards", resolveMetricValue(item, metrics, "receiving_air_yards"), "receiving_air_yards"),
    detailKv("Target Share", resolveMetricValue(item, metrics, "target_share"), "target_share"),
    detailKv("YPRR", resolveMetricValue(item, metrics, "yards_per_route_run"), "yards_per_route_run")
  ].join("");

  const bio = [
    detailKv("Age", item.age, "age"),
    detailKv("Experience", item.years_exp, "years_exp"),
    detailKv("Position", item.position, "position"),
    detailKv("Team", item.team, "team")
  ].join("");

  const snapshot = [
    detailKv("Touchdowns", resolveMetricValue(item, metrics, "touchdowns"), "touchdowns"),
    detailKv("Rushing Yards", resolveMetricValue(item, metrics, "rushing_yards"), "rushing_yards"),
    detailKv("Passing Yards", resolveMetricValue(item, metrics, "passing_yards"), "passing_yards"),
    detailKv("Week", item.latest_week, "latest_week")
  ].join("");

  return `
    <tr class="player-detail-row">
      <td colspan="${colspan}">
        <article class="player-detail-card">
          <h3>${escapeHtml(item.full_name || "Unknown")} · ${escapeHtml(item.position || "-")} · ${escapeHtml(
            item.team || "-"
          )}</h3>
          <div class="player-detail-grid">
            <section class="detail-block">
              <h4>Dynasty Production</h4>
              <div class="detail-kv">${production}</div>
            </section>
            <section class="detail-block">
              <h4>Efficiency</h4>
              <div class="detail-kv">${efficiency}</div>
            </section>
            <section class="detail-block">
              <h4>Bio</h4>
              <div class="detail-kv">${bio}</div>
            </section>
            <section class="detail-block">
              <h4>Snapshot</h4>
              <div class="detail-kv">${snapshot}</div>
            </section>
          </div>
          <p class="brand-watermark subtle">fourthdownlabs.com</p>
        </article>
      </td>
    </tr>
  `;
}

function detailKv(label, value, key) {
  return `
    <div>
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(formatMetricValue(value, key))}</span>
    </div>
  `;
}

function onResultsBodyClick(event) {
  const row = event.target.closest("tr.screener-row[data-player-id]");
  if (!row) return;
  const playerId = String(row.dataset.playerId || "");
  if (!playerId) return;

  if (state.expandedPlayerIds.has(playerId)) {
    state.expandedPlayerIds.delete(playerId);
  } else {
    state.expandedPlayerIds.add(playerId);
  }

  const sortedItems = sortItems(state.lastItems);
  renderResults(sortedItems);
}

function getColumnRawValue(item, key) {
  if (key === "player_name") return item.full_name;
  if (key === "position") return item.position;
  if (key === "age") return item.age;
  if (key === "team") return item.team;
  return resolveMetricValue(item, item.metrics || {}, key);
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

function getColumnLabel(key) {
  const builtin = BUILTIN_COLUMNS.find((item) => item.key === key);
  if (builtin) return builtin.label;

  const option = state.metricIndex.get(key);
  if (option?.label) return option.label;
  return prettifyStatKey(key);
}

function isSortKeyNumeric(key) {
  return !["player_name", "position", "team"].includes(key);
}

function isBuiltinColumn(key) {
  return BUILTIN_COLUMNS.some((item) => item.key === key);
}

function isLockedColumn(key) {
  const match = BUILTIN_COLUMNS.find((item) => item.key === key);
  return Boolean(match?.locked);
}

function ageClassName(ageValue) {
  const age = Number(ageValue);
  if (!Number.isFinite(age)) return "age-unknown";
  if (age <= 23) return "age-young";
  if (age <= 26) return "age-prime";
  if (age <= 29) return "age-veteran";
  return "age-old";
}

function updateSortLabel() {
  dom.sort.textContent = `Sorted by ${getColumnLabel(state.sortKey)} (${state.sortDirection})`;
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
    renderMetricCategories();
    renderMetricOptions();
    renderActiveColumns();
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
    renderMetricCategories();
    renderMetricOptions();
    renderActiveColumns();
    renderActiveFilters();
    await runScreen();
    return;
  }

  setStatus("Sync still running in background. Refresh again in a minute.", "info");
}

function saveCurrentView() {
  const name = window.prompt("Name this view:", suggestViewName()) || "";
  const trimmed = name.trim();
  if (!trimmed) {
    setStatus("Save cancelled. View name is required.", "info");
    return;
  }

  const config = getCurrentViewConfig();
  const id = `${Date.now()}`;
  state.savedViews.unshift({
    id,
    name: trimmed,
    created_at: new Date().toISOString(),
    config
  });
  state.savedViews = state.savedViews.slice(0, 30);

  persistSavedViews();
  renderSavedViews();
  setStatus(`Saved view "${trimmed}".`, "success");
}

function suggestViewName() {
  const positions = [...state.selectedPositions];
  if (positions.length === 1) {
    return `${positions[0]} Screen`;
  }
  return "My Lab View";
}

async function shareCurrentView() {
  const encoded = encodeViewConfig(getCurrentViewConfig());
  const params = new URLSearchParams();
  params.set("view", encoded);

  const sortKey = String(state.sortKey || "").trim();
  if (sortKey) {
    params.set("sort", `${sortKey}:${state.sortDirection}`);
  }

  const positions = [...state.selectedPositions];
  if (positions.length) {
    params.set("positions", positions.join(","));
  }

  const session = getSleeperSession();
  const leagueId = String(session?.selected_league_id || "").trim();
  if (leagueId) {
    params.set("league", leagueId);
  }

  const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      setStatus("Share link copied to clipboard.", "success");
      return;
    }
  } catch (error) {
    // Fallback below.
  }

  window.prompt("Copy this share link:", url);
  setStatus("Share link ready to copy.", "info");
}

function clearSavedViews() {
  if (!state.savedViews.length) {
    setStatus("No saved views to clear.", "info");
    return;
  }
  const confirmed = window.confirm("Clear all saved views?");
  if (!confirmed) return;
  state.savedViews = [];
  persistSavedViews();
  renderSavedViews();
  setStatus("Cleared all saved views.", "success");
}

function onSavedViewsClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = String(button.dataset.action || "");
  const id = String(button.dataset.id || "");
  const index = state.savedViews.findIndex((item) => item.id === id);
  if (index === -1) return;

  if (action === "load-view") {
    applyViewConfig(state.savedViews[index].config || {});
    renderPositionPills();
    renderMetricCategories();
    renderMetricOptions();
    renderActiveColumns();
    renderActiveFilters();
    updateSortLabel();
    runScreen();
    setStatus(`Loaded view "${state.savedViews[index].name}".`, "success");
    return;
  }

  if (action === "delete-view") {
    state.savedViews.splice(index, 1);
    persistSavedViews();
    renderSavedViews();
    setStatus("Deleted saved view.", "info");
  }
}

function renderSavedViews() {
  if (!state.savedViews.length) {
    dom.savedViews.innerHTML = `<p class="saved-view-empty">No saved views yet.</p>`;
    return;
  }

  dom.savedViews.innerHTML = state.savedViews
    .map((item) => {
      return `
        <div class="saved-view-row">
          <button type="button" class="saved-view-load" data-action="load-view" data-id="${escapeHtml(item.id)}">
            ${escapeHtml(item.name)}
          </button>
          <button type="button" class="secondary-btn" data-action="delete-view" data-id="${escapeHtml(item.id)}">
            Delete
          </button>
        </div>
      `;
    })
    .join("");
}

function getCurrentViewConfig() {
  return {
    version: 1,
    search: String(dom.search.value || ""),
    team: String(dom.team.value || ""),
    age_min: String(dom.ageMin.value || ""),
    age_max: String(dom.ageMax.value || ""),
    positions: [...state.selectedPositions],
    active_columns: [...state.activeColumns],
    active_filters: state.activeFilters.map((item) => ({
      key: item.key,
      label: item.label,
      op: item.op,
      value: String(item.value ?? ""),
      valueMax: String(item.valueMax ?? "")
    })),
    sort_key: state.sortKey,
    sort_direction: state.sortDirection
  };
}

function applyViewConfig(rawConfig) {
  const config = rawConfig || {};

  dom.search.value = String(config.search || "");
  dom.team.value = String(config.team || "");
  dom.ageMin.value = String(config.age_min || "");
  dom.ageMax.value = String(config.age_max || "");

  state.selectedPositions = new Set(
    (Array.isArray(config.positions) ? config.positions : [])
      .map((item) => String(item || "").toUpperCase())
      .filter((item) => POSITION_ORDER.includes(item))
  );

  state.activeColumns = normalizeColumns(
    Array.isArray(config.active_columns) && config.active_columns.length ? config.active_columns : DEFAULT_COLUMNS
  );

  state.activeFilters = (Array.isArray(config.active_filters) ? config.active_filters : [])
    .map((item) => ({
      key: String(item.key || "").trim(),
      label: String(item.label || prettifyStatKey(item.key || "")),
      op: normalizeOperator(item.op),
      value: String(item.value ?? ""),
      valueMax: String(item.valueMax ?? item.value_max ?? "")
    }))
    .filter((item) => item.key);

  state.sortKey = String(config.sort_key || "fantasy_points_ppr");
  state.sortDirection = String(config.sort_direction || "desc") === "asc" ? "asc" : "desc";
}

function normalizeOperator(value) {
  const candidate = String(value || "").trim();
  const operators = new Set(["gte", "lte", "gt", "lt", "eq", "between"]);
  return operators.has(candidate) ? candidate : "gte";
}

function loadSavedViews() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.savedViews);
    if (!raw) {
      state.savedViews = [];
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      state.savedViews = [];
      return;
    }

    state.savedViews = parsed
      .map((item) => ({
        id: String(item.id || `${Date.now()}-${Math.random()}`),
        name: String(item.name || "Saved view"),
        created_at: item.created_at || "",
        config: item.config || {}
      }))
      .slice(0, 30);
  } catch (error) {
    state.savedViews = [];
  }
}

function persistSavedViews() {
  try {
    window.localStorage.setItem(STORAGE_KEYS.savedViews, JSON.stringify(state.savedViews));
  } catch (error) {
    // Ignore storage write failures.
  }
}

function persistLastView() {
  try {
    window.localStorage.setItem(STORAGE_KEYS.lastView, JSON.stringify(getCurrentViewConfig()));
  } catch (error) {
    // Ignore storage write failures.
  }
}

function readLastView() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.lastView);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function readSharedViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  applyLeagueFromQuery(params);
  const encoded = params.get("view");
  if (encoded) {
    try {
      const decoded = decodeViewConfig(encoded);
      return JSON.parse(decoded);
    } catch (error) {
      // Fall through to explicit query parsing below.
    }
  }
  return buildFallbackViewFromQuery(params);
}

function applyLeagueFromQuery(params) {
  const leagueId = String(params.get("league") || "").trim();
  if (!leagueId) return;
  updateSelectedLeague(leagueId);
}

function buildFallbackViewFromQuery(params) {
  if (!(params instanceof URLSearchParams)) return null;

  const config = {};
  const positions = String(params.get("positions") || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => POSITION_ORDER.includes(item));
  if (positions.length) {
    config.positions = positions;
  }

  const sortRaw = String(params.get("sort") || "").trim();
  if (sortRaw) {
    const [sortKeyRaw, sortDirectionRaw] = sortRaw.split(":");
    const sortKey = String(sortKeyRaw || "").trim();
    const sortDirection = String(sortDirectionRaw || "").trim().toLowerCase();
    if (sortKey) {
      config.sort_key = sortKey;
      if (sortDirection === "asc" || sortDirection === "desc") {
        config.sort_direction = sortDirection;
      }
    }
  }

  const hasConfig = Object.keys(config).length > 0;
  return hasConfig ? config : null;
}

function encodeViewConfig(config) {
  const raw = JSON.stringify(config);
  return base64UrlEncode(raw);
}

function decodeViewConfig(encoded) {
  return base64UrlDecode(String(encoded || ""));
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function categorizeMetricKey(key) {
  const token = String(key || "").toLowerCase();
  if (!token) return "advanced";

  if (
    ["age", "years_exp", "height", "weight", "draft", "birth", "college", "rookie"].some((part) =>
      token.includes(part)
    )
  ) {
    return "bio";
  }

  if (
    ["fantasy_points", "yards", "targets", "receptions", "attempts", "touchdowns", "carries", "snaps"].some((part) =>
      token.includes(part)
    )
  ) {
    return "production";
  }

  if (
    ["share", "pct", "percentage", "per_", "rate", "yac", "air", "yprr", "wopr", "epa", "efficiency"].some((part) =>
      token.includes(part)
    )
  ) {
    return "efficiency";
  }

  if (["ktc", "dynasty", "adp", "market", "value", "pick_value", "draft_capital"].some((part) => token.includes(part))) {
    return "dynasty";
  }

  if (["owner", "roster", "available", "starter", "bench", "waiver", "league_"].some((part) => token.includes(part))) {
    return "my_league";
  }

  return "advanced";
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
  if (value === null || value === undefined || value === "") return "-";

  if (["position", "team", "player_name"].includes(String(key || ""))) {
    return String(value);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);

  let digits = 2;
  if (key === "fantasy_points_ppr" || String(key).includes("points")) digits = 1;
  if (key === "age" || key === "years_exp" || String(key).includes("td")) digits = 0;
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
      if (["ppr", "std", "yac", "epa", "cpoe", "qb", "wr", "rb", "te", "td", "ktc"].includes(lower)) {
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
