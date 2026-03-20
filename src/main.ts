import { autoTuneTick } from "./autotune";
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
import { drawFrame, initCanvas, resizeCanvas } from "./renderer";
import {
	getSegmenterResolution,
	initSegmentation,
	segmentFrame,
} from "./segmentation";

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
	// Unified WebGL compositor (opt-in)
	const compositorCanvas = initCompositor();
	if (compositorCanvas) {
		compositorCanvas.style.display =
			params.rendering.pipeline === "unified" ? "block" : "none";
		document.body.appendChild(compositorCanvas);
		resizeCompositor();
	}

	// Fog field — uses compositor's GL context when unified, own canvas when legacy
	const compositorGl = getCompositorGl();
	const fogCanvas = compositorGl ? initFog(compositorGl) : initFog();
	if (!compositorGl) {
		// Legacy mode: fog has its own canvas behind everything
		document.body.appendChild(fogCanvas);
	}
	resizeFog();

	// Legacy 2D canvas (default)
	const canvas = initCanvas();
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

	try {
		video = await initCamera(params.camera.resolution);
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
	initSegmentation()
		.then(() => {
			segmentationReady = true;
			console.log("segmentation ready");
		})
		.catch((err) => {
			console.error("Segmentation failed to load:", err);
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
					const { width: mw, height: mh } = getSegmenterResolution(video);
					const motionResult = detectMotion(result.raw, mw, mh);
					lastMotion = motionResult.motion;
					lastTrail = motionResult.trail;
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

		// Render fog field (behind everything via separate WebGL canvas)
		drawFog();

		// Clear the 2D canvas — transparent so fog shows through when feed is off
		ctx.clearRect(0, 0, width, height);

		// Draw camera feed if enabled
		if (params.camera.showFeed) {
			drawFrame(ctx, video);
		}

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

		fps.draw(ctx);
	}

	function loop(): void {
		if (!video || !ctx) return;

		autoTuneTick();

		// Check if resolution changed via GUI (or auto-tuner)
		if (params.camera.resolution !== currentResolution) {
			changeResolution(params.camera.resolution);
		}

		const data = produceFrameData();

		if (params.rendering.pipeline === "unified" && compositorCanvas) {
			// Unified WebGL path: compositor blends fog + camera + mask + trail
			compositorCanvas.style.display = "block";
			canvas.style.display = "none";
			fogCanvas.style.display = "none";

			const fogTex = renderFogToTexture();
			const { width: maskW, height: maskH } = video.videoWidth
				? getSegmenterResolution(video)
				: { width: 0, height: 0 };
			compositeFrame(video, fogTex, data.mask, data.trail, maskW, maskH);

			// FPS draws on a separate overlay (TODO: move to DOM element)
			// For now, draw on the legacy canvas which is hidden
		} else {
			// Legacy Canvas 2D path
			if (compositorCanvas) compositorCanvas.style.display = "none";
			canvas.style.display = "block";
			fogCanvas.style.display = "block";

			renderFrame(ctx, video, canvas, data, fps);
		}

		frameCount++;
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);
}

main();
