const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
const SLEEPER_AVATAR_BASE = "https://sleepercdn.com/avatars/thumbs";
const SESSION_STORAGE_KEY = "fdl_sleeper_session_v1";

export function currentSleeperSeason(now = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() + 1 >= 8 ? year : year - 1;
}

export function getSleeperSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.user_id || !parsed.username) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

export function setSleeperSession(session) {
  if (!session || !session.user_id || !session.username) return;
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSleeperSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function fetchSleeperJSON(path) {
  const response = await fetch(`${SLEEPER_API_BASE}${path}`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("Sleeper resource not found.");
    throw new Error(`Sleeper API error ${response.status}.`);
  }
  return response.json();
}

export async function connectSleeperByUsername(usernameInput, seasonInput) {
  const username = String(usernameInput || "").trim();
  const season = Number(seasonInput) || currentSleeperSeason();

  if (!username) {
    throw new Error("Enter a Sleeper username.");
  }

  const user = await fetchSleeperJSON(`/user/${encodeURIComponent(username)}`);
  if (!user || !user.user_id) {
    throw new Error("Sleeper user not found.");
  }

  const leagues = await fetchSleeperJSON(`/user/${user.user_id}/leagues/nfl/${season}`);
  const orderedLeagues = Array.isArray(leagues)
    ? [...leagues].sort((a, b) => (b.total_rosters || 0) - (a.total_rosters || 0))
    : [];

  const session = {
    user_id: String(user.user_id),
    username: user.display_name || user.username || username,
    username_raw: username,
    avatar: user.avatar || "",
    avatar_url: user.avatar ? `${SLEEPER_AVATAR_BASE}/${encodeURIComponent(user.avatar)}` : "",
    season,
    selected_league_id: orderedLeagues[0]?.league_id || "",
    leagues: orderedLeagues.map((league) => ({
      league_id: String(league.league_id || ""),
      name: league.name || "Sleeper League",
      season: Number(league.season || season),
      total_rosters: Number(league.total_rosters || 0),
      previous_league_id: league.previous_league_id || ""
    })),
    connected_at: new Date().toISOString()
  };

  setSleeperSession(session);
  return session;
}

export function updateSelectedLeague(leagueId) {
  const session = getSleeperSession();
  if (!session) return null;
  session.selected_league_id = String(leagueId || "");
  setSleeperSession(session);
  return session;
}

export function hydrateHeader(activePage) {
  document.querySelectorAll("[data-nav-page]").forEach((node) => {
    const isActive = String(node.dataset.navPage || "") === String(activePage || "");
    node.classList.toggle("active", isActive);
  });
}

export function renderConnectButton() {
  const button = document.querySelector("#connect-sleeper-btn");
  if (!button) return;

  const session = getSleeperSession();
  if (!session) {
    button.innerHTML = "";
    button.textContent = "Connect Sleeper";
    button.classList.remove("connected");
    button.title = "Connect your Sleeper username";
    return;
  }

  const handle = `@${session.username_raw || session.username}`;
  button.innerHTML = "";
  const avatar = document.createElement("span");
  avatar.className = "nav-avatar";
  const avatarUrl = String(session.avatar_url || "");
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = `${handle} avatar`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      avatar.textContent = String((session.username_raw || session.username || "?").charAt(0)).toUpperCase();
    });
    avatar.append(image);
  } else {
    avatar.textContent = String((session.username_raw || session.username || "?").charAt(0)).toUpperCase();
  }

  const label = document.createElement("span");
  label.className = "nav-connect-label";
  label.textContent = handle;
  button.append(avatar, label);

  button.classList.add("connected");
  button.title = "Connected. Click to switch or disconnect.";
}

export function bindConnectButton({ onConnected, onDisconnected } = {}) {
  const button = document.querySelector("#connect-sleeper-btn");
  if (!button) return;
  renderConnectButton();

  button.addEventListener("click", async () => {
    const existing = getSleeperSession();

    if (existing) {
      const action = window.prompt(
        "Type 'switch' to connect another username, or 'disconnect' to clear the current Sleeper session.",
        "switch"
      );

      if (!action) return;
      const normalized = action.trim().toLowerCase();
      if (normalized === "disconnect") {
        clearSleeperSession();
        renderConnectButton();
        if (onDisconnected) onDisconnected();
        return;
      }
      if (normalized !== "switch") return;
    }

    const defaultName = existing?.username_raw || "";
    const username = window.prompt("Enter Sleeper username:", defaultName);
    if (!username) return;
    const seasonPrompt = window.prompt("NFL season year:", String(currentSleeperSeason()));
    const season = Number(seasonPrompt) || currentSleeperSeason();

    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Connecting...";
    try {
      const session = await connectSleeperByUsername(username, season);
      renderConnectButton();
      if (onConnected) onConnected(session);
    } catch (error) {
      window.alert(error.message);
      button.textContent = previous;
      renderConnectButton();
    } finally {
      button.disabled = false;
    }
  });
}
