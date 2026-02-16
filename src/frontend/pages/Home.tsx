import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <section className="card hero-card home-hero">
      <div className="home-hero__bg" aria-hidden="true">
        <div className="field-glow" />
        <div className="goalpost" />
        <div className="yard-lines" />
        <div className="football football-1" />
        <div className="football football-2" />
        <div className="football football-3" />
        <div className="kick-suggestion">Potential Suggestion</div>
      </div>
      <div className="home-hero__content">
        <p className="kicker">SCALABILITY REWRITE</p>
        <h1>Fourth Down Labs v2</h1>
        <p>
          This is the parallel v2 product surface running on typed APIs, safer rendering, and modular architecture.
        </p>
        <div className="button-row">
          <Link className="btn btn-primary" to="/lab">
            Open The Lab
          </Link>
          <Link className="btn" to="/league-intel">
            Open League Intel
          </Link>
        </div>
        <div className="grid cols-3">
          <article className="mini-card">
            <h3>Typed API contracts</h3>
            <p>All v2 endpoints use a standard envelope and explicit schemas.</p>
          </article>
          <article className="mini-card">
            <h3>Pagination-first UX</h3>
            <p>Screener now uses server-side paging and URL-synced filters.</p>
          </article>
          <article className="mini-card">
            <h3>Parallel cutover</h3>
            <p>Legacy app remains active while v2 stabilizes under /v2.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
