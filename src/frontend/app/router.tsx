import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import { HomePage } from "@pages/Home";
import { LabPage } from "@pages/Lab";
import { LeagueIntelPage } from "@pages/LeagueIntel";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="page-shell">
      <header className="top-nav">
        <Link className="brand" to="/">Fourth Down Labs v2</Link>
        <nav className="nav-links">
          <Link to="/lab">The Lab</Link>
          <Link to="/league-intel">League Intel</Link>
        </nav>
      </header>
      <main className="content-wrap">{children}</main>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter basename="/v2">
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/lab" element={<LabPage />} />
          <Route path="/league-intel" element={<LeagueIntelPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
