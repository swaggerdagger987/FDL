import { bindConnectButton, connectSleeperByUsername, hydrateHeader, renderConnectButton } from "./site_state.js";

const dom = {
  form: document.querySelector("#home-connect-form"),
  username: document.querySelector("#home-sleeper-username"),
  connectBtn: document.querySelector("#home-connect-btn"),
  status: document.querySelector("#home-connect-status")
};

initialize();

function initialize() {
  hydrateHeader("home");
  bindConnectButton({
    onConnected: () => setStatus("Sleeper connected from nav.", "success"),
    onDisconnected: () => setStatus("Sleeper session disconnected.", "info")
  });

  dom.form?.addEventListener("submit", onHomeConnectSubmit);
}

async function onHomeConnectSubmit(event) {
  event.preventDefault();
  const username = String(dom.username?.value || "").trim();
  if (!username) {
    setStatus("Enter a Sleeper username first.", "error");
    return;
  }

  dom.connectBtn.disabled = true;
  dom.connectBtn.textContent = "Connecting...";
  setStatus("Connecting to Sleeper...", "info");

  try {
    const session = await connectSleeperByUsername(username);
    renderConnectButton();
    setStatus(
      `Connected @${session.username_raw || session.username}. Loaded ${session.leagues?.length || 0} league${
        (session.leagues?.length || 0) === 1 ? "" : "s"
      }.`,
      "success"
    );
    dom.username.value = "";
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    dom.connectBtn.disabled = false;
    dom.connectBtn.textContent = "Connect Sleeper";
  }
}

function setStatus(message, level) {
  if (!dom.status) return;
  dom.status.textContent = message;
  dom.status.dataset.level = level || "info";
}
