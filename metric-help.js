import { escapeHtml } from "./utils.js";

const dom = {
  search: document.querySelector("#metric-help-search"),
  body: document.querySelector("#metric-help-body")
};

let metrics = [];

init();

async function init() {
  await loadMetrics();
  render();
  dom.search?.addEventListener("input", render);
}

async function loadMetrics() {
  try {
    const response = await fetch("/api/filter-options?limit=5000");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    metrics = (payload.items || [])
      .filter((item) => item?.key)
      .map((item) => ({
        key: String(item.key),
        label: String(item.label || prettifyStatKey(item.key)),
        description: explainMetric(item.key)
      }));
  } catch (error) {
    metrics = [];
  }
}

function render() {
  const query = String(dom.search?.value || "").trim().toLowerCase();
  const rows = metrics
    .filter((item) => {
      if (!query) return true;
      return item.key.toLowerCase().includes(query) || item.label.toLowerCase().includes(query);
    })
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td><code>${escapeHtml(item.key)}</code></td>
        <td>${escapeHtml(item.description)}</td>
      </tr>
    `
    )
    .join("");

  dom.body.innerHTML = rows || `<tr><td colspan="3">No metrics found.</td></tr>`;
}

function explainMetric(key) {
  const k = String(key || "").toLowerCase();
  if (k.includes("age")) return "Player age in years.";
  if (k.includes("target_share")) return "Share of team targets earned by the player.";
  if (k.includes("air_yards")) return "How far downfield targets are, in aggregate or share terms.";
  if (k.includes("yac") || k.includes("yards_after_catch")) return "Yards gained after securing the catch.";
  if (k.includes("wopr")) return "Composite opportunity metric combining target share and air yards share.";
  if (k.includes("epa")) return "Expected points added impact on plays.";
  if (k.includes("fantasy_points")) return "Fantasy scoring output under a specific scoring format.";
  if (k.includes("reception")) return "Receiving volume and efficiency outcomes.";
  if (k.includes("rushing")) return "Rushing workload and production outcomes.";
  if (k.includes("passing")) return "Passing workload and efficiency outcomes.";
  if (k.includes("td")) return "Touchdown production.";
  if (k.includes("turnover") || k.includes("interception") || k.includes("fumble")) return "Turnover events that hurt possession value.";
  return "Performance or usage metric from the live NFL data catalog.";
}

function prettifyStatKey(rawKey) {
  const key = String(rawKey || "");
  if (!key) return "Metric";
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (["ppr", "yac", "epa", "cpoe", "adot", "qb", "rb", "wr", "te"].includes(lower)) {
        return lower.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
