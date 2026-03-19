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

	let video: HTMLVideoElement;
	try {
		video = await initCamera();
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

	function loop(): void {
		const { width, height } = canvas;

		// Draw camera feed
		drawFrame(ctx!, video);

		// Overlay segmentation mask if ready
		if (segmentationReady && params.overlay.showOverlay) {
			const mask = segmentFrame(video, performance.now());
			if (mask) {
				const { width: maskW, height: maskH } = getSegmenterResolution(video);
				drawMaskOverlay(ctx!, mask, maskW, maskH, width, height);
			}
		}

		fps.draw(ctx!);
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
