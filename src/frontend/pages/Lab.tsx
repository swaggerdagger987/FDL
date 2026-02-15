import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "@shared/api/client";

type MetricOption = {
  key: string;
  label: string;
  min_value: number | null;
  max_value: number | null;
  player_count: number;
};

type ScreenerPlayer = {
  player_id: string;
  full_name: string;
  position: string;
  team: string;
  age: number | null;
  latest_fantasy_points_ppr: number | null;
  metrics: Record<string, number>;
};

type ScreenerResponse = {
  items: ScreenerPlayer[];
  page: { limit: number; offset: number; total: number; has_next: boolean };
  sort: { key: string; direction: "asc" | "desc" };
  columns: string[];
};

type Filter = { key: string; op: "gte" | "lte"; value: string };

const PAGE_SIZE = 50;

export function LabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [options, setOptions] = useState<MetricOption[]>([]);
  const [rows, setRows] = useState<ScreenerPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [sortKey, setSortKey] = useState(searchParams.get("sort") || "fantasy_points_ppr");
  const [sortDir, setSortDir] = useState<"asc" | "desc">((searchParams.get("dir") as "asc" | "desc") || "desc");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [positions, setPositions] = useState<string[]>(searchParams.get("positions")?.split(",").filter(Boolean) || []);
  const [team, setTeam] = useState(searchParams.get("team") || "");
  const [ageMin, setAgeMin] = useState(searchParams.get("age_min") || "");
  const [ageMax, setAgeMax] = useState(searchParams.get("age_max") || "");
  const [offset, setOffset] = useState(Number(searchParams.get("offset") || 0));
  const [metricKey, setMetricKey] = useState("");
  const [metricMin, setMetricMin] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);

  const selectedColumns = useMemo(() => {
    return ["fantasy_points_ppr", ...filters.map((item) => item.key)].filter((value, index, all) => all.indexOf(value) === index);
  }, [filters]);

  useEffect(() => {
    apiGet<{ items: MetricOption[] }>("/api/v2/screener/options?limit=1000")
      .then((payload) => setOptions(payload.items))
      .catch(() => setOptions([]));
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (positions.length) next.set("positions", positions.join(","));
    if (team) next.set("team", team);
    if (ageMin) next.set("age_min", ageMin);
    if (ageMax) next.set("age_max", ageMax);
    next.set("sort", sortKey);
    next.set("dir", sortDir);
    next.set("offset", String(offset));
    setSearchParams(next, { replace: true });
  }, [search, positions, team, ageMin, ageMax, sortKey, sortDir, offset, setSearchParams]);

  useEffect(() => {
    setLoading(true);
    setError("");
    apiPost<ScreenerResponse>("/api/v2/screener/query", {
      search,
      positions,
      team,
      age_min: ageMin ? Number(ageMin) : null,
      age_max: ageMax ? Number(ageMax) : null,
      filters: filters.map((entry) => ({ key: entry.key, op: entry.op, value: Number(entry.value) })),
      columns: selectedColumns,
      sort: { key: sortKey, direction: sortDir },
      page: { limit: PAGE_SIZE, offset }
    })
      .then((payload) => {
        setRows(payload.items);
        setTotal(payload.page.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [search, positions, team, ageMin, ageMax, filters, sortKey, sortDir, offset, selectedColumns]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
  };

  const togglePosition = (value: string) => {
    setOffset(0);
    setPositions((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };

  const addMetricFilter = () => {
    if (!metricKey || !metricMin) return;
    setFilters((prev) => [...prev, { key: metricKey, op: "gte", value: metricMin }]);
    setMetricMin("");
    setOffset(0);
  };

  return (
    <section className="card">
      <h1>The Lab (v2)</h1>
      <p className="muted">Paginated screener with URL-synced state and typed API contracts.</p>

      <form className="grid cols-4" onSubmit={onSubmit}>
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Player name" />
        </label>
        <label>
          Team
          <input value={team} onChange={(event) => setTeam(event.target.value.toUpperCase())} placeholder="e.g. SF" />
        </label>
        <label>
          Min age
          <input value={ageMin} onChange={(event) => setAgeMin(event.target.value)} type="number" min={18} max={45} />
        </label>
        <label>
          Max age
          <input value={ageMax} onChange={(event) => setAgeMax(event.target.value)} type="number" min={18} max={45} />
        </label>
        <label>
          Sort key
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            <option value="fantasy_points_ppr">Fantasy Points (PPR)</option>
            <option value="age">Age</option>
            <option value="team">Team</option>
            <option value="player_name">Player Name</option>
            <option value="target_share">Target Share</option>
          </select>
        </label>
        <label>
          Sort direction
          <select value={sortDir} onChange={(event) => setSortDir(event.target.value as "asc" | "desc")}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </label>
        <div className="position-chip-wrap">
          {"QB,RB,WR,TE,K".split(",").map((position) => (
            <button
              key={position}
              type="button"
              className={positions.includes(position) ? "chip active" : "chip"}
              onClick={() => togglePosition(position)}
            >
              {position}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" type="submit">
          Refresh
        </button>
      </form>

      <div className="card inset-card">
        <h3>Metric filters</h3>
        <div className="grid cols-3">
          <label>
            Metric
            <select value={metricKey} onChange={(event) => setMetricKey(event.target.value)}>
              <option value="">Select</option>
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum value
            <input value={metricMin} onChange={(event) => setMetricMin(event.target.value)} type="number" />
          </label>
          <button className="btn" type="button" onClick={addMetricFilter}>
            Add filter
          </button>
        </div>
        <div className="filter-row">
          {filters.map((filter, index) => (
            <button
              className="chip active"
              key={`${filter.key}-${index}`}
              type="button"
              onClick={() => setFilters((prev) => prev.filter((_, i) => i !== index))}
            >
              {filter.key} &gt;= {filter.value} ×
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="muted">Loading screen…</p> : null}

      <div className="table-card">
        <div className="table-meta">
          <strong>{total.toLocaleString()} players</strong>
          <span>
            Showing {offset + 1} - {Math.min(offset + rows.length, total)}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>Age</th>
              <th>PPR</th>
              {selectedColumns.filter((item) => item !== "fantasy_points_ppr").map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.player_id}>
                <td>{row.full_name}</td>
                <td>{row.position}</td>
                <td>{row.team}</td>
                <td>{row.age ?? "-"}</td>
                <td>{row.latest_fantasy_points_ppr ?? "-"}</td>
                {selectedColumns
                  .filter((item) => item !== "fantasy_points_ppr")
                  .map((column) => (
                    <td key={`${row.player_id}-${column}`}>{row.metrics[column] ?? "-"}</td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="button-row">
        <button className="btn" disabled={offset <= 0} onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}>
          Previous
        </button>
        <button className="btn" disabled={offset + rows.length >= total} onClick={() => setOffset((prev) => prev + PAGE_SIZE)}>
          Next
        </button>
      </div>
    </section>
  );
}
