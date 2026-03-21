import { WsClient } from "../ws/client.js";
import type { StateMessage } from "../ws/protocol.js";
import { createParamsPanel } from "./params-panel.js";

const ws = new WsClient("admin");

// --- Build UI ---

const container = document.createElement("div");
container.className = "admin-container";

// Header
const header = document.createElement("header");
header.className = "admin-header";
header.innerHTML = `<h1>時痕 Rubato</h1><div class="subtitle">admin</div>`;
container.appendChild(header);

// Connection status
const status = document.createElement("div");
status.className = "connection-status";
const dot = document.createElement("span");
dot.className = "dot";
const statusText = document.createElement("span");
statusText.textContent = "Disconnected";
status.appendChild(dot);
status.appendChild(statusText);
container.appendChild(status);

// Piece state
const stateSection = document.createElement("div");
stateSection.className = "piece-state";
const stateLabel = document.createElement("div");
stateLabel.className = "label";
stateLabel.textContent = "Piece State";
const stateValue = document.createElement("div");
stateValue.className = "value";
stateValue.textContent = "—";
stateSection.appendChild(stateLabel);
stateSection.appendChild(stateValue);
container.appendChild(stateSection);

// Controls
const controls = document.createElement("div");
controls.className = "controls";

const runBtn = document.createElement("button");
runBtn.textContent = "Run";
runBtn.disabled = true;

const stopBtn = document.createElement("button");
stopBtn.textContent = "Stop";
stopBtn.disabled = true;

const reloadBtn = document.createElement("button");
reloadBtn.textContent = "Reload";
reloadBtn.className = "danger";
reloadBtn.disabled = true;

controls.appendChild(runBtn);
controls.appendChild(stopBtn);
controls.appendChild(reloadBtn);
container.appendChild(controls);

// Display toggles
const toggles = document.createElement("div");
toggles.className = "controls toggles";

const toggleGuiBtn = document.createElement("button");
toggleGuiBtn.textContent = "Toggle Params";
toggleGuiBtn.disabled = true;

const toggleHudBtn = document.createElement("button");
toggleHudBtn.textContent = "Toggle Stats";
toggleHudBtn.disabled = true;

toggles.appendChild(toggleGuiBtn);
toggles.appendChild(toggleHudBtn);
container.appendChild(toggles);

// Params panel (hidden by default, expandable)
const paramsPanel = createParamsPanel({
	onParamChange: (section, key, value) => {
		ws.sendParamUpdate(section, key, value);
	},
});
container.appendChild(paramsPanel.element);

document.body.appendChild(container);

// --- State tracking ---

let currentPieceState: string = "unknown";
let connected = false;

function updateButtons(): void {
	const isLobby = currentPieceState === "lobby";
	const isRunning = currentPieceState === "running";

	runBtn.disabled = !connected || isRunning;
	stopBtn.disabled = !connected || isLobby;
	reloadBtn.disabled = !connected;

	// Toggle buttons only work when piece is running
	toggleGuiBtn.disabled = !connected || !isRunning;
	toggleHudBtn.disabled = !connected || !isRunning;
}

// --- Wire up controls ---

runBtn.addEventListener("click", () => ws.sendCommand("run"));
stopBtn.addEventListener("click", () => ws.sendCommand("stop"));
reloadBtn.addEventListener("click", () => ws.sendCommand("reload"));
toggleGuiBtn.addEventListener("click", () => ws.sendCommand("toggleGui"));
toggleHudBtn.addEventListener("click", () => ws.sendCommand("toggleHud"));

// --- Wire up WS events ---

ws.onState((state: StateMessage) => {
	currentPieceState = state.state;

	const labels: Record<string, string> = {
		lobby: "Lobby",
		running: "Running",
		error: "Error",
	};
	stateValue.textContent = labels[state.state] ?? state.state;

	if (state.guiVisible !== undefined) {
		toggleGuiBtn.textContent = state.guiVisible ? "Hide Params" : "Show Params";
	}
	if (state.hudVisible !== undefined) {
		toggleHudBtn.textContent = state.hudVisible ? "Hide Stats" : "Show Stats";
	}

	updateButtons();
});

ws.onParamState((msg) => {
	paramsPanel.updateParams(msg.params);
});

ws.onConnectionChange((isConnected: boolean) => {
	connected = isConnected;

	if (isConnected) {
		dot.classList.add("connected");
		statusText.textContent = "Connected";
	} else {
		dot.classList.remove("connected");
		statusText.textContent = "Disconnected";
	}

	updateButtons();
});
