import { bindConnectButton, hydrateHeader } from "./site_state.js";

initialize();

function initialize() {
  hydrateHeader("agents");
  bindConnectButton();
}

