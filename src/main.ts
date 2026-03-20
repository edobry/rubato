import { autoTuneTick, onLogChange } from "./autotune";
import { initCamera } from "./camera";
import {
	compositeFrame,
	getCompositorGl,
	initCompositor,
	resizeCompositor,
} from "./compositor";
import { drawFog, initFog, renderFogToTexture, resizeFog } from "./fog";
import { FpsCounter } from "./fps";
import { initGui } from "./gui";
import { detectMotion } from "./motion";
import { drawMaskOverlay } from "./overlay";
import { params } from "./params";
import {
	drawPerfOverlay,
	getPerfSummary,
	perfFrameEnd,
	perfFrameStart,
	perfMark,
} from "./perf";
import { drawFrame, initCanvas, resizeCanvas } from "./renderer";
import {
	getSegmenterResolution,
	initSegmentation,
	segmentFrame,
} from "./segmentation";
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

interface FrameData {
	mask: Float32Array | null;
	motion: Float32Array | null;
	trail: Float32Array | null;
}

async function main(): Promise<void> {
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

	// Legacy 2D canvas (default)
	// DOM FPS overlay for unified mode
	let fpsOverlay: HTMLDivElement | null = null;
	if (useUnified) {
		fpsOverlay = document.createElement("div");
		fpsOverlay.style.cssText =
			"position:fixed;top:8px;left:8px;z-index:10000;font:bold 16px monospace;color:#0f0;background:rgba(0,0,0,0.6);padding:4px 10px;pointer-events:none";
		document.body.appendChild(fpsOverlay);
	}

	// Legacy 2D canvas — hidden in unified mode
	const canvas = initCanvas();
	if (useUnified) canvas.style.display = "none";
	resizeCanvas(canvas);
	window.addEventListener("resize", () => {
		resizeCanvas(canvas);
		resizeFog();
		if (compositorCanvas) resizeCompositor();
	});

	// Dev GUI — toggle with G key
	if (import.meta.env.VITE_DEV_GUI === "true") {
		await initGui();
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

	// Initialize segmentation — non-blocking, render loop starts immediately
	let segmentationReady = false;
	showStatus("Loading segmentation model...");
	initSegmentation()
		.then(() => {
			segmentationReady = true;
			console.log("segmentation ready");
			showStatus("Segmentation ready — stand in front of camera", 3000);
		})
		.catch((err) => {
			console.error("Segmentation failed to load:", err);
			showStatus("Segmentation failed to load", 5000);
		});

	// Show autotune actions as brief status notifications
	onLogChange((log) => {
		if (log.length > 0) {
			const latest = log[log.length - 1];
			// Strip the timestamp prefix (e.g. "12:34:56 PM ...")
			const msg = latest.replace(/^\S+\s+(AM|PM)?\s*/, "");
			showStatus(`autotune: ${msg}`, 3000);
		}
	});

	let frameCount = 0;
	let lastMask: Float32Array | null = null;
	let lastMotion: Float32Array | null = null;
	let lastTrail: Float32Array | null = null;

	function produceFrameData(): FrameData {
		if (video && segmentationReady && params.overlay.showOverlay) {
			const skip = Math.max(1, Math.round(params.segmentation.frameSkip));
			if (frameCount % skip === 0) {
				const result = segmentFrame(video, performance.now());
				if (result) {
					lastMask = result.smoothed;

					// Skip motion detection when visualizing mask only —
					// trails and motion data are not used in that mode.
					if (params.overlay.visualize !== "mask") {
						const { width: mw, height: mh } = getSegmenterResolution(video);
						const motionResult = detectMotion(result.raw, mw, mh);
						lastMotion = motionResult.motion;
						lastTrail = motionResult.trail;
					}
				}
			}
		}

		return { mask: lastMask, motion: lastMotion, trail: lastTrail };
	}

	function renderFrame(
		ctx: CanvasRenderingContext2D,
		video: HTMLVideoElement,
		canvas: HTMLCanvasElement,
		data: FrameData,
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
		if (segmentationReady && params.overlay.showOverlay) {
			const { width: maskW, height: maskH } = getSegmenterResolution(video);
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
			changeResolution(params.camera.resolution);
		}

		const data = produceFrameData();
		perfMark("segmentation", "#ff4444");

		if (useUnified && compositorCanvas) {
			// Unified WebGL path: compositor blends fog + camera + mask + trail
			const fogTex = renderFogToTexture();
			const { width: maskW, height: maskH } = video.videoWidth
				? getSegmenterResolution(video)
				: { width: 0, height: 0 };
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
			compositeFrame(video, fogTex, compMask, compTrail, maskW, maskH);

			perfMark("composite", "#ff8844");
			perfFrameEnd();

			// DOM FPS overlay with perf breakdown
			const fpsVal = fps.tick();
			if (fpsOverlay) {
				fpsOverlay.textContent = `${fpsVal} fps | ${getPerfSummary()}`;
				fpsOverlay.style.color =
					fpsVal >= 24 ? "#0f0" : fpsVal >= 15 ? "#ff0" : "#f00";
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

main();
