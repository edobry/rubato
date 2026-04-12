import {
	hideAdminOverlay,
	isAdminOverlayVisible,
	toggleAdminOverlay,
} from "./admin-overlay";
import {
	autoTuneState,
	autoTuneTick,
	onLogChange,
	resetAutoTuneFrames,
} from "./autotune";
import { flipCamera, initCamera } from "./camera";
import { removeCameraError, showCameraError } from "./camera-error";
import {
	compositeFrame,
	getCompositorGl,
	initCompositor,
	resizeCompositor,
} from "./compositor";
import { computeDisplayBounds } from "./coords";
import { detectDevice, isMobile } from "./device";
import {
	getDensityTexture,
	getFluidVelocityTexture,
	initFluid,
	resetFluid,
	updateFluid,
} from "./fluid";
import { initFog, renderFogToTexture, resizeFog, setFogCrop } from "./fog";
import { FpsCounter } from "./fps";
import { initGui, isGuiVisible, toggleGui } from "./gui";
import {
	hideHelpOverlay,
	isHelpOverlayVisible,
	toggleHelpOverlay,
} from "./help-overlay";
import { initInfoWatermark } from "./info-watermark";
import { hideLoading, showLoading } from "./loading";
import { destroyLobby, showLobby, updateLobbyStatus } from "./lobby.js";
import { initMobileControls } from "./mobile-controls";
import {
	detectMotion,
	detectMotionMap,
	initGpuTrail,
	isGpuTrailActive,
	resetMotion,
	updateGpuTrail,
} from "./motion";
import { onParamChange, params, SEGMENTATION_MODELS } from "./params";
import {
	drawPerfOverlay,
	getPerfSummary,
	perfFrameEnd,
	perfFrameStart,
	perfMark,
} from "./perf";
import { initPresetSwitcher } from "./preset-switcher";
import { getPresetFromUrl } from "./preset-url.js";
import {
	applyPreset,
	deletePreset,
	extractPreset,
	getBundledPresets,
	getLastPreset,
	getUserPresets,
	savePreset,
	setLastPreset,
} from "./presets.js";
import {
	createSegmentationPipeline,
	resolveModelConfig,
} from "./segmentation-state";
import { initShadow, renderShadowToTexture, setShadowCrop } from "./shadow";
import { showStatus } from "./status";
import { initStreaming } from "./stream.js";
import { WsClient } from "./ws/client.js";

/** Serialize all params to a plain object for WS transmission. */
function serializeParams(): Record<
	string,
	Record<string, number | string | boolean>
> {
	const result: Record<string, Record<string, number | string | boolean>> = {};
	for (const [section, values] of Object.entries(params)) {
		result[section] = {};
		for (const [key, value] of Object.entries(values)) {
			if (
				typeof value === "number" ||
				typeof value === "string" ||
				typeof value === "boolean"
			) {
				result[section][key] = value;
			}
		}
	}
	return result;
}

// Exposed so GUI can trigger camera re-acquisition
let video: HTMLVideoElement | null = null;
let currentResolution = params.camera.resolution;
let resolutionChanging = false;
let hudVisible = false;

function toggleHud(): boolean {
	hudVisible = !hudVisible;
	return hudVisible;
}

async function changeResolution(resolution: string): Promise<void> {
	if (resolutionChanging) return;
	resolutionChanging = true;
	currentResolution = resolution; // Update immediately to prevent re-entry
	try {
		video = await initCamera(resolution);
		// Reset autotune frame collection so it doesn't evaluate the
		// low-FPS frames captured during the resolution change stall.
		resetAutoTuneFrames();
		console.log(`Camera switched to ${resolution}`);
	} catch (err) {
		console.error("Failed to change resolution:", err);
	} finally {
		resolutionChanging = false;
	}
}

interface FrameState {
	readonly mask: Float32Array | null;
	readonly motion: Float32Array | null;
	readonly trail: Float32Array | null;
	readonly trailTex: WebGLTexture | null;
	readonly maskW: number;
	readonly maskH: number;
	readonly generation: number;
}

async function main(ws?: WsClient): Promise<void> {
	// Show loading overlay while camera + model initialize
	const loadingEl = showLoading();
	document.body.appendChild(loadingEl);

	// Auto-apply constrained device defaults on first visit
	const device = detectDevice();
	if (
		device.isConstrained &&
		!localStorage.getItem("rubato-device-configured")
	) {
		console.log(
			`Constrained device detected (${device.platform}), applying Pi defaults`,
		);
		params.segmentation.model = "fast";
		params.segmentation.frameSkip = 4;
		params.camera.resolution = "480p";
		params.fog.octaves = 2;
		params.fog.renderScale = 0.5;
		params.overlay.downsample = 2;
		localStorage.setItem("rubato-device-configured", "true");
		showStatus(
			`${device.platform} detected — optimized defaults applied`,
			3000,
		);
	}

	// Apply mobile-friendly defaults on first visit (or when version changes)
	const MOBILE_DEFAULTS_VERSION = "2";
	if (
		isMobile() &&
		localStorage.getItem("rubato-mobile-configured") !== MOBILE_DEFAULTS_VERSION
	) {
		console.log("Mobile device detected, applying mobile defaults");
		// Camera & segmentation
		params.camera.resolution = "480p";
		params.segmentation.frameSkip = Math.max(params.segmentation.frameSkip, 2);
		// Fog: reduce octaves, render at half res, skip every other frame
		params.fog.octaves = 3;
		params.fog.renderScale = 0.5;
		params.fog.frameSkip = 2;
		localStorage.setItem("rubato-mobile-configured", MOBILE_DEFAULTS_VERSION);
		showStatus("Mobile device — optimized defaults applied", 3000);
	}

	// Initialize the WebGL compositor
	const maybeCanvas = initCompositor();
	if (!maybeCanvas) {
		console.error("Compositor init failed — cannot render");
		showStatus("WebGL compositor failed to initialize", 5000);
		return;
	}
	const compositorCanvas: HTMLCanvasElement = maybeCanvas;
	document.body.appendChild(compositorCanvas);
	resizeCompositor();

	// GPU trail — shares compositor GL context
	const compositorGl = getCompositorGl();
	if (compositorGl) {
		initGpuTrail(compositorGl);
	}

	// Shadow fog pipeline — shares compositor GL context
	if (compositorGl) {
		initFluid(compositorGl);
		initShadow(compositorGl);
	}

	// Fog field — shares compositor GL context
	initFog(compositorGl!);
	resizeFog();

	// HUD canvas — transparent overlay for FPS graph, perf, tuning indicator.
	const hudCanvas = document.createElement("canvas");
	hudCanvas.style.cssText =
		"position:fixed;inset:0;width:100%;height:100%;z-index:9999;pointer-events:none";
	document.body.appendChild(hudCanvas);
	const hudCtx = hudCanvas.getContext("2d");

	window.addEventListener("resize", () => {
		resizeFog();
		resizeCompositor();
		hudCanvas.width = window.innerWidth;
		hudCanvas.height = window.innerHeight;
	});
	hudCanvas.width = window.innerWidth;
	hudCanvas.height = window.innerHeight;

	// Hide cursor for gallery display. Always hidden — no mouse interaction expected.
	document.body.style.cursor = "none";

	// GUI panel — toggle with G key (loads presets which may override params)
	initGui();

	// Preset switcher — arrow keys / swipe to cycle presets when panel is closed
	// onSwitch callback is set later when WS is connected (see sendPresetList)
	let presetSwitchNotify: (() => void) | null = null;
	initPresetSwitcher(() => presetSwitchNotify?.());

	// Watermark — subtle "時痕" in bottom-left, click to return to lobby
	initInfoWatermark();

	// One-time hint for new visitors: show "press ? for controls" after 10s
	const HINT_KEY = "rubato-hint-shown";
	if (!localStorage.getItem(HINT_KEY)) {
		setTimeout(() => {
			const hint = document.createElement("div");
			hint.style.cssText = `
				position: fixed;
				bottom: 32px;
				left: 50%;
				transform: translateX(-50%);
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
				font-size: 14px;
				font-weight: 300;
				letter-spacing: 0.08em;
				color: #ddd;
				text-shadow: 0 0 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7);
				background: rgba(0,0,0,0.4);
				padding: 8px 20px;
				border-radius: 8px;
				z-index: 10000;
				opacity: 0;
				transition: opacity 1s ease;
				pointer-events: none;
				-webkit-font-smoothing: antialiased;
			`;
			hint.textContent = isMobile()
				? "swipe left or right to browse presets"
				: "press Tab to customize \u00b7 \u2190 \u2192 to browse presets";
			document.body.appendChild(hint);

			// Fade in
			requestAnimationFrame(() => {
				hint.style.opacity = "1";
			});

			// Fade out after 5 seconds
			setTimeout(() => {
				hint.style.opacity = "0";
				setTimeout(() => hint.remove(), 1000);
			}, 5000);

			localStorage.setItem(HINT_KEY, "1");
		}, 10000);
	}

	// Enforce performance floors AFTER presets load (presets are creative-only
	// but older presets may have included perf params before we split them)
	if (device.isConstrained) {
		if (params.overlay.downsample < 2) params.overlay.downsample = 2;
	}

	// Admin overlay — press A to toggle, Escape to dismiss
	window.addEventListener("keydown", (e) => {
		// Don't intercept if user is typing in an input field
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;

		if (e.key === "a" || e.key === "A") {
			if (isHelpOverlayVisible()) hideHelpOverlay();
			toggleAdminOverlay();
		} else if (e.key === "f" || e.key === "F") {
			if (document.fullscreenElement) {
				void document.exitFullscreen();
			} else {
				void document.documentElement.requestFullscreen();
			}
		} else if (e.key === "Enter") {
			// Dismiss overlays (Escape is eaten by the browser in fullscreen)
			if (isHelpOverlayVisible()) {
				hideHelpOverlay();
			} else if (isAdminOverlayVisible()) {
				hideAdminOverlay();
			}
		} else if (e.key === "s" || e.key === "S") {
			toggleHud();
		} else if (e.key === "?") {
			if (isAdminOverlayVisible()) hideAdminOverlay();
			toggleHelpOverlay();
		} else if (e.key === "l" || e.key === "L") {
			localStorage.removeItem(PIECE_STATE_KEY);
			location.reload();
		} else if (e.key === "Escape") {
			if (isHelpOverlayVisible()) {
				hideHelpOverlay();
			} else if (isAdminOverlayVisible()) {
				hideAdminOverlay();
			}
		}
	});

	// Triple-tap to toggle HUD on mobile (equivalent to 'S' key)
	{
		let tapCount = 0;
		let tapTimer: ReturnType<typeof setTimeout> | null = null;
		document.addEventListener("touchend", (e) => {
			// Only count single-finger taps, ignore multi-touch
			if (e.changedTouches.length !== 1) return;
			tapCount++;
			if (tapTimer) clearTimeout(tapTimer);
			if (tapCount >= 3) {
				tapCount = 0;
				toggleHud();
			} else {
				tapTimer = setTimeout(() => {
					tapCount = 0;
				}, 400);
			}
		});
	}

	const fps = new FpsCounter();

	showStatus("Initializing camera...");
	try {
		video = await initCamera(params.camera.resolution);
		showStatus("Camera ready");
	} catch (err) {
		console.error("Camera unavailable:", err);
		showCameraError(() => {
			// Re-attempt camera init on "Try again"
			void initCamera(params.camera.resolution)
				.then((v) => {
					video = v;
					showStatus("Camera ready");
					removeCameraError();
					// Continue with the rest of init by reloading
					location.reload();
				})
				.catch((retryErr) => {
					console.error("Camera retry failed:", retryErr);
				});
		});
		return;
	}

	// Initialize segmentation pipeline (tries worker, falls back to sync)
	const pipeline = createSegmentationPipeline();
	showStatus("Loading segmentation model...");
	const { modelUrl, delegate } = resolveModelConfig();
	await pipeline.init(modelUrl, delegate);
	hideLoading(loadingEl);

	// Show autotune actions as brief status notifications
	onLogChange((log) => {
		if (log.length > 0) {
			const latest = log[log.length - 1]!;
			// Strip the timestamp prefix (e.g. "12:34:56 PM ...")
			const msg = latest.replace(/^\S+\s+(AM|PM)?\s*/, "");
			showStatus(`autotune: ${msg}`, 3000);
		}
	});

	// Track the model/delegate so we can detect changes via GUI/presets
	let workerModel = params.segmentation.model;
	let workerDelegate = delegate;

	let currentFrame: FrameState = {
		mask: null,
		motion: null,
		trail: null,
		trailTex: null,
		maskW: 0,
		maskH: 0,
		generation: 0,
	};

	// Clear cached frame state when visualization mode changes, and
	// re-initialize the pipeline when the segmentation model or delegate changes.
	onParamChange((section, key) => {
		if (
			section === "overlay" &&
			(key === "visualize" || key === "showOverlay")
		) {
			currentFrame = {
				mask: null,
				motion: null,
				trail: null,
				trailTex: null,
				maskW: 0,
				maskH: 0,
				generation: currentFrame.generation + 1,
			};
			pipeline.reset();
			resetMotion();
			resetFluid();
		}

		if (section === "segmentation" && (key === "model" || key === "delegate")) {
			const newModel = params.segmentation.model;
			const newDelegate = params.segmentation.delegate;
			if (newModel !== workerModel || newDelegate !== workerDelegate) {
				console.log(
					`[rubato] segmentation config changed (${workerModel}/${workerDelegate} -> ${newModel}/${newDelegate}), re-initializing`,
				);
				workerModel = newModel;
				workerDelegate = newDelegate;
				currentFrame = {
					mask: null,
					motion: null,
					trail: null,
					trailTex: null,
					maskW: 0,
					maskH: 0,
					generation: currentFrame.generation + 1,
				};
				resetMotion();
				resetFluid();

				const newModelUrl = (SEGMENTATION_MODELS[newModel] ??
					SEGMENTATION_MODELS.fast)!;
				const resolvedDelegate =
					localStorage.getItem("rubato-gpu-failed") === "true"
						? "CPU"
						: newDelegate;
				void pipeline.reinit(newModelUrl, resolvedDelegate);
			}
		}
	});

	let frameCount = 0;

	function produceFrameData(): FrameState {
		const pipelineState = pipeline.getState();
		const isReady =
			pipelineState.status === "ready" || pipelineState.status === "processing";

		// Produce mask data when needed: overlay visible OR fog interaction active.
		// Skip segmentation only when mask data is genuinely unused (perf savings on Pi).
		const needsMask =
			params.overlay.showOverlay ||
			params.fog.maskInteraction > 0 ||
			params.fog.trailInteraction > 0 ||
			params.fog.mode === "shadow";
		if (video && isReady && needsMask) {
			const skip = Math.max(1, Math.round(params.segmentation.frameSkip));

			if (frameCount % skip === 0) {
				pipeline.sendFrame(video, params.segmentation.confidenceThreshold);
			}

			// Check for new results
			const result = pipeline.getLatestResult();
			if (result && result.mask !== currentFrame.mask) {
				let motion: Float32Array | null = currentFrame.motion;
				let trail: Float32Array | null = currentFrame.trail;
				let trailTex: WebGLTexture | null = currentFrame.trailTex;
				if (params.overlay.visualize !== "mask") {
					if (isGpuTrailActive()) {
						// GPU trail path: compute motion diff on CPU, accumulate on GPU
						const motionMap = detectMotionMap(
							result.mask,
							result.width,
							result.height,
						);
						motion = motionMap;
						// In imprint mode, pass the mask to the trail shader for cultivation
						const maskForTrail =
							params.overlay.visualize === "imprint" ? result.mask : null;
						trailTex =
							updateGpuTrail(
								motionMap,
								result.width,
								result.height,
								maskForTrail,
							) ?? trailTex;
						trail = null; // not used in GPU path
					} else {
						// Legacy CPU trail path
						const motionResult = detectMotion(
							result.mask,
							result.width,
							result.height,
						);
						motion = motionResult.motion;
						trail = motionResult.trail;
					}
				}
				currentFrame = {
					mask: result.mask,
					motion,
					trail,
					trailTex,
					maskW: result.width,
					maskH: result.height,
					generation: currentFrame.generation + 1,
				};
			}
		}

		return currentFrame;
	}

	function loop(): void {
		if (!video) return;

		perfFrameStart();

		// Enforce lower FPS target on mobile (thermal headroom, reduces thrashing)
		if (isMobile() && params.autoTune.targetFps > 24) {
			params.autoTune.targetFps = 24;
		}

		autoTuneTick();

		// Check if resolution changed via GUI (or auto-tuner)
		if (params.camera.resolution !== currentResolution) {
			void changeResolution(params.camera.resolution);
		}

		const data = produceFrameData();
		perfMark("segmentation", "#ff4444");

		// Update fog crop to match camera's visible region
		if (video.videoWidth > 0 && video.videoHeight > 0) {
			const bounds = computeDisplayBounds(
				{ width: video.videoWidth, height: video.videoHeight },
				{
					width: compositorCanvas.width,
					height: compositorCanvas.height,
				},
				params.camera.fillAmount,
			);
			setFogCrop(
				[bounds.x / compositorCanvas.width, bounds.y / compositorCanvas.height],
				[bounds.w / compositorCanvas.width, bounds.h / compositorCanvas.height],
			);
			setShadowCrop(
				[bounds.x / compositorCanvas.width, bounds.y / compositorCanvas.height],
				[bounds.w / compositorCanvas.width, bounds.h / compositorCanvas.height],
			);
		} else {
			setFogCrop([0, 0], [0, 0]);
			setShadowCrop([0, 0], [0, 0]);
		}

		// Render backdrop: classic fog or shadow mode
		let fogTex: WebGLTexture | null;
		if (params.fog.mode === "shadow") {
			// Run fluid sim every frame for continuous momentum
			updateFluid(data.mask, data.motion, data.maskW, data.maskH);
			const denTex = getDensityTexture();
			const velTex = getFluidVelocityTexture();
			fogTex = renderShadowToTexture(denTex, velTex);
		} else {
			fogTex = renderFogToTexture();
		}
		// Select which data to pass based on the visualize dropdown
		const viz = params.overlay.visualize;
		let compMask: Float32Array | null = null;
		let compTrail: Float32Array | WebGLTexture | null = null;
		switch (viz) {
			case "mask":
				compMask = data.mask;
				break;
			case "motion":
				compMask = data.motion;
				break;
			case "trail":
				// Use GPU texture if available, fall back to CPU Float32Array
				compTrail = data.trailTex ?? data.trail;
				break;
			case "both":
				compMask = data.mask;
				compTrail = data.trailTex ?? data.trail;
				break;
			case "imprint":
				// No mask overlay — only density (G channel) via trail texture
				compTrail = data.trailTex ?? data.trail;
				break;
		}
		compositeFrame(video, fogTex, compMask, compTrail, data.maskW, data.maskH);

		perfMark("composite", "#ff8844");
		perfFrameEnd();

		// Draw FPS graph + perf overlay on the HUD canvas
		if (hudCtx) {
			hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
			if (hudVisible) {
				fps.draw(hudCtx);
				drawPerfOverlay(hudCtx);
			}
		}

		frameCount++;
		requestAnimationFrame(loop);
	}

	// Apply preset from URL hash if present
	const urlPreset = getPresetFromUrl();
	if (urlPreset) {
		applyPreset(urlPreset);
		console.log("[rubato] Applied preset from URL");
	}

	// Mobile controls — camera flip + fullscreen
	void initMobileControls({
		onFlipCamera: () => {
			void flipCamera(params.camera.resolution)
				.then((v) => {
					video = v;
					// Reset segmentation pipeline since camera dimensions may change
					pipeline.reset();
					resetMotion();
					resetFluid();
					currentFrame = {
						mask: null,
						motion: null,
						trail: null,
						trailTex: null,
						maskW: 0,
						maskH: 0,
						generation: currentFrame.generation + 1,
					};
					showStatus("Camera flipped");
				})
				.catch((err) => {
					console.error("Failed to flip camera:", err);
					showStatus("Camera flip failed");
				});
		},
	});

	requestAnimationFrame(loop);

	// Handle admin toggle commands and param sync
	if (ws) {
		const _streaming = initStreaming(ws, compositorCanvas);

		ws.onCommand((msg) => {
			if (msg.command === "toggleGui") {
				const visible = toggleGui();
				ws.sendState("running", {
					guiVisible: visible,
					hudVisible,
					preset: getLastPreset(),
				});
			} else if (msg.command === "toggleHud") {
				const visible = toggleHud();
				ws.sendState("running", {
					guiVisible: isGuiVisible(),
					hudVisible: visible,
					preset: getLastPreset(),
				});
			}
		});

		// --- Param sync ---

		// Send initial param state
		ws.sendParamState(serializeParams());

		// Receive param updates from admin and apply
		ws.onParamUpdate((msg) => {
			const section = params[msg.section as keyof typeof params];
			if (section && msg.key in section) {
				(section as Record<string, unknown>)[msg.key] = msg.value;
			}
		});

		// Broadcast param state to admin on any change (debounced)
		let paramSyncTimer: ReturnType<typeof setTimeout> | null = null;
		onParamChange(() => {
			if (paramSyncTimer) clearTimeout(paramSyncTimer);
			paramSyncTimer = setTimeout(() => {
				paramSyncTimer = null;
				ws.sendParamState(serializeParams());
			}, 100);
		});

		// --- Preset management ---

		// Helper to build and send the preset list
		function sendPresetList(): void {
			const bundled = Object.keys(getBundledPresets());
			const user = Object.keys(getUserPresets());
			const all: Array<{ name: string; isBuiltIn: boolean }> = [
				...bundled.map((name) => ({ name, isBuiltIn: true })),
				...user.map((name) => ({ name, isBuiltIn: false })),
			];
			const seen = new Set<string>();
			const deduped = all.filter((p) => {
				if (seen.has(p.name)) return false;
				seen.add(p.name);
				return true;
			});
			ws!.sendPresetList(deduped, getLastPreset());
		}

		// Send initial preset list
		sendPresetList();

		// Wire preset switcher (arrow keys) to notify admin of changes
		presetSwitchNotify = () => {
			sendPresetList();
			ws.sendParamState(serializeParams());
		};

		// Handle preset commands from admin
		ws.onPresetCommand((msg) => {
			switch (msg.action) {
				case "apply": {
					const user = getUserPresets();
					const bundled = getBundledPresets();
					const preset = user[msg.name] ?? bundled[msg.name];
					if (preset) {
						applyPreset(preset);
						setLastPreset(msg.name);
						// Param sync will broadcast updated values automatically
						sendPresetList();
					}
					break;
				}
				case "save": {
					const preset = extractPreset(msg.name);
					savePreset(msg.name, preset);
					setLastPreset(msg.name);
					sendPresetList();
					break;
				}
				case "delete": {
					deletePreset(msg.name);
					// If we deleted the active preset, switch to default
					if (getLastPreset() === msg.name) {
						setLastPreset("default");
						const defaultPreset = getBundledPresets().default;
						if (defaultPreset) applyPreset(defaultPreset);
					}
					sendPresetList();
					break;
				}
			}
		});

		// Send preset list when admin requests state
		ws.onRequestState(() => {
			sendPresetList();
		});
	}

	// Expose debug API for Playwright MCP / console access
	// biome-ignore lint/suspicious/noExplicitAny: debug API on window
	(window as any).__rubato = {
		get fps() {
			return autoTuneState.fps;
		},
		get perf() {
			return getPerfSummary();
		},
		get autotune() {
			return {
				status: autoTuneState.status,
				lastAction: autoTuneState.lastAction,
				adjustments: autoTuneState.adjustCount,
			};
		},
		get config() {
			return {
				model: params.segmentation.model,
				delegate: params.segmentation.delegate,
				resolution: params.camera.resolution,
				frameSkip: params.segmentation.frameSkip,
				downsample: params.overlay.downsample,
			};
		},
		get params() {
			return JSON.parse(JSON.stringify(params));
		},
		pipeline,
	};
}

// --- Error recovery for unattended gallery operation ---
// On unhandled errors or promise rejections, log and auto-reload after 5 seconds.
// Only one reload is ever scheduled to prevent cascading reload storms.
let reloadScheduled = false;

function scheduleRecoveryReload(source: string, error: unknown): void {
	if (reloadScheduled) return;
	reloadScheduled = true;
	console.error(`[rubato] Unhandled ${source}:`, error);
	console.warn("[rubato] Auto-reloading in 5 seconds...");
	setTimeout(() => location.reload(), 5000);
}

/** Check if an error originates from Vite/HMR internals. */
function isViteError(error: unknown): boolean {
	if (!error) return false;
	const msg = String(error);
	if (
		msg.includes("WebSocket") ||
		msg.includes("vite") ||
		msg.includes("HMR") ||
		msg.includes("hmr") ||
		msg.includes("reading 'send'")
	)
		return true;
	// Check error stack for Vite client scripts
	if (error instanceof Error && error.stack) {
		if (
			error.stack.includes("@vite/client") ||
			error.stack.includes("node_modules")
		)
			return true;
	}
	return false;
}

window.addEventListener("error", (event) => {
	const error = event.error ?? event.message;
	if (!error || isViteError(error)) return;
	scheduleRecoveryReload("error", error);
});

window.addEventListener("unhandledrejection", (event) => {
	// Ignore empty rejections (common from HMR/WebSocket failures)
	if (!event.reason) return;
	// Ignore Vite HMR / WebSocket connection failures
	if (isViteError(event.reason)) return;
	scheduleRecoveryReload("promise rejection", event.reason);
});

const PIECE_STATE_KEY = "rubato-piece-state";

/** Current app state — updated by startPiece/boot so requestState can resend. */
let appState: "lobby" | "running" = "lobby";

function startPiece(ws: WsClient, lobbyEl?: HTMLElement): void {
	if (lobbyEl) destroyLobby(lobbyEl);
	document.body.style.cursor = "none";
	localStorage.setItem(PIECE_STATE_KEY, "running");
	appState = "running";
	ws.sendState("running", {
		preset: getLastPreset(),
		guiVisible: isGuiVisible(),
		hudVisible,
	});
	void main(ws);
}

function boot(): void {
	// Mobile dev console + remote logging — only in dev mode
	if (import.meta.env.DEV) {
		void import("eruda").then((eruda) => eruda.default.init());

		// Forward console output to dev server for remote debugging
		for (const level of ["log", "warn", "error", "info"] as const) {
			const original = console[level];
			console[level] = (...args: unknown[]) => {
				original.apply(console, args);
				try {
					const payload = {
						level,
						args: args.map((a) =>
							typeof a === "object" ? JSON.stringify(a) : String(a),
						),
						timestamp: new Date().toISOString(),
						url: location.pathname,
					};
					void fetch("/api/console", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload),
					});
				} catch {
					// Never break the app for logging
				}
			};
		}

		// Capture uncaught errors and promise rejections (skip Vite HMR noise)
		const sendError = (source: string, err: unknown) => {
			if (isViteError(err)) return;
			try {
				const msg =
					err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
				void fetch("/api/console", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						level: "error",
						args: [`[uncaught ${source}] ${msg}`],
						timestamp: new Date().toISOString(),
						url: location.pathname,
					}),
				});
			} catch {
				// Never break the app for logging
			}
		};
		window.addEventListener("error", (e) =>
			sendError("error", e.error ?? e.message),
		);
		window.addEventListener("unhandledrejection", (e) =>
			sendError("rejection", e.reason),
		);
	}

	const ws = new WsClient("piece");

	// Resend current state + params when a new admin client connects
	ws.onRequestState(() => {
		ws.sendState(appState, {
			guiVisible: isGuiVisible(),
			hudVisible,
			preset: getLastPreset(),
		});
		if (appState === "running") {
			ws.sendParamState(serializeParams());
		}
	});

	// Auto-resume only on localhost (gallery kiosk). Hosted visitors always see the lobby.
	const isLocal =
		location.hostname === "localhost" || location.hostname === "127.0.0.1";
	const shouldResume =
		isLocal && localStorage.getItem(PIECE_STATE_KEY) === "running";

	if (shouldResume) {
		// Auto-resume: skip lobby, go straight to piece
		appState = "running";
		document.body.style.cursor = "none";
		ws.onConnectionChange((connected) => {
			if (connected)
				ws.sendState("running", {
					preset: getLastPreset(),
					guiVisible: isGuiVisible(),
					hudVisible,
				});
		});
		ws.onCommand((msg) => {
			switch (msg.command) {
				case "stop":
					localStorage.removeItem(PIECE_STATE_KEY);
					location.reload();
					break;
				case "reload":
					location.reload();
					break;
			}
		});
		void main(ws);
		return;
	}

	// Show lobby and wait for run command or tap
	const lobbyEl = showLobby();
	document.body.appendChild(lobbyEl);

	// Tap on hero section to start (not the about section below)
	const heroEl = lobbyEl.querySelector<HTMLElement>("[data-role='hero']");
	if (heroEl) {
		heroEl.addEventListener("click", () => startPiece(ws, lobbyEl));
	}

	ws.onConnectionChange((connected) => {
		if (connected) {
			ws.sendState("lobby");
			updateLobbyStatus(lobbyEl, "Ready");
		} else {
			updateLobbyStatus(lobbyEl, "Reconnecting...");
		}
	});

	ws.onCommand((msg) => {
		switch (msg.command) {
			case "run":
				startPiece(ws, lobbyEl);
				break;
			case "stop":
			case "reload":
				location.reload();
				break;
		}
	});
}

void boot();
