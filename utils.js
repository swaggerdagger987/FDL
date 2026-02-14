const ESCAPE_HTML_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (token) => ESCAPE_HTML_MAP[token]);
}

export function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), Number(min)), Number(max));
}

export function dedupe(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (value === undefined || value === null) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function signed(value, digits = 2) {
  const numeric = round(value, digits);
  if (numeric > 0) return `+${numeric}`;
  return `${numeric}`;
}

export function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
