import { autoTuneTick } from "./autotune";
import { initCamera } from "./camera";
import { FpsCounter } from "./fps";
import { initGui } from "./gui";
import { params } from "./params";
import { computeCrop, drawFrame, initCanvas, resizeCanvas } from "./renderer";
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

async function main(): Promise<void> {
	const canvas = initCanvas();
	resizeCanvas(canvas);
	window.addEventListener("resize", () => resizeCanvas(canvas));

	// Dev GUI — toggle with G key
	if (import.meta.env.VITE_DEV_GUI === "true") {
		initGui();
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

	function loop(): void {
		if (!video || !ctx) return;
		const { width, height } = canvas;

		autoTuneTick();

		// Check if resolution changed via GUI (or auto-tuner)
		if (params.camera.resolution !== currentResolution) {
			changeResolution(params.camera.resolution);
		}

		// Draw camera feed
		drawFrame(ctx, video);

		// Overlay segmentation mask if ready
		if (segmentationReady && params.overlay.showOverlay) {
			// Frame skipping: only run segmentation every Nth frame
			const skip = Math.max(1, Math.round(params.segmentation.frameSkip));
			if (frameCount % skip === 0) {
				const mask = segmentFrame(video, performance.now());
				if (mask) lastMask = mask;
			}

			if (lastMask) {
				const { width: maskW, height: maskH } = getSegmenterResolution(video);
				drawMaskOverlay(ctx, lastMask, maskW, maskH, width, height);
			}
		}

		frameCount++;
		fps.draw(ctx);
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);
}

/**
 * Draw the segmentation mask as a semi-transparent colored overlay.
 * Applies the same crop as the camera feed so the mask aligns pixel-for-pixel.
 */
function drawMaskOverlay(
	ctx: CanvasRenderingContext2D,
	mask: Float32Array,
	maskW: number,
	maskH: number,
	displayW: number,
	displayH: number,
): void {
	const imageData = ctx.createImageData(maskW, maskH);
	const data = imageData.data;

	for (let i = 0; i < mask.length; i++) {
		const confidence = mask[i];
		const idx = i * 4;
		// Tint person pixels cyan
		data[idx] = 0; // R
		data[idx + 1] = 255; // G
		data[idx + 2] = 255; // B
		data[idx + 3] = Math.floor(confidence * 255 * params.overlay.opacity);
	}

	// Draw mask to offscreen canvas at camera resolution
	const offscreen = new OffscreenCanvas(maskW, maskH);
	const offCtx = offscreen.getContext("2d")!;
	offCtx.putImageData(imageData, 0, 0);

	// Apply the same crop as the camera feed, then mirror
	const crop = computeCrop(maskW, maskH, displayW, displayH);
	ctx.save();
	ctx.translate(displayW, 0);
	ctx.scale(-1, 1);
	ctx.drawImage(
		offscreen,
		crop.sx,
		crop.sy,
		crop.sw,
		crop.sh,
		0,
		0,
		displayW,
		displayH,
	);
	ctx.restore();
}

main();
