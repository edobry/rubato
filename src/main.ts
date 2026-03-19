import { autoTuneTick } from "./autotune";
import { initCamera } from "./camera";
import { FpsCounter } from "./fps";
import { initGui } from "./gui";
import { detectMotion } from "./motion";
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
	let lastMotion: Float32Array | null = null;
	let lastTrail: Float32Array | null = null;

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

		// Run segmentation + motion detection
		if (segmentationReady && params.overlay.showOverlay) {
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

			const { width: maskW, height: maskH } = getSegmenterResolution(video);
			const viz = params.overlay.visualize;

			if ((viz === "mask" || viz === "both") && lastMask) {
				drawMaskOverlay(ctx, lastMask, maskW, maskH, width, height);
			}
			if (viz === "motion" && lastMotion) {
				drawMaskOverlay(ctx, lastMotion, maskW, maskH, width, height);
			}
			if ((viz === "trail" || viz === "both") && lastTrail) {
				drawMaskOverlay(ctx, lastTrail, maskW, maskH, width, height);
			}
		}

		frameCount++;
		fps.draw(ctx);
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);
}

/** Parse hex color string to RGB. */
function hexToRgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** HSL to RGB (h: 0–360, s/l: 0–1) → [0–255, 0–255, 0–255] */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) {
		r = c;
		g = x;
	} else if (h < 120) {
		r = x;
		g = c;
	} else if (h < 180) {
		g = c;
		b = x;
	} else if (h < 240) {
		g = x;
		b = c;
	} else if (h < 300) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	return [
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255),
	];
}

let rainbowHue = 0;

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
	const mode = params.overlay.colorMode;
	const opacity = params.overlay.opacity;

	// Precompute solid color
	const [sr, sg, sb] = hexToRgb(params.overlay.color);

	// Advance rainbow
	rainbowHue = (rainbowHue + 0.5) % 360;

	for (let i = 0; i < mask.length; i++) {
		const confidence = mask[i];
		const idx = i * 4;
		const x = i % maskW;
		const y = Math.floor(i / maskW);

		if (mode === "contour") {
			// Edge detection: show only where mask changes sharply
			const right = x < maskW - 1 ? mask[i + 1] : confidence;
			const below = y < maskH - 1 ? mask[i + maskW] : confidence;
			const edge = Math.abs(confidence - right) + Math.abs(confidence - below);
			if (edge < 0.05) continue;
			data[idx] = sr;
			data[idx + 1] = sg;
			data[idx + 2] = sb;
			data[idx + 3] = Math.floor(Math.min(edge * 5, 1) * 255 * opacity);
			continue;
		}

		if (mode === "aura") {
			// Radiating glow — render even outside the mask, based on distance-like falloff
			// Use confidence directly as a soft distance proxy
			const glow = confidence > 0 ? confidence : 0;
			if (glow === 0) continue;
			// Pulsing brightness
			const pulse = 0.7 + 0.3 * Math.sin(rainbowHue * 0.05 + y * 0.02);
			const [r, g, b] = hslToRgb(
				(rainbowHue + y * 0.3) % 360,
				0.8,
				0.3 + 0.3 * pulse,
			);
			data[idx] = r;
			data[idx + 1] = g;
			data[idx + 2] = b;
			data[idx + 3] = Math.floor(glow * 200 * opacity * pulse);
			continue;
		}

		if (confidence === 0) continue;
		const alpha = Math.floor(confidence * 255 * opacity);

		if (mode === "solid") {
			data[idx] = sr;
			data[idx + 1] = sg;
			data[idx + 2] = sb;
		} else if (mode === "rainbow") {
			const hue = (rainbowHue + x * 0.5 + y * 0.3) % 360;
			const [r, g, b] = hslToRgb(hue, 1, 0.5);
			data[idx] = r;
			data[idx + 1] = g;
			data[idx + 2] = b;
		} else if (mode === "gradient") {
			const normY = y / maskH;
			const compHue = (rainbowHue + normY * 180) % 360;
			const [r, g, b] = hslToRgb(compHue, 0.8, 0.5);
			data[idx] = r;
			data[idx + 1] = g;
			data[idx + 2] = b;
		} else if (mode === "invert") {
			// Will be composited as an inversion layer
			data[idx] = 255;
			data[idx + 1] = 255;
			data[idx + 2] = 255;
		}
		data[idx + 3] = alpha;
	}

	const offscreen = new OffscreenCanvas(maskW, maskH);
	const offCtx = offscreen.getContext("2d")!;
	offCtx.putImageData(imageData, 0, 0);

	const crop = computeCrop(maskW, maskH, displayW, displayH);
	ctx.save();
	if (mode === "invert") {
		ctx.globalCompositeOperation = "difference";
	}
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
