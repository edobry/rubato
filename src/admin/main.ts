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
header.innerHTML = `<h1>時痕 Rubato</h1><div class="subtitle">admin</div><div class="version">v: ${__GIT_HASH__}</div>`;
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

const presetInfo = document.createElement("div");
presetInfo.className = "preset-info";
const presetInfoLabel = document.createElement("span");
presetInfoLabel.className = "label";
presetInfoLabel.textContent = "Preset";
const presetInfoValue = document.createElement("span");
presetInfoValue.className = "value";
presetInfoValue.textContent = "—";
presetInfo.appendChild(presetInfoLabel);
presetInfo.appendChild(presetInfoValue);
stateSection.appendChild(presetInfo);

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

// Preset management
const presetSection = document.createElement("div");
presetSection.className = "controls presets";

const presetLabel = document.createElement("div");
presetLabel.className = "section-label";
presetLabel.textContent = "Presets";
presetSection.appendChild(presetLabel);

const presetSelect = document.createElement("select");
presetSelect.className = "preset-select";
presetSelect.disabled = true;
presetSection.appendChild(presetSelect);

const presetNameInput = document.createElement("input");
presetNameInput.type = "text";
presetNameInput.className = "preset-name-input";
presetNameInput.placeholder = "Preset name...";
presetNameInput.disabled = true;
presetSection.appendChild(presetNameInput);

const presetButtons = document.createElement("div");
presetButtons.className = "preset-buttons";

const applyBtn = document.createElement("button");
applyBtn.textContent = "Apply";
applyBtn.disabled = true;

const saveBtn = document.createElement("button");
saveBtn.textContent = "Save";
saveBtn.disabled = true;

const deleteBtn = document.createElement("button");
deleteBtn.textContent = "Delete";
deleteBtn.className = "danger";
deleteBtn.disabled = true;

presetButtons.appendChild(applyBtn);
presetButtons.appendChild(saveBtn);
presetButtons.appendChild(deleteBtn);
presetSection.appendChild(presetButtons);

container.appendChild(presetSection);

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

// Track preset state
let presetList: Array<{ name: string; isBuiltIn: boolean }> = [];
let activePreset = "";

function updatePresetButtons(): void {
	const selected = presetSelect.value;
	const isBuiltIn =
		presetList.find((p) => p.name === selected)?.isBuiltIn ?? true;
	applyBtn.disabled =
		!connected || currentPieceState !== "running" || selected === activePreset;
	presetNameInput.disabled = !connected || currentPieceState !== "running";
	saveBtn.disabled =
		!connected ||
		currentPieceState !== "running" ||
		!presetNameInput.value.trim();
	deleteBtn.disabled =
		!connected || currentPieceState !== "running" || isBuiltIn;
}

function updateButtons(): void {
	const isLobby = currentPieceState === "lobby";
	const isRunning = currentPieceState === "running";

	runBtn.disabled = !connected || isRunning;
	stopBtn.disabled = !connected || isLobby;
	reloadBtn.disabled = !connected;

	// Toggle buttons only work when piece is running
	toggleGuiBtn.disabled = !connected || !isRunning;
	toggleHudBtn.disabled = !connected || !isRunning;

	updatePresetButtons();
}

// --- Wire up controls ---

runBtn.addEventListener("click", () => ws.sendCommand("run"));
stopBtn.addEventListener("click", () => ws.sendCommand("stop"));
reloadBtn.addEventListener("click", () => ws.sendCommand("reload"));
toggleGuiBtn.addEventListener("click", () => ws.sendCommand("toggleGui"));
toggleHudBtn.addEventListener("click", () => ws.sendCommand("toggleHud"));

// --- Preset controls ---

presetSelect.addEventListener("change", () => {
	presetNameInput.value = presetSelect.value;
	updatePresetButtons();
});

presetNameInput.addEventListener("input", updatePresetButtons);

applyBtn.addEventListener("click", () => {
	ws.sendPresetCommand("apply", presetSelect.value);
});

saveBtn.addEventListener("click", () => {
	const name = presetNameInput.value.trim();
	if (!name) return;
	ws.sendPresetCommand("save", name);
});

deleteBtn.addEventListener("click", () => {
	const selected = presetSelect.value;
	if (confirm(`Delete preset "${selected}"?`)) {
		ws.sendPresetCommand("delete", selected);
	}
});

// --- Wire up WS events ---

ws.onState((state: StateMessage) => {
	currentPieceState = state.state;

	const labels: Record<string, string> = {
		lobby: "Lobby",
		running: "Running",
		error: "Error",
	};
	stateValue.textContent = labels[state.state] ?? state.state;

	if (state.preset) {
		presetInfoValue.textContent = state.preset;
	}

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

ws.onPresetList((msg) => {
	presetList = msg.presets;
	activePreset = msg.active;
	presetInfoValue.textContent = msg.active;

	// Rebuild dropdown
	presetSelect.innerHTML = "";
	for (const p of msg.presets) {
		const opt = document.createElement("option");
		opt.value = p.name;
		opt.textContent = p.isBuiltIn ? p.name : `★ ${p.name}`;
		presetSelect.appendChild(opt);
	}
	presetSelect.value = msg.active;
	presetSelect.disabled = false;
	presetNameInput.value = msg.active;
	presetNameInput.disabled = !connected || currentPieceState !== "running";
	updatePresetButtons();
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
