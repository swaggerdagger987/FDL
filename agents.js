import { bindConnectButton, getLabContext, getLeagueIntelContext, hydrateHeader } from "./site_state.js";

const AGENT_CONFIG_STORAGE_KEY = "fdl.agentConfigs.v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const AGENT_RESPONSE_TIMEOUT_MS = 20000;
const PROVIDER_TIMEOUT_SECONDS = 18;
const BRIEF_MAX_CHARS = 120;
const BRIEF_MAX_POINTS = 3;
const TOTAL_RESPONSE_MAX_CHARS = 420;
const LOW_SIGNAL_FALLBACK = "notmuch for me to comment on";
const AGENT_DEFINITIONS = [
  {
    id: 1,
    name: "Hootsworth",
    role: "Chief of Staff",
    purpose: "Central coordinator that triages all agent signals, resolves conflicts, and briefs the GM by urgency.",
    avatarPath: "./pixel-agents/assets/characters/char_0.png",
    promptPath: "./agent-personas/hootsworth.md"
  },
  {
    id: 2,
    name: "Dr. Dolphin",
    role: "Medical Analyst",
    purpose: "Injury desk for status clarity, return timelines, confidence ranges, and post-return performance impact.",
    avatarPath: "./pixel-agents/assets/characters/char_1.png",
    promptPath: "./agent-personas/dr-dolphin.md"
  },
  {
    id: 3,
    name: "Hawkeye",
    role: "Scout",
    purpose: "Usage and talent evaluator that flags breakouts, role shifts, and waiver targets before the market reacts.",
    avatarPath: "./pixel-agents/assets/characters/char_2.png",
    promptPath: "./agent-personas/hawkeye.md"
  },
  {
    id: 4,
    name: "The Fox",
    role: "Diplomat (Adversarial Intelligence)",
    purpose: "Leaguemate and market strategist focused on trade leverage, FAAB game theory, and negotiation timing.",
    avatarPath: "./pixel-agents/assets/characters/char_3.png",
    promptPath: "./agent-personas/the-fox.md"
  },
  {
    id: 5,
    name: "The Octopus",
    role: "Quant (Valuations and Modeling)",
    purpose: "Valuation and probability engine for player/pick pricing, trade fairness, title odds, and EV-max paths.",
    avatarPath: "./pixel-agents/assets/characters/char_4.png",
    promptPath: "./agent-personas/the-octopus.md"
  },
  {
    id: 6,
    name: "The Elephant",
    role: "Historian (League Memory)",
    purpose: "Institutional memory that maps league precedents, manager tendencies, and long-cycle market patterns.",
    avatarPath: "./pixel-agents/assets/characters/char_5.png",
    promptPath: "./agent-personas/the-elephant.md"
  }
];
const personaCache = new Map();
const simulationState = {
  running: new Set(),
  lastByAgent: new Map(),
};

initialize();

function initialize() {
  hydrateHeader("agents");
  bindConnectButton();
  setupAgentConfigPanel();
  setupAgentBioPanel();
  setupContextBridge();
  setupAgentSimulationPanel();
  setupAgentControls();
}

function setupContextBridge() {
  const bridgeBody = document.getElementById("agents-context-bridge-body");
  if (!(bridgeBody instanceof HTMLElement)) {
    return;
  }

  const render = () => {
    renderContextBridge(bridgeBody, getLabContext(), getLeagueIntelContext());
  };

  render();
  window.addEventListener("storage", render);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      render();
    }
  });
}

function renderContextBridge(host, labContext, intelContext) {
  const lines = [];

  if (labContext) {
    const players = Array.isArray(labContext.top_players) ? labContext.top_players.slice(0, 3) : [];
    const playerLine = players.length
      ? players.map((item) => `${item.player_name} (${item.position}, ${item.team})`).join(" | ")
      : "No top players captured yet.";
    lines.push(
      `<p><strong>Lab:</strong> ${escapeHtml(String(labContext.item_count || 0))} players, ${escapeHtml(
        String(labContext.filter_count || 0)
      )} filters, sorted by ${escapeHtml(String(labContext.sort_key || "-"))} (${escapeHtml(
        String(labContext.sort_direction || "-")
      )}).</p>`
    );
    lines.push(`<p><strong>Lab Top Targets:</strong> ${escapeHtml(playerLine)}</p>`);
  }

  if (intelContext) {
    const focus = intelContext.selected_manager?.display_name
      ? `${intelContext.selected_manager.display_name} | weak: ${(intelContext.selected_manager.weak_positions || []).join(", ") || "-"}`
      : "No manager is currently opened in detail view.";
    lines.push(
      `<p><strong>League Intel:</strong> ${escapeHtml(String(intelContext.league_name || "Sleeper League"))}, ${
        escapeHtml(String(intelContext.seasons_analyzed || 0))
      } season lookback, ${escapeHtml(String(intelContext.total_transactions || 0))} transactions.</p>`
    );
    lines.push(`<p><strong>Intel Focus:</strong> ${escapeHtml(focus)}</p>`);
  }

  if (!lines.length) {
    host.innerHTML = `<p class="scenario-bridge-empty">Run a screen in Lab and compute a report in League Intel to feed agent context.</p>`;
    return;
  }

  const labTime = String(labContext?.updated_at || "").trim();
  const intelTime = String(intelContext?.updated_at || "").trim();
  const freshness = [labTime ? `Lab: ${labTime}` : "", intelTime ? `Intel: ${intelTime}` : ""].filter(Boolean).join(" | ");
  const freshnessLine = freshness ? `<p><strong>Last Sync:</strong> ${escapeHtml(freshness)}</p>` : "";

  host.innerHTML = `${lines.join("")}${freshnessLine}`;
}

async function setupAgentBioPanel() {
  const host = document.getElementById("agents-bio-list");
  if (!host) {
    return;
  }

  host.innerHTML = AGENT_DEFINITIONS.map((agent) => `
    <article class="agent-bio-row" data-agent-bio="${agent.id}">
      <div class="agent-bio-visual">
        <img class="agent-bio-avatar" src="${escapeAttribute(agent.avatarPath)}" alt="${escapeAttribute(agent.name)} pixel avatar" />
      </div>
      <div class="agent-bio-body">
        <div class="agent-bio-head">
          <h3 class="agent-bio-name">${escapeHtml(agent.name)}</h3>
          <p class="agent-bio-role">${escapeHtml(agent.role)}</p>
        </div>
        <p class="agent-bio-summary">${escapeHtml(agent.purpose)}</p>
        <ul class="agent-bio-points">
          <li>Loading persona quick notes...</li>
        </ul>
      </div>
    </article>
  `).join("");

  await Promise.all(
    AGENT_DEFINITIONS.map(async (agent) => {
      const row = host.querySelector(`[data-agent-bio="${agent.id}"]`);
      if (!(row instanceof HTMLElement)) {
        return;
      }
      const list = row.querySelector(".agent-bio-points");
      if (!(list instanceof HTMLUListElement)) {
        return;
      }
      try {
        const persona = await loadPersonaPrompt(agent);
        const points = buildQuickBioPoints(persona);
        list.innerHTML = points.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      } catch (_error) {
        list.innerHTML = "<li>Persona summary unavailable. Using role definition only.</li>";
      }
    })
  );
}

function buildQuickBioPoints(markdown) {
  const rolePoints = extractSectionBullets(markdown, "Role");
  const voicePoints = extractSectionBullets(markdown, "Voice");
  const accessPoints = extractSectionBullets(markdown, "Data Access");

  const output = [];
  if (rolePoints.length > 0) output.push(`Mission: ${rolePoints[0]}`);
  if (voicePoints.length > 0) output.push(`Voice: ${voicePoints[0]}`);
  if (accessPoints.length > 0) output.push(`Data: ${accessPoints[0]}`);

  if (output.length === 0) {
    return ["Specialist front-office agent with role-based decision support."];
  }
  return output.slice(0, 3);
}

function extractSectionBullets(markdown, sectionName) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `${sectionName.toLowerCase()}:`);
  if (start < 0) return [];
  const collected = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }
    if (/^[A-Za-z].*:$/.test(line)) break;
    if (line.startsWith("- ")) {
      collected.push(line.slice(2).trim());
    }
  }
  return collected;
}

function setupAgentConfigPanel() {
  const cardsHost = document.getElementById("agent-cards");
  const status = document.getElementById("agents-status");
  const iframe = document.getElementById("agents-iframe");
  const allKeyInput = document.getElementById("all-agent-key");
  const saveAllButton = document.getElementById("save-all-agent-keys");
  const allModelInput = document.getElementById("all-agent-model");
  const saveAllModelButton = document.getElementById("save-all-agent-model");
  if (!cardsHost) {
    return;
  }

  const config = loadAgentConfig();
  if (allModelInput instanceof HTMLInputElement) {
    const firstAgentModel = config[String(AGENT_DEFINITIONS[0]?.id)]?.model;
    allModelInput.value = typeof firstAgentModel === "string" && firstAgentModel.trim()
      ? firstAgentModel.trim()
      : DEFAULT_MODEL;
  }
  cardsHost.innerHTML = AGENT_DEFINITIONS.map((agent) => {
    const existing = config[String(agent.id)] || {};
    const apiKey = typeof existing.apiKey === "string" ? existing.apiKey : "";
    return `
      <article class="agent-card" data-agent-id="${agent.id}">
        <h3>${escapeHtml(agent.name)}</h3>
        <p class="agent-role">${escapeHtml(agent.role)}</p>
        <p class="agent-purpose">${escapeHtml(agent.purpose)}</p>
        <label class="agent-key-label" for="agent-key-${agent.id}">API Key</label>
        <input
          id="agent-key-${agent.id}"
          class="agent-key-input"
          type="password"
          autocomplete="off"
          placeholder="sk-..."
          value="${escapeAttribute(apiKey)}"
        />
        <button class="agent-save-btn" type="button">Save API Key</button>
      </article>
    `;
  }).join("");

  for (const card of cardsHost.querySelectorAll(".agent-card")) {
    const id = Number(card.getAttribute("data-agent-id"));
    const input = card.querySelector(".agent-key-input");
    const button = card.querySelector(".agent-save-btn");
    if (!id || !(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
      continue;
    }
    button.addEventListener("click", () => {
      const current = loadAgentConfig();
      const existing = current[String(id)] || {};
      current[String(id)] = {
        apiKey: input.value.trim(),
        model: typeof existing.model === "string" && existing.model.trim() ? existing.model : DEFAULT_MODEL,
        baseUrl: typeof existing.baseUrl === "string" && existing.baseUrl.trim() ? existing.baseUrl : DEFAULT_BASE_URL
      };
      localStorage.setItem(AGENT_CONFIG_STORAGE_KEY, JSON.stringify(current));
      if (status) {
        status.textContent = `Saved API key for ${AGENT_DEFINITIONS[id - 1]?.name || `Agent ${id}`}. Reloading tactical map to apply.`;
      }
      if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) {
        iframe.contentWindow.location.reload();
      }
    });
  }

  if (allKeyInput instanceof HTMLInputElement && saveAllButton instanceof HTMLButtonElement) {
    saveAllButton.addEventListener("click", () => {
      const sharedKey = allKeyInput.value.trim();
      if (!sharedKey) {
        if (status) {
          status.textContent = "Enter an API key first, then click Apply To All 6.";
        }
        return;
      }
      const current = loadAgentConfig();
      for (const agent of AGENT_DEFINITIONS) {
        const existing = current[String(agent.id)] || {};
        current[String(agent.id)] = {
          apiKey: sharedKey,
          model: typeof existing.model === "string" && existing.model.trim() ? existing.model : DEFAULT_MODEL,
          baseUrl: typeof existing.baseUrl === "string" && existing.baseUrl.trim() ? existing.baseUrl : DEFAULT_BASE_URL
        };
      }
      localStorage.setItem(AGENT_CONFIG_STORAGE_KEY, JSON.stringify(current));
      allKeyInput.value = "";
      for (const card of cardsHost.querySelectorAll(".agent-card")) {
        const input = card.querySelector(".agent-key-input");
        if (input instanceof HTMLInputElement) {
          input.value = sharedKey;
        }
      }
      if (status) {
        status.textContent = "Applied API key to all six agents (stored locally in this browser).";
      }
      if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) {
        iframe.contentWindow.location.reload();
      }
    });
  }

  if (allModelInput instanceof HTMLInputElement && saveAllModelButton instanceof HTMLButtonElement) {
    saveAllModelButton.addEventListener("click", () => {
      const sharedModel = allModelInput.value.trim();
      if (!sharedModel) {
        if (status) {
          status.textContent = "Enter a model first, then click Apply Model To All 6.";
        }
        return;
      }
      const current = loadAgentConfig();
      for (const agent of AGENT_DEFINITIONS) {
        const existing = current[String(agent.id)] || {};
        current[String(agent.id)] = {
          apiKey: typeof existing.apiKey === "string" ? existing.apiKey : "",
          model: sharedModel,
          baseUrl: typeof existing.baseUrl === "string" && existing.baseUrl.trim() ? existing.baseUrl : DEFAULT_BASE_URL
        };
      }
      localStorage.setItem(AGENT_CONFIG_STORAGE_KEY, JSON.stringify(current));
      if (status) {
        status.textContent = `Applied model "${sharedModel}" to all six agents.`;
      }
    });
  }
}

function loadAgentConfig() {
  try {
    const raw = localStorage.getItem(AGENT_CONFIG_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch (_error) {
    return {};
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function setupAgentSimulationPanel() {
  const grid = document.getElementById("scenario-grid");
  const runAllBtn = document.getElementById("run-all-agents");
  const scenarioInput = document.getElementById("scenario-input");
  const scenarioUsername = document.getElementById("scenario-username");
  const status = document.getElementById("agents-status");
  if (!grid || !runAllBtn || !(scenarioInput instanceof HTMLTextAreaElement)) {
    return;
  }

  grid.innerHTML = AGENT_DEFINITIONS.map((agent) => `
    <article class="scenario-card" data-agent-id="${agent.id}">
      <h3>${escapeHtml(agent.name)}</h3>
      <p class="scenario-role">${escapeHtml(agent.role)}</p>
      <p class="scenario-insight">${escapeHtml(agent.purpose)}</p>
      <div class="scenario-toolbar">
        <button class="scenario-btn" type="button" data-action="run-agent">Run ${escapeHtml(agent.name)}</button>
        <button class="scenario-btn-secondary" type="button" data-action="dig-agent" disabled>Dig Further</button>
      </div>
      <pre class="scenario-output" data-output>Ready. Add API key in the panel above and run this agent.</pre>
    </article>
  `).join("");

  grid.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const runButton = event.target.closest("button[data-action='run-agent']");
    const digButton = event.target.closest("button[data-action='dig-agent']");
    const card = event.target.closest(".scenario-card");
    const agentId = Number(card?.getAttribute("data-agent-id"));
    if (!agentId) {
      return;
    }
    if (runButton instanceof HTMLButtonElement) {
      await runAgentSimulation(agentId, scenarioInput.value.trim(), {
        username: scenarioUsername instanceof HTMLInputElement ? scenarioUsername.value.trim() : "",
        peerInsights: null,
        mode: "brief",
      });
      return;
    }
    if (digButton instanceof HTMLButtonElement) {
      const prior = simulationState.lastByAgent.get(agentId);
      await runAgentSimulation(agentId, scenarioInput.value.trim(), {
        username: scenarioUsername instanceof HTMLInputElement ? scenarioUsername.value.trim() : "",
        peerInsights: null,
        mode: "dig",
        previousOutput: prior?.output || "",
      });
    }
  });

  runAllBtn.addEventListener("click", async () => {
    await runAllAgentsWorkflow({
      scenarioInput,
      scenarioUsername,
      runAllBtn,
      status,
    });
  });
}

async function runAllAgentsWorkflow({ scenarioInput, scenarioUsername, runAllBtn, status }) {
  const scenario = scenarioInput instanceof HTMLTextAreaElement ? scenarioInput.value.trim() : "";
  const username = scenarioUsername instanceof HTMLInputElement ? scenarioUsername.value.trim() : "";
  runAllBtn.disabled = true;
  if (status) {
    status.textContent = "Running full agent team in parallel...";
  }
  try {
    const peerAgents = AGENT_DEFINITIONS.filter((agent) => agent.name !== "Hootsworth");
    const peerResults = await Promise.all(
      peerAgents.map(async (agent) => {
        const text = await runAgentSimulation(agent.id, scenario, {
          username,
          peerInsights: null,
          teamMode: true,
        });
        return text ? { name: agent.name, text } : null;
      })
    );
    const peerOutputs = peerResults.filter(Boolean);

    const hootsworth = AGENT_DEFINITIONS.find((agent) => agent.name === "Hootsworth");
    if (hootsworth) {
      await runAgentSimulation(hootsworth.id, scenario, {
        username,
        peerInsights: peerOutputs,
        mode: "brief",
        teamMode: true,
      });
    }
    if (status) {
      status.textContent = "Full team complete. Hootsworth has synthesized all specialist recommendations.";
    }
  } finally {
    runAllBtn.disabled = false;
  }
}

async function runAgentSimulation(agentId, scenarioText, options = {}) {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === agentId);
  if (!agent) {
    return null;
  }

  const card = document.querySelector(`.scenario-card[data-agent-id="${agentId}"]`);
  const output = card?.querySelector("[data-output]");
  const button = card?.querySelector("button[data-action='run-agent']");
  const digButton = card?.querySelector("button[data-action='dig-agent']");
  if (!(output instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
    return null;
  }

  if (!scenarioText) {
    output.textContent = "Scenario is empty. Add a scenario prompt and rerun.";
    return null;
  }

  const config = loadAgentConfig();
  const agentConfig = config[String(agentId)] || {};
  const apiKey = typeof agentConfig.apiKey === "string" ? agentConfig.apiKey.trim() : "";
  const model = typeof agentConfig.model === "string" && agentConfig.model.trim() ? agentConfig.model.trim() : DEFAULT_MODEL;
  let baseUrl = typeof agentConfig.baseUrl === "string" && agentConfig.baseUrl.trim()
    ? agentConfig.baseUrl.trim()
    : DEFAULT_BASE_URL;

  if (!apiKey) {
    output.textContent = "No API key saved for this agent. Enter one above, then rerun.";
    return null;
  }

  if (looksLikeModelString(apiKey)) {
    output.textContent = "It looks like you entered a model in the API key field. Put your OpenRouter key (sk-or-v1-...) in API key and keep model as e.g. stepfun/step-3.5-flash:free.";
    return null;
  }

  if (looksLikeApiKey(model)) {
    output.textContent = "It looks like you entered an API key in the model field. Set model to something like stepfun/step-3.5-flash:free.";
    return null;
  }

  if (isOpenRouterModel(model) && !baseUrl.includes("openrouter.ai")) {
    baseUrl = DEFAULT_BASE_URL;
  }

  if (simulationState.running.has(agentId)) {
    return null;
  }

  simulationState.running.add(agentId);
  button.disabled = true;
  output.textContent = `Running ${agent.name}...`;

  try {
    const persona = await loadPersonaPrompt(agent);
    const responseText = await requestAgentRecommendation({
      apiKey,
      model,
      baseUrl,
      persona,
      scenarioText: buildScenarioWithContext(scenarioText),
      agent,
      username: options.username || "Manager",
      peerInsights: Array.isArray(options.peerInsights) ? options.peerInsights : null,
      mode: options.mode || "brief",
      previousOutput: options.previousOutput || "",
      teamMode: Boolean(options.teamMode),
    });
    const normalized = enforcePointCharacterLimit(
      responseText || "No output returned.",
      options.mode === "dig" ? 140 : BRIEF_MAX_CHARS,
      options.mode === "dig" ? 6 : BRIEF_MAX_POINTS
    );
    const compact = enforceTotalResponseLimit(normalized, TOTAL_RESPONSE_MAX_CHARS);
    output.textContent = compact;
    simulationState.lastByAgent.set(agentId, {
      output: compact,
      scenario: scenarioText,
      at: Date.now(),
    });
    if (digButton instanceof HTMLButtonElement) {
      digButton.disabled = false;
    }
    return compact;
  } catch (error) {
    const errorText = String(error instanceof Error ? error.message : error || "").toLowerCase();
    const shouldUseGuidedFallback =
      errorText.includes("timed out") ||
      errorText.includes("provider") ||
      errorText.includes("could not reach agent api") ||
      errorText.includes("network");
    if (shouldUseGuidedFallback) {
      const fallback = buildBestEffortFallbackResponse({
        agent,
        scenarioText,
        error,
        mode: options.mode || "brief",
        peerInsights: Array.isArray(options.peerInsights) ? options.peerInsights : null,
      });
      if (fallback) {
        const normalizedFallback = enforcePointCharacterLimit(
          fallback,
          options.mode === "dig" ? 140 : BRIEF_MAX_CHARS,
          options.mode === "dig" ? 6 : BRIEF_MAX_POINTS
        );
        const compactFallback = enforceTotalResponseLimit(normalizedFallback, TOTAL_RESPONSE_MAX_CHARS);
        output.textContent = compactFallback;
        simulationState.lastByAgent.set(agentId, {
          output: compactFallback,
          scenario: scenarioText,
          at: Date.now(),
        });
        if (digButton instanceof HTMLButtonElement) {
          digButton.disabled = false;
        }
        return compactFallback;
      }
    }
    output.textContent = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  } finally {
    simulationState.running.delete(agentId);
    button.disabled = false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getDemoResponseDelayMs(agent, mode = "brief") {
  const baseByAgent = {
    "Dr. Dolphin": 2800,
    "Hawkeye": 1900,
    "The Fox": 2400,
    "The Octopus": 3200,
    "The Elephant": 2600,
    "Hootsworth": 2100,
  };
  const base = baseByAgent[String(agent?.name || "")] || 2200;
  return mode === "dig" ? base + 1200 : base;
}

async function loadPersonaPrompt(agent) {
  if (personaCache.has(agent.promptPath)) {
    return personaCache.get(agent.promptPath);
  }
  const response = await fetch(agent.promptPath, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load persona file (${agent.promptPath})`);
  }
  const text = (await response.text()).trim();
  if (!text) {
    throw new Error(`Persona file is empty (${agent.promptPath})`);
  }
  personaCache.set(agent.promptPath, text);
  return text;
}

async function requestAgentRecommendation({
  apiKey,
  model,
  baseUrl,
  persona,
  scenarioText,
  agent,
  username,
  peerInsights,
  mode = "brief",
  previousOutput = "",
  teamMode = false,
}) {
  const startedAt = Date.now();
  const rules = [
    "Hard rules:",
    mode === "brief"
      ? `- Keep every point at a maximum of ${BRIEF_MAX_CHARS} characters.`
      : "- Keep every point at a maximum of 140 characters.",
    `- Entire response must be <= ${TOTAL_RESPONSE_MAX_CHARS} characters total.`,
    "- Return only a numbered list using 1), 2), 3) format (no bullets).",
    "- No intro, no outro, no disclaimers.",
    "- Make each point specific, decisive, and action-oriented for a fantasy manager.",
    "- You must produce a best-effort answer within 30 seconds even if confidence is low.",
    "- Assume we do NOT roster Bijan Robinson.",
    "- Assume this is Week 8 of last NFL season.",
    "- Use last season Week 1-7 trend context to make decisions.",
    `- If there is low signal for your role, respond exactly: "${LOW_SIGNAL_FALLBACK}"`,
  ];
  if (mode === "brief") {
    rules.push("- Return only concise decision points. No long explanations.");
  }
  if (mode === "dig") {
    rules.push("- Add detail and supporting rationale; still stay concise.");
  }

  if (agent.name !== "Hootsworth") {
    rules.push("- You are advising Hootsworth directly.");
  } else {
    rules.push("- Point 1 must be the updated tweet/injury situation summary.");
    rules.push("- Point 2 must synthesize the other agents into a prioritized plan.");
    rules.push("- Point 3 must be the GM decision needed right now.");
  }
  if (teamMode) {
    rules.push("- Team mode is active: be complementary to other agents and avoid repeating generic points.");
  }

  if (agent.name === "Dr. Dolphin" && mode === "dig") {
    rules.push("- Always include a section labeled 'Injury History'.");
    rules.push("- Always include a section labeled 'Typical Duration Out' with the usual recovery range.");
    rules.push("- Always include a section labeled 'Injury Type and Mechanism'.");
    rules.push("- Always include a section labeled 'Return-to-Play Risk'.");
    rules.push("- If specifics are uncertain, state assumptions and still provide medical baseline ranges.");
  }
  if (agent.name === "Hootsworth") {
    rules.push("- Always include: 'Urgency Tier', 'Conflicts and Resolution', and 'GM Decision Needed'.");
  }
  if (agent.name === "Hawkeye") {
    rules.push("- Always include: 'Usage Trend', 'Breakout Signal', and 'Waiver Priority'.");
  }
  if (agent.name === "The Fox") {
    rules.push("- Always include: 'Leverage Read', 'FAAB Range', and 'Trade Opening / Walkaway'.");
  }
  if (agent.name === "The Octopus") {
    rules.push("- Always include: 'Current Value', 'Confidence Range', and 'Optimal EV Path'.");
  }
  if (agent.name === "The Elephant") {
    rules.push("- Always include: 'League Precedent', 'Pattern Detected', and 'Historical Risk'.");
  }

  const peerSection = Array.isArray(peerInsights) && peerInsights.length
    ? [
      "",
      "Peer agent recommendations to synthesize:",
      ...peerInsights.map((item, index) => `${index + 1}. ${item.name}: ${item.text}`),
    ]
    : [];

  const userPrompt = [
    ...rules,
    ...(previousOutput ? ["Previous concise output:", previousOutput, "Expand with deeper detail and evidence."] : []),
    "Scenario:",
    scenarioText,
    ...peerSection,
    "",
    "Return format:",
    mode === "brief" ? "1) Point 1\n2) Point 2\n3) Point 3" : "1) Point 1\n2) Point 2\n3) Point 3\n4) Point 4\n5) Point 5\n6) Point 6",
  ].join("\n");

  const requestBody = {
    api_key: apiKey,
    model,
    base_url: baseUrl,
    persona,
    scenario: userPrompt,
    temperature: 0.3,
    timeout_seconds: PROVIDER_TIMEOUT_SECONDS,
  };
  const response = await postAgentRequest(requestBody, AGENT_RESPONSE_TIMEOUT_MS);

  if (!response.ok) {
    const details = await safeReadResponseText(response);
    throw new Error(`${agent.name} API error ${response.status}${details ? `: ${details}` : ""}`);
  }
  const payload = await response.json();
  let content = payload?.text;
  if (typeof content === "string" && content.trim()) {
    content = content.trim();
    if (mode === "dig" && agent.name === "Dr. Dolphin" && !hasRequiredDrDolphinMedicalSections(content)) {
      const remainingMs = AGENT_RESPONSE_TIMEOUT_MS - (Date.now() - startedAt);
      const correctionPrompt = [
        userPrompt,
        "",
        "Your previous response missed required medical sections.",
        "Rewrite now and include these exact headings:",
        "- Injury Type and Mechanism",
        "- Injury History",
        "- Typical Duration Out",
        "- Return-to-Play Risk",
        "",
        "Previous response:",
        content,
      ].join("\n");

      if (remainingMs > 4500) {
        const correctionResponse = await postAgentRequest(
          {
            ...requestBody,
            scenario: correctionPrompt,
          },
          remainingMs
        );
        if (correctionResponse.ok) {
          const correctionPayload = await correctionResponse.json();
          const corrected = String(correctionPayload?.text || "").trim();
          if (corrected) {
            content = corrected;
          }
        }
      }
    }
    return content;
  }
throw new Error("No message content in model response.");
}

function getGuaranteedAgentResponse({ agent, scenarioText, mode = "brief", peerInsights }) {
  if (agent.name === "Hootsworth") {
    return buildHootsworthSynthesizedResponse({ scenarioText, mode, peerInsights });
  }
  return buildSpecialistDeadlineResponse({ agent, scenarioText, mode, peerInsights });
}

function getDemoFastAgentResponse({ agent, scenarioText, mode = "brief", peerInsights }) {
  const text = String(scenarioText || "").toLowerCase();
  const isBijanInjuryDemo = text.includes("bijan") && (text.includes("injur") || text.includes("inactive"));
  if (!isBijanInjuryDemo) return null;

  const briefByAgent = {
    "Dr. Dolphin": [
      "1) Injury Type and Mechanism: Treat as lower-body flare-up; true status remains uncertain until final practice/inactives.",
      "2) Typical Duration Out: Range is 0-2 weeks if precautionary, longer only if late-week downgrade escalates.",
      "3) Return-to-Play Risk: Volatile workload on first game back; avoid overreacting to one snap-share outcome.",
    ],
    "Hawkeye": [
      "1) Usage Trend: Shift attention to ATL backup touch split and goal-line role, not just the nominal RB2 label.",
      "2) Breakout Signal: Prioritize backs with rising route share + red-zone usage through Weeks 5-7.",
      "3) Waiver Priority: Add immediate volume over stash talent for this week; speed to bid matters more than perfection.",
    ],
    "The Fox": [
      "1) Leverage Read: League mates with Bijan will overpay for certainty tonight; sell them replacement clarity.",
      "2) FAAB Range: Push assertive but disciplined bids on short-term RB volume, not panic all-in offers.",
      "3) Trade Opening / Walkaway: Offer 2-for-1 stability packages; walk if they price backups like season-long starters.",
    ],
    "The Octopus": [
      "1) Current Value: Temporary RB replacement value spikes for 1 week, but long-term dynasty/prior value barely moves.",
      "2) Confidence Range: Wide outcome band before inactives; avoid pricing based on best-case beat-reporter spin.",
      "3) Optimal EV Path: Buy underpriced touch projections, avoid paying for headline-driven certainty premiums.",
    ],
    "The Elephant": [
      "1) League Precedent: Managers consistently overspend on Thursday injury replacements and regret by Sunday morning.",
      "2) Pattern Detected: Backup hype outruns actual snap share when coaches rotate in pass-down specialists.",
      "3) Historical Risk: Chasing the loudest waiver name often loses to the quieter volume-based add.",
    ],
  };

  if (mode === "dig") {
    return (briefByAgent[agent.name] || [
      "1) notmuch for me to comment on",
      "2) notmuch for me to comment on",
      "3) notmuch for me to comment on",
    ]).join("\n");
  }

  return (briefByAgent[agent.name] || null)?.join("\n") || null;
}

function buildBestEffortFallbackResponse({ agent, scenarioText, error, mode = "brief", peerInsights }) {
  if (agent.name === "Hootsworth") {
    return buildHootsworthSynthesizedResponse({ scenarioText, mode, peerInsights });
  }
  return buildSpecialistDeadlineResponse({ agent, scenarioText, mode, peerInsights });
}

function buildHootsworthSynthesizedResponse({ scenarioText, mode = "brief", peerInsights }) {
  const scenario = String(scenarioText || "");
  const mentionsBijan = /bijan/i.test(scenario);
  const peerList = Array.isArray(peerInsights) ? peerInsights.filter(Boolean) : [];
  const peerNames = peerList.map((p) => p.name).filter(Boolean);
  const peerSummary = peerNames.length ? `Inputs received: ${peerNames.join(", ")}.` : "Inputs missing from specialists; using contingency framework.";

  if (mode === "dig") {
    return [
      `1) Urgency Tier: High. ${mentionsBijan ? "Bijan injury uncertainty is a market-moving event before final inactives." : "This injury scenario is a short-window pricing event."}`,
      `2) Synthesized Situation: ${peerSummary}`,
      "3) Conflicts and Resolution: When specialist signals disagree, prioritize projected touches, pass-game role, and price discipline.",
      "4) Coordinated Plan: Queue contingency waiver bids now, send low-risk trade feelers, and prepare a final-news pivot.",
      "5) GM Decision Needed: Approve immediate short-term contingency actions and a no-panic spend ceiling.",
      "6) Execution Rule: Reassess at final practice/inactives and upgrade or unwind based on confirmed workload clarity.",
    ].join("\n");
  }

  return [
    `1) Urgency Tier: High. ${mentionsBijan ? "Bijan uncertainty is moving prices now." : "Injury uncertainty is moving prices now."}`,
    `2) Conflicts and Resolution: ${peerNames.length ? `Use ${peerNames.length} specialist inputs, but break ties with projected touches and role certainty.` : "Use contingency rules and break ties with projected touches and role certainty."}`,
    "3) GM Decision Needed: Approve contingency bids/trade feelers now and revise after final inactives.",
  ].join("\n");
}

function buildSpecialistDeadlineResponse({ agent, scenarioText, mode = "brief", peerInsights }) {
  const scenario = String(scenarioText || "");
  const mentionsBijan = /bijan/i.test(scenario);
  const mentionsInjury = /injur|inactive|out|questionable/i.test(scenario);
  const hasPeers = Array.isArray(peerInsights) && peerInsights.length > 0;
  const agentName = String(agent?.name || "");

  const briefByAgent = {
    "Dr. Dolphin": [
      `1) Injury Type and Mechanism: I must answer within 30 seconds; treat this as a best-effort lower-body status risk read${mentionsBijan ? " for Bijan" : ""}.`,
      `2) Typical Duration Out: ${mentionsBijan && mentionsInjury ? "Working range is precautionary miss to short absence pending final report." : "Use a cautious short-range absence baseline until specifics are confirmed."}`,
      "3) Return-to-Play Risk: Expect workload volatility immediately after return; avoid assuming full snap share.",
    ],
    "Hawkeye": [
      `1) Usage Trend: I must answer within 30 seconds; use a best-effort touch-share read${mentionsBijan ? " for the ATL backfield" : ""}.`,
      "2) Breakout Signal: Prioritize rising routes, red-zone work, and coach-trust snaps over box-score noise.",
      "3) Waiver Priority: Bid on immediate role clarity first, upside stash second.",
    ],
    "The Fox": [
      `1) Leverage Read: I must answer within 30 seconds; this is a best-effort market timing spot${mentionsBijan ? " around Bijan uncertainty" : ""}.`,
      "2) FAAB Range: Be assertive but not all-in on headline replacements before role clarity.",
      "3) Trade Opening / Walkaway: Send fast feelers to managers seeking certainty; walk if prices imply locked workloads.",
    ],
    "The Octopus": [
      `1) Current Value: I must answer within 30 seconds; use a best-effort short-term value spike estimate${mentionsBijan ? " for ATL replacement options" : ""}.`,
      "2) Confidence Range: Wide pre-inactives band; avoid pricing to optimistic outcomes.",
      "3) Optimal EV Path: Buy volume probability, not headline certainty premiums.",
    ],
    "The Elephant": [
      `1) League Precedent: I must answer within 30 seconds, so this is a best-effort historical read${mentionsBijan ? " for Bijan" : ""}.`,
      `2) Pattern Detected: ${hasPeers ? "Peer inputs help, but history still favors role certainty over backup-name hype." : "History favors role certainty over backup-name hype."}`,
      "3) Historical Risk: Avoid panic overpaying on Thursday; make a reversible move and reassess at inactives.",
    ],
  };

  if (mode === "dig") {
    const digByAgent = {
      "Dr. Dolphin": [
        `1) Injury Type and Mechanism: I must answer within 30 seconds, so this is a best-effort medical baseline${mentionsBijan ? " for Bijan" : ""}.`,
        `2) Injury History: ${mentionsBijan && mentionsInjury ? "Treat history as incomplete in this time-box; anchor to current status volatility." : "History not confirmed in this time-box; use generic risk controls."}`,
        "3) Typical Duration Out: Use a conservative short-range absence baseline until final reporting clarifies severity.",
        "4) Return-to-Play Risk: Early return often carries reduced snap share or managed touches.",
        "5) Practical Implication: Do not assume full workload replacement maps 1:1 to one backup.",
        "6) Deadline Rule: Best-effort answer delivered now; update after final practice/inactives.",
      ],
      "Hawkeye": [
        `1) Usage Trend: I must answer within 30 seconds; this is a best-effort role projection${mentionsBijan ? " for ATL replacements" : ""}.`,
        "2) Breakout Signal: Weight route rate, two-minute usage, and red-zone snaps over raw carry totals.",
        "3) Depth Chart Note: Coaches often split early downs and pass downs after late injury news.",
        `4) Comparison Set: ${hasPeers ? "Use peer signals to refine priority, but keep scouting focus on role certainty." : "No peer signals yet; default to role certainty over hype."}`,
        "5) Waiver Priority: Fast bid for usable volume now, upside stash only if cost stays low.",
        "6) Deadline Rule: Make a reversible add first, then optimize once inactives confirm workload.",
      ],
      "The Fox": [
        `1) Leverage Read: I must answer within 30 seconds; this is a best-effort market playbook${mentionsBijan ? " for Bijan panic pricing" : ""}.`,
        "2) Market Pattern: Managers overpay for certainty on Thursday and soften after clearer Friday/Sunday news.",
        "3) FAAB Range: Bid aggressively enough to win a short-term role, but preserve ammo for follow-up moves.",
        `4) Trade Opening / Walkaway: ${hasPeers ? "Use peer uncertainty ranges to frame offers; walk from certainty-premium asks." : "Frame offers around uncertainty; walk from certainty-premium asks."}`,
        "5) Timing Edge: Send offers before final inactives lock in consensus prices.",
        "6) Deadline Rule: If uncertain, prefer multiple low-risk probes over one expensive commitment.",
      ],
      "The Octopus": [
        `1) Current Value: I must answer within 30 seconds; this is a best-effort short-term EV snapshot${mentionsBijan ? " for ATL contingency options" : ""}.`,
        "2) Confidence Range: Pre-inactives uncertainty widens outcomes; avoid point estimates presented as certainty.",
        "3) Price Discipline: Temporary role spikes rarely justify long-term premium prices.",
        `4) Optimal EV Path: ${hasPeers ? "Blend peer signals into a range, then pay near the low end of uncertainty." : "Use a wide range and pay near the low end of uncertainty."}`,
        "5) Portfolio Move: Diversify exposure across cheap contingent volume instead of one expensive headline add.",
        "6) Deadline Rule: Choose the highest expected touches per cost unit before lock, then revise on news.",
      ],
      "The Elephant": [
        `1) League Precedent: I must answer within 30 seconds, so this is a best-effort historical read${mentionsBijan ? " for Bijan" : ""}.`,
        `2) Pattern Detected: ${mentionsBijan && mentionsInjury ? "Thursday RB injury uncertainty triggers overbidding on the most obvious backup." : "Injury news windows trigger overbidding before role clarity."}`,
        "3) Historical Risk: Managers anchor to headline names and miss committee/pass-down usage splits.",
        `4) Comparison Set: ${hasPeers ? "Peer signals can refine execution, but precedent still favors volume-over-hype decisions." : "Without peer outputs, default to volume-over-hype and preserve optionality."}`,
        "5) Action From History: Bid for touch certainty, not narrative certainty, and keep a follow-up move ready after inactives.",
        "6) Deadline Rule: When uncertain at the 30-second mark, prefer reversible moves and avoid all-in reactions.",
      ],
    };

    return (digByAgent[agentName] || [
      "1) notmuch for me to comment on",
      "2) notmuch for me to comment on",
      "3) notmuch for me to comment on",
    ]).join("\n");
  }

  return (briefByAgent[agentName] || [
    "1) notmuch for me to comment on",
    "2) notmuch for me to comment on",
    "3) notmuch for me to comment on",
  ]).join("\n");
}

async function postAgentRequest(body, timeoutMs = AGENT_RESPONSE_TIMEOUT_MS) {
  const requestStart = Date.now();
  const endpoints = ["/api/agents/recommend"];
  const isSecurePage = window.location.protocol === "https:";
  if (!isSecurePage) {
    endpoints.push("http://127.0.0.1:8000/api/agents/recommend");
    endpoints.push("http://localhost:8000/api/agents/recommend");
  }

  const failures = [];
  for (const endpoint of endpoints) {
    const elapsed = Date.now() - requestStart;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      break;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
      return response;
    } catch (error) {
      window.clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        failures.push(`${endpoint} => timed out after ${Math.ceil(remaining / 1000)}s`);
      } else {
        failures.push(`${endpoint} => ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (Date.now() - requestStart >= timeoutMs) {
    throw new Error(`Agent request timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
  }

  throw new Error(
    `Could not reach agent API from ${window.location.origin || "unknown-origin"}. ` +
    `Tried: ${failures.join("; ")}`
  );
}

async function safeReadResponseText(response) {
  try {
    const text = await response.text();
    return String(text || "").trim().slice(0, 240);
  } catch (_error) {
    return "";
  }
}

function looksLikeModelString(value) {
  const text = String(value || "").trim();
  return text.includes("/") || text.endsWith(":free");
}

function looksLikeApiKey(value) {
  const text = String(value || "").trim();
  return text.startsWith("sk-");
}

function isOpenRouterModel(value) {
  const text = String(value || "").trim();
  return text.includes("/") || text.includes(":free");
}

function buildScenarioWithContext(baseScenario) {
  const labContext = getLabContext();
  const intelContext = getLeagueIntelContext();
  const sharedLines = [];

  if (labContext) {
    const topNames = (Array.isArray(labContext.top_players) ? labContext.top_players : [])
      .slice(0, 3)
      .map((item) => `${item.player_name} (${item.position})`)
      .join(", ");
    sharedLines.push(
      `Lab snapshot: ${labContext.item_count || 0} players after ${labContext.filter_count || 0} filters; sort ${labContext.sort_key || "-"} (${labContext.sort_direction || "-"})`
    );
    if (topNames) {
      sharedLines.push(`Lab top players: ${topNames}.`);
    }
  }

  if (intelContext) {
    sharedLines.push(
      `League intel snapshot: ${intelContext.league_name || "Sleeper League"}, ${intelContext.seasons_analyzed || 0} seasons, ${intelContext.total_transactions || 0} transactions.`
    );
    if (intelContext.selected_manager?.display_name) {
      const weak = Array.isArray(intelContext.selected_manager.weak_positions)
        ? intelContext.selected_manager.weak_positions.join(", ")
        : "";
      sharedLines.push(
        `Manager focus: ${intelContext.selected_manager.display_name}; weak positions: ${weak || "none noted"}; cue: ${intelContext.selected_manager.targeting_cue || "none"}.`
      );
    }
  }

  return [
    "Updated tweet context: Bijan Robinson injury update is active on Thursday and availability is uncertain.",
    "Team context: we do not roster Bijan Robinson.",
    "Time context: Week 8 of last NFL season.",
    "Data context: use last season form and usage trends through Week 7.",
    ...(sharedLines.length ? ["Shared context from The Lab and League Intel:", ...sharedLines] : []),
    "",
    baseScenario,
  ].join("\n");
}

function hasRequiredDrDolphinMedicalSections(text) {
  const value = String(text || "").toLowerCase();
  return (
    value.includes("injury type and mechanism") &&
    value.includes("injury history") &&
    value.includes("typical duration out") &&
    value.includes("return-to-play risk")
  );
}

function enforcePointCharacterLimit(text, maxChars = 140, maxPoints = 4) {
  const raw = String(text || "").trim();
  if (!raw) return LOW_SIGNAL_FALLBACK;
  if (raw.toLowerCase() === LOW_SIGNAL_FALLBACK) return LOW_SIGNAL_FALLBACK;

  const candidateLines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const normalized = candidateLines
    .slice(0, maxPoints)
    .map((line, index) => {
      const core = line.replace(/^(\d+[.)-]|\-|\*)\s+/, "").trim();
      let numbered = `${index + 1}) ${core}`;
      if (numbered.length > maxChars) {
        numbered = `${numbered.slice(0, Math.max(8, maxChars - 3)).trimEnd()}...`;
      }
      return numbered;
    })
    .filter(Boolean);

  return normalized.length ? normalized.join("\n") : LOW_SIGNAL_FALLBACK;
}

function enforceTotalResponseLimit(text, maxChars = TOTAL_RESPONSE_MAX_CHARS) {
  const normalized = String(text || "").trim();
  if (!normalized) return LOW_SIGNAL_FALLBACK;
  if (normalized.toLowerCase() === LOW_SIGNAL_FALLBACK) return LOW_SIGNAL_FALLBACK;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(8, maxChars - 3)).trimEnd()}...`;
}

function setupAgentControls() {
  const iframe = document.getElementById("agents-iframe");
  const dpad = document.getElementById("agents-dpad");
  if (!iframe || !dpad) {
    return;
  }

  const keyMap = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };

  const activeIntervals = new Map();

  function getFrameWindow() {
    return iframe.contentWindow || null;
  }

  function getFrameDocument() {
    return iframe.contentWindow?.document || null;
  }

  function dispatchKey(direction, type) {
    const frameWin = getFrameWindow();
    const frameDoc = getFrameDocument();
    const key = keyMap[direction];
    if (!frameWin || !frameDoc || !key) {
      return;
    }

    const event = new KeyboardEvent(type, {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
    });

    frameDoc.dispatchEvent(event);
    frameWin.dispatchEvent(event);
  }

  function startKeyPress(direction, button) {
    if (!direction || activeIntervals.has(direction)) {
      return;
    }

    iframe.focus();
    dispatchKey(direction, "keydown");
    button?.classList.add("is-active");

    const intervalId = window.setInterval(() => {
      dispatchKey(direction, "keydown");
    }, 85);

    activeIntervals.set(direction, intervalId);
  }

  function stopKeyPress(direction, button) {
    const intervalId = activeIntervals.get(direction);
    if (intervalId) {
      window.clearInterval(intervalId);
      activeIntervals.delete(direction);
    }
    dispatchKey(direction, "keyup");
    button?.classList.remove("is-active");
  }

  function stopAllKeyPresses() {
    for (const [direction, intervalId] of activeIntervals.entries()) {
      window.clearInterval(intervalId);
      dispatchKey(direction, "keyup");
    }
    activeIntervals.clear();
    for (const btn of dpad.querySelectorAll(".dpad-btn")) {
      btn.classList.remove("is-active");
    }
  }

  for (const button of dpad.querySelectorAll("[data-dir]")) {
    const direction = button.dataset.dir;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      startKeyPress(direction, button);
    });
    button.addEventListener("pointerup", () => stopKeyPress(direction, button));
    button.addEventListener("pointerleave", () => stopKeyPress(direction, button));
    button.addEventListener("pointercancel", () => stopKeyPress(direction, button));
  }

  window.addEventListener("blur", stopAllKeyPresses);

  function enhanceFrameUi() {
    const frameWin = getFrameWindow();
    const frameDoc = getFrameDocument();
    if (!frameWin || !frameDoc || frameWin.__fdlAgentsEnhanced) {
      return;
    }
    frameWin.__fdlAgentsEnhanced = true;
    injectComicLabelStyles(frameDoc);
    enforceSelectedPopupContrast(frameDoc);
    let panState = null;

    function isInsideInputUi(target) {
      if (!(target instanceof frameWin.Element)) {
        return false;
      }
      const panel = findPersonalityPanel(frameDoc);
      if (panel && panel.contains(target)) {
        return true;
      }
      return Boolean(target.closest("input, textarea, button, select, label"));
    }

    function findWorldCanvas() {
      return frameDoc.querySelector("canvas");
    }

    function dispatchPanMouse(type, sourceEvent, canvas) {
      const mouseEvent = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: sourceEvent.clientX,
        clientY: sourceEvent.clientY,
        button: type === "mouseup" ? 1 : 1,
        buttons: type === "mouseup" ? 0 : 4,
      });
      canvas.dispatchEvent(mouseEvent);
    }

    frameDoc.addEventListener("pointerdown", (event) => {
      if (isInsideInputUi(event.target)) {
        return;
      }
      const canvas = findWorldCanvas();
      if (!canvas) {
        return;
      }
      if (!(event.target instanceof frameWin.Element) || !canvas.contains(event.target)) {
        return;
      }

      panState = {
        pointerId: event.pointerId,
        canvas,
      };
      dispatchPanMouse("mousedown", event, canvas);
      event.preventDefault();
      event.stopPropagation();
    }, true);

    frameDoc.addEventListener("pointermove", (event) => {
      if (!panState || panState.pointerId !== event.pointerId) {
        return;
      }
      dispatchPanMouse("mousemove", event, panState.canvas);
      event.preventDefault();
      event.stopPropagation();
    }, true);

    const endPan = (event) => {
      if (!panState || panState.pointerId !== event.pointerId) {
        return;
      }
      dispatchPanMouse("mouseup", event, panState.canvas);
      panState = null;
      event.preventDefault();
      event.stopPropagation();
    };

    frameDoc.addEventListener("pointerup", endPan, true);
    frameDoc.addEventListener("pointercancel", endPan, true);
    frameWin.addEventListener("blur", () => {
      panState = null;
    });

    hidePersonalityPanel(frameDoc);
    const observer = new MutationObserver(() => {
      hidePersonalityPanel(frameDoc);
      injectComicLabelStyles(frameDoc);
      enforceSelectedPopupContrast(frameDoc);
    });
    observer.observe(frameDoc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
      characterData: true,
    });

    if (!frameWin.__fdlPopupContrastInterval) {
      frameWin.__fdlPopupContrastInterval = frameWin.setInterval(() => {
        enforceSelectedPopupContrast(frameDoc);
      }, 180);
    }

    if (!frameWin.__fdlPopupContrastRaf) {
      const paint = () => {
        enforceSelectedPopupContrast(frameDoc);
        frameWin.__fdlPopupContrastRaf = frameWin.requestAnimationFrame(paint);
      };
      frameWin.__fdlPopupContrastRaf = frameWin.requestAnimationFrame(paint);
    }
  }

  iframe.addEventListener("load", enhanceFrameUi);
  enhanceFrameUi();
}

function findPersonalityPanel(frameDoc) {
  const divs = frameDoc.querySelectorAll("div");
  for (const div of divs) {
    if (!div.textContent?.includes("Agent Personalities")) {
      continue;
    }
    const panel = div.closest("div");
    if (panel && panel.style.position === "absolute") {
      return panel;
    }
  }
  return null;
}

function hidePersonalityPanel(frameDoc) {
  const panel = findPersonalityPanel(frameDoc);
  if (!panel) {
    return;
  }
  panel.style.display = "none";
}

function injectComicLabelStyles(frameDoc) {
  if (frameDoc.getElementById("fdl-comic-agent-labels")) {
    return;
  }

  const style = frameDoc.createElement("style");
  style.id = "fdl-comic-agent-labels";
  style.textContent = `
    [style*="--pixel-overlay-selected-z"] {
      color: #ffffff !important;
    }

    [style*="--pixel-overlay-selected-z"] * {
      color: #ffffff !important;
      fill: #ffffff !important;
      stroke: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      opacity: 1 !important;
    }

    [style*="--pixel-overlay-selected-z"] > div {
      background: #0b0b0b !important;
      border: 2px solid #ffffff !important;
      box-shadow: 2px 2px 0 #000000 !important;
    }

    div[style*="pointer-events: none"][style*="z-index: 40"][style*="translateX(-50%)"] {
      transform: translateX(18px) !important;
    }

    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"],
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] {
      transform: translateX(18px) !important;
    }

    div[style*="pointer-events: none"][style*="z-index: 40"][style*="translateX(-50%)"] > span {
      background: #ffffff !important;
      color: #131313 !important;
      border: 2px solid #111111 !important;
      border-radius: 4px !important;
      box-shadow: 2px 2px 0 #111111 !important;
      text-shadow: none !important;
      font-weight: 700 !important;
      letter-spacing: 0.01em !important;
    }

    div[style*="pointer-events: none"][style*="z-index: 40"][style*="translateX(-50%)"] > span + span {
      margin-top: 3px !important;
      opacity: 1 !important;
      font-weight: 600 !important;
    }

    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] > div,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] > div {
      background: #0b0b0b !important;
      border: 2px solid #ffffff !important;
      box-shadow: 2px 2px 0 #000000 !important;
      color: #ffffff !important;
    }

    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] span,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] button,
    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] svg,
    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] div,
    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] p,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] span,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] button,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] svg,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] div,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] p,
    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] * ,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] * {
      color: #ffffff !important;
      fill: #ffffff !important;
      stroke: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
      opacity: 1 !important;
    }

    div[style*="transform:translateX(-50%)"][style*="--pixel-overlay-selected-z"] button,
    div[style*="transform: translateX(-50%)"][style*="--pixel-overlay-selected-z"] button {
      border: 1px solid #ffffff !important;
      background: #0b0b0b !important;
    }
  `;
  frameDoc.head.appendChild(style);
}

function enforceSelectedPopupContrast(frameDoc) {
  const selectedBoxes = new Set(
    Array.from(
      frameDoc.querySelectorAll('div[style*="--pixel-overlay-selected-z"], div[style*="pointer-events: auto"]')
    ).filter((el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const cs = frameDoc.defaultView.getComputedStyle(el);
      return cs.position === "absolute" && Number(cs.zIndex || 0) >= 100;
    })
  );

  for (const box of selectedBoxes) {
    if (!(box instanceof HTMLElement)) {
      continue;
    }
    box.style.color = "#ffffff";
    box.style.setProperty("color", "#ffffff", "important");

    const bubble = box.firstElementChild;
    if (bubble instanceof HTMLElement) {
      bubble.style.setProperty("background", "#0b0b0b", "important");
      bubble.style.setProperty("border", "2px solid #ffffff", "important");
      bubble.style.setProperty("color", "#ffffff", "important");
    }

    const descendants = box.querySelectorAll("*");
    for (const node of descendants) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      node.style.setProperty("color", "#ffffff", "important");
      node.style.setProperty("fill", "#ffffff", "important");
      node.style.setProperty("stroke", "#ffffff", "important");
      node.style.setProperty("-webkit-text-fill-color", "#ffffff", "important");
      node.style.setProperty("opacity", "1", "important");
      node.style.setProperty("filter", "none", "important");
      if (node.tagName === "BUTTON") {
        node.style.setProperty("background", "#0b0b0b", "important");
        node.style.setProperty("border", "1px solid #ffffff", "important");
        node.style.setProperty("color", "#ffffff", "important");
      }
    }
  }
}

