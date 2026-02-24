import { bindConnectButton, hydrateHeader } from "./site_state.js";

const AGENT_CONFIG_STORAGE_KEY = "fdl.agentConfigs.v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
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
};

initialize();

function initialize() {
  hydrateHeader("agents");
  bindConnectButton();
  setupAgentConfigPanel();
  setupAgentBioPanel();
  setupAgentSimulationPanel();
  setupAgentControls();
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
      </div>
      <pre class="scenario-output" data-output>Ready. Add API key in the panel above and run this agent.</pre>
    </article>
  `).join("");

  grid.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("button[data-action='run-agent']");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const card = button.closest(".scenario-card");
    const agentId = Number(card?.getAttribute("data-agent-id"));
    if (!agentId) {
      return;
    }
    await runAgentSimulation(agentId, scenarioInput.value.trim(), {
      username: scenarioUsername instanceof HTMLInputElement ? scenarioUsername.value.trim() : "",
      peerInsights: null,
    });
  });

  runAllBtn.addEventListener("click", async () => {
    const scenario = scenarioInput.value.trim();
    const username = scenarioUsername instanceof HTMLInputElement ? scenarioUsername.value.trim() : "";
    runAllBtn.disabled = true;
    if (status) {
      status.textContent = "Running agents 2-6 for Hootsworth synthesis...";
    }
    try {
      const peerAgents = AGENT_DEFINITIONS.filter((agent) => agent.name !== "Hootsworth");
      const peerOutputs = [];
      for (const agent of peerAgents) {
        const text = await runAgentSimulation(agent.id, scenario, { username, peerInsights: null });
        if (text) {
          peerOutputs.push({ name: agent.name, text });
        }
      }
      const hootsworth = AGENT_DEFINITIONS.find((agent) => agent.name === "Hootsworth");
      if (hootsworth) {
        await runAgentSimulation(hootsworth.id, scenario, {
          username,
          peerInsights: peerOutputs,
        });
      }
      if (status) {
        status.textContent = "All agents updated. Hootsworth synthesized the full recommendation.";
      }
    } finally {
      runAllBtn.disabled = false;
    }
  });
}

async function runAgentSimulation(agentId, scenarioText, options = {}) {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === agentId);
  if (!agent) {
    return null;
  }

  const card = document.querySelector(`.scenario-card[data-agent-id="${agentId}"]`);
  const output = card?.querySelector("[data-output]");
  const button = card?.querySelector("button[data-action='run-agent']");
  if (!(output instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
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

  if (!scenarioText) {
    output.textContent = "Scenario is empty. Add a scenario prompt and rerun.";
    return null;
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
    });
    const normalized = enforcePointCharacterLimit(responseText || "No output returned.");
    output.textContent = normalized;
    return normalized;
  } catch (error) {
    output.textContent = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  } finally {
    simulationState.running.delete(agentId);
    button.disabled = false;
  }
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

async function requestAgentRecommendation({ apiKey, model, baseUrl, persona, scenarioText, agent, username, peerInsights }) {
  const rules = [
    "Hard rules:",
    "- Keep every point at a maximum of 140 characters.",
    "- Assume we do NOT roster Bijan Robinson.",
    "- Assume this is Week 8 of last NFL season.",
    "- Use last season Week 1-7 trend context to make decisions.",
  ];

  if (agent.name !== "Hootsworth") {
    rules.push("- You are advising Hootsworth directly.");
  } else {
    rules.push(`- Start with: "Hello ${username}, this is the present situation."`);
    rules.push("- Include an updated tweet-style injury situation summary.");
    rules.push("- Regurgitate and synthesize insights from the other agents.");
  }

  if (agent.name === "Dr. Dolphin") {
    rules.push("- Always include a section labeled 'Injury History'.");
    rules.push("- Always include a section labeled 'Typical Duration Out' with the usual recovery range.");
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
    "Scenario:",
    scenarioText,
    ...peerSection,
    "",
    "Return format:",
    "1) Point 1",
    "2) Point 2",
    "3) Point 3",
    "4) Point 4",
  ].join("\n");

  const requestBody = {
    api_key: apiKey,
    model,
    base_url: baseUrl,
    persona,
    scenario: userPrompt,
    temperature: 0.3,
  };
  const response = await postAgentRequest(requestBody);

  if (!response.ok) {
    const details = await safeReadResponseText(response);
    throw new Error(`${agent.name} API error ${response.status}${details ? `: ${details}` : ""}`);
  }
  const payload = await response.json();
  const content = payload?.text;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  throw new Error("No message content in model response.");
}

async function postAgentRequest(body) {
  const endpoints = ["/api/agents/recommend"];
  const isSecurePage = window.location.protocol === "https:";
  if (!isSecurePage) {
    endpoints.push("http://127.0.0.1:8000/api/agents/recommend");
    endpoints.push("http://localhost:8000/api/agents/recommend");
  }

  const failures = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response;
    } catch (error) {
      failures.push(`${endpoint} => ${error instanceof Error ? error.message : String(error)}`);
    }
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
  return [
    "Updated tweet context: Bijan Robinson injury update is active on Thursday and availability is uncertain.",
    "Team context: we do not roster Bijan Robinson.",
    "Time context: Week 8 of last NFL season.",
    "Data context: use last season form and usage trends through Week 7.",
    "",
    baseScenario,
  ].join("\n");
}

function enforcePointCharacterLimit(text) {
  const lines = String(text || "").split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!/^(\d+[.)-]|\-|\*)\s+/.test(trimmed)) return line;
      if (trimmed.length <= 140) return line;
      return `${trimmed.slice(0, 137).trimEnd()}...`;
    })
    .join("\n");
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

