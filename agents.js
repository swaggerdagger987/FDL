import { bindConnectButton, hydrateHeader } from "./site_state.js";

const AGENT_CONFIG_STORAGE_KEY = "fdl.agentConfigs.v1";
const AGENT_DEFINITIONS = [
  {
    id: 1,
    name: "Hootsworth",
    purpose: "Strategic coordinator that sets lineup priorities and balances weekly risk."
  },
  {
    id: 2,
    name: "Dr. Dolphin",
    purpose: "Data specialist focused on projections, trend shifts, and matchup volatility."
  },
  {
    id: 3,
    name: "Hawkeye",
    purpose: "Waiver and opponent scanner that spots immediate tactical opportunities."
  },
  {
    id: 4,
    name: "The Fox",
    purpose: "Trade negotiator that identifies leverage, pricing edges, and deal timing."
  },
  {
    id: 5,
    name: "The Octopus",
    purpose: "Scenario planner that runs multi-step contingency paths across roster outcomes."
  },
  {
    id: 6,
    name: "The Elephant",
    purpose: "Memory and context keeper that tracks long-term league behavior and patterns."
  }
];

initialize();

function initialize() {
  hydrateHeader("agents");
  bindConnectButton();
  setupAgentConfigPanel();
  setupAgentControls();
}

function setupAgentConfigPanel() {
  const cardsHost = document.getElementById("agent-cards");
  const status = document.getElementById("agents-status");
  const iframe = document.getElementById("agents-iframe");
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
        model: typeof existing.model === "string" ? existing.model : "",
        baseUrl: typeof existing.baseUrl === "string" ? existing.baseUrl : ""
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

function pinPersonalityPanel(frameDoc) {
  const panel = findPersonalityPanel(frameDoc);
  if (!panel) {
    return;
  }

  panel.style.top = "auto";
  panel.style.right = "12px";
  panel.style.left = "12px";
  panel.style.bottom = "12px";
  panel.style.width = "auto";
  panel.style.maxHeight = "34%";
  panel.style.overflow = "auto";
  panel.style.zIndex = "130";
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

