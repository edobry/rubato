import { WsClient } from "../ws/client.js";
import type { StateMessage } from "../ws/protocol.js";

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
}

// --- Wire up controls ---

runBtn.addEventListener("click", () => ws.sendCommand("run"));
stopBtn.addEventListener("click", () => ws.sendCommand("stop"));
reloadBtn.addEventListener("click", () => ws.sendCommand("reload"));

// --- Wire up WS events ---

ws.onState((state: StateMessage) => {
	currentPieceState = state.state;

	const labels: Record<string, string> = {
		lobby: "Lobby",
		running: "Running",
		error: "Error",
	};
	stateValue.textContent = labels[state.state] ?? state.state;

	updateButtons();
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
