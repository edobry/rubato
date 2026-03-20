import { autoTuneTick, onLogChange } from "./autotune";
import { initCamera } from "./camera";
import {
	compositeFrame,
	getCompositorGl,
	initCompositor,
	resizeCompositor,
} from "./compositor";
import { detectDevice } from "./device";
import { drawFog, initFog, renderFogToTexture, resizeFog } from "./fog";
import { FpsCounter } from "./fps";
import { initGui } from "./gui";
import { detectMotion, resetMotion } from "./motion";
import { drawMaskOverlay } from "./overlay";
import { onParamChange, params, SEGMENTATION_MODELS } from "./params";
import {
	drawPerfOverlay,
	perfFrameEnd,
	perfFrameStart,
	perfMark,
} from "./perf";
import { drawFrame, initCanvas, resizeCanvas } from "./renderer";
import {
	createSegmentationPipeline,
	resolveModelConfig,
} from "./segmentation-state";
import { showStatus } from "./status";

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
		params.rendering.pipeline = "legacy";
		localStorage.setItem("rubato-device-configured", "true");
		localStorage.setItem("rubato-pipeline", "legacy");
		showStatus(
			`${device.platform} detected — optimized defaults applied`,
			3000,
		);
	}

	// Pipeline mode is set at page load. Switching requires reload.
	// Falls back to legacy if compositor init fails (e.g. weak GPU).
	let useUnified = params.rendering.pipeline === "unified";
	let compositorCanvas: HTMLCanvasElement | null = null;
	if (useUnified) {
		compositorCanvas = initCompositor();
		if (compositorCanvas) {
			document.body.appendChild(compositorCanvas);
			resizeCompositor();
		} else {
			console.warn("Compositor init failed, falling back to legacy pipeline");
			useUnified = false;
			localStorage.setItem("rubato-pipeline", "legacy");
		}
	}

	// Fog field — shares compositor GL in unified mode, own canvas in legacy
	const compositorGl = useUnified ? getCompositorGl() : null;
	const fogCanvas = compositorGl ? initFog(compositorGl) : initFog();
	if (!compositorGl) {
		document.body.appendChild(fogCanvas);
	}
	resizeFog();

	// HUD canvas — transparent overlay for FPS graph, perf, tuning indicator.
	// Visible in both modes, always on top.
	let hudCanvas: HTMLCanvasElement | null = null;
	let hudCtx: CanvasRenderingContext2D | null = null;
	if (useUnified) {
		hudCanvas = document.createElement("canvas");
		hudCanvas.style.cssText =
			"position:fixed;inset:0;width:100%;height:100%;z-index:9999;pointer-events:none";
		document.body.appendChild(hudCanvas);
		hudCtx = hudCanvas.getContext("2d");
	}

	// Legacy 2D canvas — hidden in unified mode
	const canvas = initCanvas();
	if (useUnified) canvas.style.display = "none";
	resizeCanvas(canvas);
	window.addEventListener("resize", () => {
		resizeCanvas(canvas);
		resizeFog();
		if (compositorCanvas) resizeCompositor();
		if (hudCanvas) {
			hudCanvas.width = window.innerWidth;
			hudCanvas.height = window.innerHeight;
		}
	});
	if (hudCanvas) {
		hudCanvas.width = window.innerWidth;
		hudCanvas.height = window.innerHeight;
	}

	// Dev GUI — toggle with G key (loads presets which may override params)
	if (import.meta.env.VITE_DEV_GUI === "true") {
		await initGui();
	}

	// Enforce performance floors AFTER presets load (presets are creative-only
	// but older presets may have included perf params before we split them)
	if (device.isConstrained) {
		if (params.overlay.downsample < 2) params.overlay.downsample = 2;
	}

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		console.error("Failed to get 2D context");
		return;
	}

	const fps = new FpsCounter();

	showStatus("Initializing camera...");
	try {
		video = await initCamera(params.camera.resolution);
		showStatus("Camera ready");
	} catch (err) {
		console.error("Camera unavailable:", err);
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "#333";
		ctx.font = "16px monospace";
		ctx.textAlign = "center";
		ctx.fillText("camera unavailable", canvas.width / 2, canvas.height / 2);
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
			(useUnified &&
				(params.fog.maskInteraction > 0 || params.fog.trailInteraction > 0));
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
				if (params.overlay.visualize !== "mask") {
					const motionResult = detectMotion(
						result.mask,
						result.width,
						result.height,
					);
					motion = motionResult.motion;
					trail = motionResult.trail;
				}
				currentFrame = {
					mask: result.mask,
					motion,
					trail,
					maskW: result.width,
					maskH: result.height,
					generation: currentFrame.generation + 1,
				};
			}
		}

		return currentFrame;
	}

	function renderFrame(
		ctx: CanvasRenderingContext2D,
		video: HTMLVideoElement,
		canvas: HTMLCanvasElement,
		data: FrameState,
		fps: FpsCounter,
	): void {
		const { width, height } = canvas;

		// Render fog field
		drawFog();
		perfMark("fog", "#4488ff");

		// Clear the 2D canvas
		ctx.clearRect(0, 0, width, height);

		// Draw camera feed if enabled
		if (params.camera.showFeed) {
			drawFrame(ctx, video);
		}
		perfMark("camera", "#44ff44");

		// Draw overlays
		const pipelineState = pipeline.getState();
		const isReady =
			pipelineState.status === "ready" || pipelineState.status === "processing";

		if (isReady && params.overlay.showOverlay) {
			const { maskW, maskH } = data;
			const viz = params.overlay.visualize;

			if ((viz === "mask" || viz === "both") && data.mask) {
				drawMaskOverlay(ctx, data.mask, maskW, maskH, width, height);
			}
			if (viz === "motion" && data.motion) {
				drawMaskOverlay(ctx, data.motion, maskW, maskH, width, height);
			}
			if ((viz === "trail" || viz === "both") && data.trail) {
				drawMaskOverlay(ctx, data.trail, maskW, maskH, width, height);
			}
		}
		perfMark("overlay", "#ff8844");

		fps.draw(ctx);
		drawPerfOverlay(ctx);
	}

	function loop(): void {
		if (!video || !ctx) return;

		perfFrameStart();
		autoTuneTick();

		// Check if resolution changed via GUI (or auto-tuner)
		if (params.camera.resolution !== currentResolution) {
			void changeResolution(params.camera.resolution);
		}

		const data = produceFrameData();
		perfMark("segmentation", "#ff4444");

		if (useUnified && compositorCanvas) {
			// Unified WebGL path: compositor blends fog + camera + mask + trail
			const fogTex = renderFogToTexture();
			// Select which data to pass based on the visualize dropdown,
			// mirroring the legacy path's per-mode overlay logic.
			const viz = params.overlay.visualize;
			let compMask: Float32Array | null = null;
			let compTrail: Float32Array | null = null;
			switch (viz) {
				case "mask":
					compMask = data.mask;
					break;
				case "motion":
					compMask = data.motion;
					break;
				case "trail":
					compTrail = data.trail;
					break;
				case "both":
					compMask = data.mask;
					compTrail = data.trail;
					break;
			}
			compositeFrame(
				video,
				fogTex,
				compMask,
				compTrail,
				data.maskW,
				data.maskH,
			);

			perfMark("composite", "#ff8844");
			perfFrameEnd();

			// Draw FPS graph + perf overlay on the HUD canvas
			if (hudCtx && hudCanvas) {
				hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
				fps.draw(hudCtx);
				drawPerfOverlay(hudCtx);
			}
		} else {
			// Legacy Canvas 2D path
			renderFrame(ctx, video, canvas, data, fps);
			perfFrameEnd();
		}

		frameCount++;
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);
}

void main();
