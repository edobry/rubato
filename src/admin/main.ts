import { encodePresetHash } from "../preset-url.js";
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

// Live Preview
const previewSection = document.createElement("div");
previewSection.className = "live-preview section-card";

const previewLabel = document.createElement("div");
previewLabel.className = "section-label";
previewLabel.textContent = "Live Preview";

const previewStatus = document.createElement("div");
previewStatus.className = "preview-status";
previewStatus.textContent = "Disconnected";

const previewHeader = document.createElement("div");
previewHeader.className = "preview-header";
previewHeader.appendChild(previewLabel);
previewHeader.appendChild(previewStatus);
previewSection.appendChild(previewHeader);

const previewVideoWrap = document.createElement("div");
previewVideoWrap.className = "preview-video-wrap";

const previewVideo = document.createElement("video");
previewVideo.className = "preview-video";
previewVideo.muted = true;
previewVideo.autoplay = true;
previewVideo.playsInline = true;
previewVideoWrap.appendChild(previewVideo);

const fullscreenBtn = document.createElement("button");
fullscreenBtn.className = "preview-fullscreen-btn";
fullscreenBtn.textContent = "\u26F6";
fullscreenBtn.title = "Toggle fullscreen";
fullscreenBtn.addEventListener("click", () => {
	if (document.fullscreenElement) {
		document.exitFullscreen();
	} else {
		previewVideo.requestFullscreen();
	}
});
previewVideoWrap.appendChild(fullscreenBtn);

document.addEventListener("fullscreenchange", () => {
	fullscreenBtn.textContent = document.fullscreenElement ? "\u2715" : "\u26F6";
});

previewSection.appendChild(previewVideoWrap);

const previewBtn = document.createElement("button");
previewBtn.textContent = "Connect";
previewBtn.disabled = true;
previewSection.appendChild(previewBtn);

// Clip controls
const clipControls = document.createElement("div");
clipControls.className = "clip-controls";

const clipDuration = document.createElement("select");
clipDuration.className = "clip-duration";
const durations = [15, 30, 60, 120];
for (const d of durations) {
	const opt = document.createElement("option");
	opt.value = String(d);
	opt.textContent = d < 60 ? `${d}s` : `${d / 60}m`;
	if (d === 30) opt.selected = true;
	clipDuration.appendChild(opt);
}

const clipBtn = document.createElement("button");
clipBtn.className = "clip-btn";
clipBtn.textContent = "Clip";
clipBtn.disabled = true;

clipControls.appendChild(clipDuration);
clipControls.appendChild(clipBtn);
previewSection.appendChild(clipControls);

// Clip history list
const clipList = document.createElement("div");
clipList.className = "clip-list";
previewSection.appendChild(clipList);

container.appendChild(previewSection);

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
presetSection.className = "presets section-card";

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

const shareBtn = document.createElement("button");
shareBtn.textContent = "Share Current Look";
shareBtn.className = "share-btn";
shareBtn.disabled = true;
presetSection.appendChild(shareBtn);

shareBtn.addEventListener("click", () => {
	// Build a CreativePreset-like object from current params
	const preset = { name: "shared", ...currentParams };
	const hash = encodePresetHash(
		preset as unknown as import("../presets.js").CreativePreset,
	);
	const url = `${window.location.origin}/#${hash}`;

	// Copy to clipboard
	navigator.clipboard.writeText(url).then(
		() => {
			shareBtn.textContent = "Copied!";
			setTimeout(() => {
				shareBtn.textContent = "Share Current Look";
			}, 2000);
		},
		() => {
			// Fallback: show the URL in a prompt
			prompt("Share URL:", url);
		},
	);
});

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

let currentParams: Record<
	string,
	Record<string, number | string | boolean>
> = {};
let currentPieceState: string = "unknown";
let connected = false;
let pc: RTCPeerConnection | null = null;
let streamActive = false;

function setPreviewState(state: "disconnected" | "connecting" | "live"): void {
	previewStatus.textContent = state.charAt(0).toUpperCase() + state.slice(1);
	previewStatus.className = `preview-status ${state}`;
	previewBtn.textContent = state === "disconnected" ? "Connect" : "Disconnect";
	previewVideo.style.display = state === "live" ? "block" : "none";
	previewVideoWrap.classList.toggle("live", state === "live");
	streamActive = state !== "disconnected";
	updateClipButton();
}

function startStream(): void {
	setPreviewState("connecting");

	pc = new RTCPeerConnection({
		iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
	});

	pc.ontrack = (event) => {
		previewVideo.srcObject = event.streams[0] ?? new MediaStream([event.track]);
		setPreviewState("live");
	};

	pc.onicecandidate = (event) => {
		if (event.candidate) {
			ws.sendRtcIceCandidate(ws.adminId!, event.candidate.toJSON());
		}
	};

	pc.onconnectionstatechange = () => {
		if (
			pc?.connectionState === "failed" ||
			pc?.connectionState === "disconnected"
		) {
			stopStream();
		}
	};

	// Request the piece to start streaming
	ws.sendStreamRequest();
}

function stopStream(): void {
	if (pc) {
		pc.close();
		pc = null;
	}
	previewVideo.srcObject = null;
	ws.sendStreamStop();
	setPreviewState("disconnected");
}

previewBtn.addEventListener("click", () => {
	if (streamActive) {
		stopStream();
	} else {
		startStream();
	}
});

// --- Clip controls ---

let clipPending = false;

function updateClipButton(): void {
	clipBtn.disabled = !streamActive || clipPending;
	clipDuration.disabled = !streamActive;
}

clipBtn.addEventListener("click", () => {
	if (clipPending) return;
	clipPending = true;
	clipBtn.textContent = "Saving...";
	clipBtn.disabled = true;
	ws.sendClipRequest(Number(clipDuration.value));
});

ws.onClipResponse((msg) => {
	clipPending = false;
	clipBtn.textContent = "Clip";
	updateClipButton();

	if (msg.status === "ready" && msg.url) {
		const item = document.createElement("div");
		item.className = "clip-item";

		const link = document.createElement("a");
		link.href = msg.url;
		link.download = msg.url.split("/").pop() ?? "clip.webm";
		link.textContent = new Date().toLocaleTimeString();
		link.className = "clip-link";

		const duration = document.createElement("span");
		duration.className = "clip-meta";
		duration.textContent = `${clipDuration.value}s`;

		item.appendChild(link);
		item.appendChild(duration);
		clipList.prepend(item);
	} else if (msg.status === "empty") {
		clipBtn.textContent = "No data";
		setTimeout(() => {
			clipBtn.textContent = "Clip";
		}, 2000);
	} else if (msg.status === "error") {
		clipBtn.textContent = "Error";
		setTimeout(() => {
			clipBtn.textContent = "Clip";
		}, 2000);
		console.error("[admin] Clip error:", msg.error);
	}
});

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
	shareBtn.disabled =
		!connected ||
		currentPieceState !== "running" ||
		Object.keys(currentParams).length === 0;
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

	// Preview button enabled when connected
	previewBtn.disabled = !connected;

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
		toggleGuiBtn.classList.toggle("toggle-active", state.guiVisible);
	}
	if (state.hudVisible !== undefined) {
		toggleHudBtn.textContent = state.hudVisible ? "Hide Stats" : "Show Stats";
		toggleHudBtn.classList.toggle("toggle-active", state.hudVisible);
	}

	updateButtons();
});

ws.onParamState((msg) => {
	currentParams = msg.params;
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

// --- Wire up WebRTC signaling ---

ws.onRtcOffer(async (msg) => {
	if (!pc) return;
	await pc.setRemoteDescription(msg.offer);
	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);
	ws.sendRtcAnswer(ws.adminId!, pc.localDescription!);
});

ws.onRtcIceCandidate((msg) => {
	if (pc) {
		void pc.addIceCandidate(msg.candidate);
	}
});

ws.onConnectionChange((isConnected: boolean) => {
	connected = isConnected;

	if (isConnected) {
		dot.classList.add("connected");
		statusText.textContent = "Connected";
		stateSection.classList.remove("stale");
		paramsPanel.setDisabled(false);
	} else {
		dot.classList.remove("connected");
		statusText.textContent = "Disconnected";
		if (streamActive) {
			stopStream();
		}

		// Mark state info as stale
		currentPieceState = "unknown";
		stateValue.textContent = "Unknown";
		presetInfoValue.textContent = "Unknown";
		stateSection.classList.add("stale");

		// Disable params panel and preset controls
		paramsPanel.setDisabled(true);
		presetSelect.disabled = true;
		presetNameInput.disabled = true;
	}

	updateClipButton();
	updateButtons();
});

// --- Build-info check polling ---

async function checkBuildInfo(): Promise<void> {
	try {
		const res = await fetch("/api/build-info");
		if (!res.ok) return;
		const data = (await res.json()) as { hash: string; buildTime: string };
		const updateAvailable =
			data.hash !== "unknown" && data.hash !== __GIT_HASH__;
		if (updateAvailable) {
			reloadBtn.textContent = "Reload \u25cf";
			reloadBtn.classList.add("update-available");
		} else {
			reloadBtn.textContent = "Reload";
			reloadBtn.classList.remove("update-available");
		}
	} catch {
		// Build-info check failed — silently ignore
	}
}

void checkBuildInfo();
setInterval(() => void checkBuildInfo(), 30_000);

// --- Toast ---

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(text: string): void {
	if (!toastEl) {
		toastEl = document.createElement("div");
		toastEl.className = "admin-toast";
		document.body.appendChild(toastEl);
	}

	toastEl.textContent = text;
	toastEl.classList.add("visible");

	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		toastEl?.classList.remove("visible");
		toastTimer = null;
	}, 2000);
}

// --- Swipe preset cycling ---

function cycleAdminPreset(direction: 1 | -1): void {
	if (presetList.length === 0) return;

	let idx = presetList.findIndex((p) => p.name === activePreset);
	if (idx === -1) idx = 0;
	idx = (idx + direction + presetList.length) % presetList.length;

	const preset = presetList[idx]!;
	presetSelect.value = preset.name;
	presetNameInput.value = preset.name;
	ws.sendPresetCommand("apply", preset.name);
	showToast(preset.name);
	updatePresetButtons();
}

{
	let touchStartX = 0;
	let touchStartY = 0;
	let touchInsideParams = false;

	window.addEventListener(
		"touchstart",
		(e) => {
			if (e.touches.length === 1) {
				touchStartX = e.touches[0]!.clientX;
				touchStartY = e.touches[0]!.clientY;
				// Check if the touch started inside the params panel
				touchInsideParams = !!(
					e.target instanceof Node && paramsPanel.element.contains(e.target)
				);
			}
		},
		{ passive: true },
	);

	window.addEventListener(
		"touchend",
		(e) => {
			if (touchInsideParams) return;
			if (!connected || currentPieceState !== "running") return;
			if (e.changedTouches.length !== 1) return;

			const dx = e.changedTouches[0]!.clientX - touchStartX;
			const dy = e.changedTouches[0]!.clientY - touchStartY;

			// Only trigger if horizontal movement > 50px and dominates vertical
			if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				cycleAdminPreset(dx > 0 ? -1 : 1);
			}
		},
		{ passive: true },
	);
}

// --- Help button & overlay ---

const helpBtn = document.createElement("button");
helpBtn.className = "admin-help-btn";
helpBtn.textContent = "?";
helpBtn.setAttribute("aria-label", "Help");
document.body.appendChild(helpBtn);

const helpOverlay = document.createElement("div");
helpOverlay.className = "admin-help-overlay";
helpOverlay.innerHTML = `
	<div class="admin-help-content">
		<h2>Admin Help</h2>
		<div class="help-section">
			<div class="help-heading">Gestures</div>
			<p>Swipe left/right to browse presets</p>
		</div>
		<div class="help-section">
			<div class="help-heading">About</div>
			<p>This panel controls the 時痕 Rubato piece remotely. Use it to start/stop the piece, switch presets, adjust parameters, and preview the live output.</p>
		</div>
		<div class="help-dismiss">Tap anywhere to dismiss</div>
	</div>
`;
document.body.appendChild(helpOverlay);

let helpVisible = false;

function toggleHelp(): void {
	helpVisible = !helpVisible;
	helpOverlay.classList.toggle("visible", helpVisible);
	helpBtn.classList.toggle("active", helpVisible);
}

helpBtn.addEventListener("click", toggleHelp);
helpOverlay.addEventListener("click", toggleHelp);
