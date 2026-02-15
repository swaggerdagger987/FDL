import { useEffect, useState } from "react";
import { apiGet } from "@shared/api/client";

type IntelManager = {
  manager_id: string;
  display_name: string;
  aggression_score: number;
  trade_friendliness: number;
  weakness?: string;
};

type IntelPayload = {
  league_id: string;
  lookback: number;
  summary: Record<string, unknown>;
  managers: IntelManager[];
};

export function LeagueIntelPage() {
  const [leagueId, setLeagueId] = useState("");
  const [lookback, setLookback] = useState(2);
  const [payload, setPayload] = useState<IntelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    apiGet<IntelPayload>(`/api/v2/intel/report?league_id=${encodeURIComponent(leagueId)}&lookback=${lookback}`)
      .then(setPayload)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [leagueId, lookback]);

  return (
    <section className="card">
      <h1>League Intel (v2)</h1>
      <p className="muted">v2 endpoint is active with typed contracts and deep-dive route compatibility.</p>
      <div className="grid cols-3">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} placeholder="Optional Sleeper league id" />
        </label>
        <label>
          Lookback
          <select value={lookback} onChange={(event) => setLookback(Number(event.target.value))}>
            <option value={1}>1 season</option>
            <option value={2}>2 seasons</option>
            <option value={3}>3 seasons</option>
            <option value={4}>4 seasons</option>
          </select>
        </label>
      </div>
      {loading ? <p className="muted">Loading intel…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {payload ? (
        <>
          <pre className="json-block">{JSON.stringify(payload.summary, null, 2)}</pre>
          <div className="grid cols-3">
            {payload.managers.map((manager) => (
              <article className="mini-card" key={manager.manager_id}>
                <h3>{manager.display_name}</h3>
                <p>Aggression: {manager.aggression_score}</p>
                <p>Trade Friendliness: {manager.trade_friendliness}</p>
                <p>Weakness: {manager.weakness || "-"}</p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
