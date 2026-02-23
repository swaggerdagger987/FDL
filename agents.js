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

  function dispatchKey(direction, type) {
    const frameWin = getFrameWindow();
    const key = keyMap[direction];
    if (!frameWin || !key) {
      return;
    }

    const event = new KeyboardEvent(type, {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
    });

    frameWin.document.dispatchEvent(event);
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

  const wrap = iframe.closest(".agents-frame-wrap");
  let dragState = null;

  function toFramePoint(clientX, clientY) {
    const rect = iframe.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width - 1, clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height - 1, clientY - rect.top)),
    };
  }

  function dispatchPointerLike(type, clientX, clientY) {
    const frameWin = getFrameWindow();
    const frameDoc = frameWin?.document;
    if (!frameWin || !frameDoc) {
      return;
    }

    const point = toFramePoint(clientX, clientY);
    const target =
      frameDoc.elementFromPoint(point.x, point.y) ||
      frameDoc.querySelector("canvas") ||
      frameDoc.body;

    if (!target) {
      return;
    }

    const common = {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
    };

    target.dispatchEvent(new MouseEvent(type, common));
    if (type === "mousedown") {
      target.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } else if (type === "mousemove") {
      target.dispatchEvent(new PointerEvent("pointermove", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } else if (type === "mouseup") {
      target.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    }
  }

  if (wrap) {
    wrap.addEventListener("pointerdown", (event) => {
      if (event.target.closest("#agents-dpad")) {
        return;
      }
      dragState = { pointerId: event.pointerId };
      iframe.focus();
      dispatchPointerLike("mousedown", event.clientX, event.clientY);
    });

    wrap.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      dispatchPointerLike("mousemove", event.clientX, event.clientY);
    });

    const finishDrag = (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }
      dispatchPointerLike("mouseup", event.clientX, event.clientY);
      dragState = null;
    };

    wrap.addEventListener("pointerup", finishDrag);
    wrap.addEventListener("pointercancel", finishDrag);
    wrap.addEventListener("pointerleave", finishDrag);
  }
}

