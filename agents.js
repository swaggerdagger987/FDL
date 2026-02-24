import { bindConnectButton, hydrateHeader } from "./site_state.js";

const AGENT_CONFIG_STORAGE_KEY = "fdl.agentConfigs.v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const AGENT_DEFINITIONS = [
  {
    id: 1,
    name: "Hootsworth",
    role: "Strategic Coordinator",
    purpose: "Strategic coordinator that sets lineup priorities and balances weekly risk.",
    promptPath: "./agent-personas/hootsworth.md"
  },
  {
    id: 2,
    name: "Dr. Dolphin",
    role: "Data Specialist",
    purpose: "Data specialist focused on projections, trend shifts, and matchup volatility.",
    promptPath: "./agent-personas/dr-dolphin.md"
  },
  {
    id: 3,
    name: "Hawkeye",
    role: "Waiver and Opponent Scanner",
    purpose: "Waiver and opponent scanner that spots immediate tactical opportunities.",
    promptPath: "./agent-personas/hawkeye.md"
  },
  {
    id: 4,
    name: "The Fox",
    role: "Trade Negotiator",
    purpose: "Trade negotiator that identifies leverage, pricing edges, and deal timing.",
    promptPath: "./agent-personas/the-fox.md"
  },
  {
    id: 5,
    name: "The Octopus",
    role: "Scenario Planner",
    purpose: "Scenario planner that runs multi-step contingency paths across roster outcomes.",
    promptPath: "./agent-personas/the-octopus.md"
  },
  {
    id: 6,
    name: "The Elephant",
    role: "Context and Memory Keeper",
    purpose: "Memory and context keeper that tracks long-term league behavior and patterns.",
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
  setupAgentSimulationPanel();
  setupAgentControls();
}

function setupAgentConfigPanel() {
  const cardsHost = document.getElementById("agent-cards");
  const status = document.getElementById("agents-status");
  const iframe = document.getElementById("agents-iframe");
  const allKeyInput = document.getElementById("all-agent-key");
  const saveAllButton = document.getElementById("save-all-agent-keys");
  if (!cardsHost) {
    return;
  }

  const config = loadAgentConfig();
  cardsHost.innerHTML = AGENT_DEFINITIONS.map((agent) => {
    const existing = config[String(agent.id)] || {};
    const apiKey = typeof existing.apiKey === "string" ? existing.apiKey : "";
    return `
      <article class="agent-card" data-agent-id="${agent.id}">
        <h3>${escapeHtml(agent.name)}</h3>
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
    await runAgentSimulation(agentId, scenarioInput.value.trim());
  });

  runAllBtn.addEventListener("click", async () => {
    const scenario = scenarioInput.value.trim();
    runAllBtn.disabled = true;
    if (status) {
      status.textContent = "Running all six agents for the current scenario...";
    }
    try {
      await Promise.all(AGENT_DEFINITIONS.map((agent) => runAgentSimulation(agent.id, scenario)));
      if (status) {
        status.textContent = "All six agent recommendations are updated.";
      }
    } finally {
      runAllBtn.disabled = false;
    }
  });
}

async function runAgentSimulation(agentId, scenarioText) {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === agentId);
  if (!agent) {
    return;
  }

  const card = document.querySelector(`.scenario-card[data-agent-id="${agentId}"]`);
  const output = card?.querySelector("[data-output]");
  const button = card?.querySelector("button[data-action='run-agent']");
  if (!(output instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
    return;
  }

  const config = loadAgentConfig();
  const agentConfig = config[String(agentId)] || {};
  const apiKey = typeof agentConfig.apiKey === "string" ? agentConfig.apiKey.trim() : "";
  const model = typeof agentConfig.model === "string" && agentConfig.model.trim() ? agentConfig.model.trim() : DEFAULT_MODEL;
  const baseUrl = typeof agentConfig.baseUrl === "string" && agentConfig.baseUrl.trim()
    ? agentConfig.baseUrl.trim()
    : DEFAULT_BASE_URL;

  if (!apiKey) {
    output.textContent = "No API key saved for this agent. Enter one above, then rerun.";
    return;
  }

  if (!scenarioText) {
    output.textContent = "Scenario is empty. Add a scenario prompt and rerun.";
    return;
  }

  if (simulationState.running.has(agentId)) {
    return;
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
      scenarioText,
      agent,
    });
    output.textContent = responseText || "No output returned.";
  } catch (error) {
    output.textContent = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
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

async function requestAgentRecommendation({ apiKey, model, baseUrl, persona, scenarioText, agent }) {
  const userPrompt = [
    "Scenario:",
    scenarioText,
    "",
    "Return format:",
    "1) Recommendation",
    "2) Immediate next actions",
    "3) Key risk to monitor in next 24 hours",
  ].join("\n");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "Fourth Down Labs";
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: persona },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const details = await safeReadResponseText(response);
    throw new Error(`${agent.name} API error ${response.status}${details ? `: ${details}` : ""}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  throw new Error("No message content in model response.");
}

async function safeReadResponseText(response) {
  try {
    const text = await response.text();
    return String(text || "").trim().slice(0, 240);
  } catch (_error) {
    return "";
  }
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

