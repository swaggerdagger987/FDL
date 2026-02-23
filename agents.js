import { bindConnectButton, hydrateHeader } from "./site_state.js";

initialize();

function initialize() {
  hydrateHeader("agents");
  bindConnectButton();
  setupAgentControls();
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

    pinPersonalityPanel(frameDoc);
    const observer = new MutationObserver(() => {
      pinPersonalityPanel(frameDoc);
      injectComicLabelStyles(frameDoc);
      enforceSelectedPopupContrast(frameDoc);
    });
    observer.observe(frameDoc.body, { childList: true, subtree: true });
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

function injectComicLabelStyles(frameDoc) {
  if (frameDoc.getElementById("fdl-comic-agent-labels")) {
    return;
  }

  const style = frameDoc.createElement("style");
  style.id = "fdl-comic-agent-labels";
  style.textContent = `
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
  const selectedBoxes = frameDoc.querySelectorAll(
    'div[style*="--pixel-overlay-selected-z"]'
  );
  for (const box of selectedBoxes) {
    if (!(box instanceof HTMLElement)) {
      continue;
    }
    box.style.color = "#ffffff";

    const bubble = box.firstElementChild;
    if (bubble instanceof HTMLElement) {
      bubble.style.background = "#0b0b0b";
      bubble.style.border = "2px solid #ffffff";
      bubble.style.color = "#ffffff";
    }

    const descendants = box.querySelectorAll("*");
    for (const node of descendants) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      node.style.color = "#ffffff";
      node.style.fill = "#ffffff";
      node.style.stroke = "#ffffff";
      node.style.webkitTextFillColor = "#ffffff";
      if (node.tagName === "BUTTON") {
        node.style.background = "#0b0b0b";
        node.style.border = "1px solid #ffffff";
      }
    }
  }
}

