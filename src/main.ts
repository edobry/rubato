import {
	autoTuneState,
	autoTuneTick,
	onLogChange,
	resetAutoTuneFrames,
} from "./autotune";
import { initCamera } from "./camera";
import {
	compositeFrame,
	getCompositorGl,
	initCompositor,
	resizeCompositor,
} from "./compositor";
import { computeDisplayBounds } from "./coords";
import { detectDevice } from "./device";
import {
	drawFog,
	initFog,
	renderFogToTexture,
	resizeFog,
	setFogCrop,
} from "./fog";
import { FpsCounter } from "./fps";
import { initGui } from "./gui";
import { destroyLobby, showLobby, updateLobbyStatus } from "./lobby.js";
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
import {
	createSegmentationPipeline,
	resolveModelConfig,
} from "./segmentation-state";
import { showStatus } from "./status";
import { WsClient } from "./ws/client.js";

// Exposed so GUI can trigger camera re-acquisition
let video: HTMLVideoElement | null = null;
let currentResolution = params.camera.resolution;
let resolutionChanging = false;

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

async function main(): Promise<void> {
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

	// Dev GUI — toggle with G key (loads presets which may override params)
	if (import.meta.env.VITE_DEV_GUI === "true") {
		await initGui();
	}

	// Enforce performance floors AFTER presets load (presets are creative-only
	// but older presets may have included perf params before we split them)
	if (device.isConstrained) {
		if (params.overlay.downsample < 2) params.overlay.downsample = 2;
	}

	const fps = new FpsCounter();

	showStatus("Initializing camera...");
	try {
		video = await initCamera(params.camera.resolution);
		showStatus("Camera ready");
	} catch (err) {
		console.error("Camera unavailable:", err);
		// Compositor will show fog-only mode; drawFog() is the fallback
		drawFog();
		return;
	}

	// Initialize segmentation pipeline (tries worker, falls back to sync)
	const pipeline = createSegmentationPipeline();
	showStatus("Loading segmentation model...");
	const { modelUrl, delegate } = resolveModelConfig();
	await pipeline.init(modelUrl, delegate);

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
			console.log(`[rubato] cleared cached mask data (${key} changed)`);
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
			params.fog.trailInteraction > 0;
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
		} else {
			setFogCrop([0, 0], [0, 0]);
		}

		// Unified WebGL path: compositor blends fog + camera + mask + trail
		const fogTex = renderFogToTexture();
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
			fps.draw(hudCtx);
			drawPerfOverlay(hudCtx);
		}

		frameCount++;
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);

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

function boot(): void {
	const lobbyEl = showLobby();
	document.body.appendChild(lobbyEl);

	const ws = new WsClient("piece");

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
				destroyLobby(lobbyEl);
				ws.sendState("running");
				void main();
				break;
			case "stop":
			case "reload":
				location.reload();
				break;
		}
	});
}

void boot();
