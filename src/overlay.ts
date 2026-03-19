/**
 * Overlay rendering.
 * Draws segmentation masks as semi-transparent colored overlays on the 2D canvas.
 */

import { params } from "./params";
import { computeCrop } from "./renderer";

// Cached per-frame allocations to avoid GC pressure on constrained hardware
let cachedImageData: ImageData | null = null;
let cachedOffscreen: OffscreenCanvas | null = null;
let cachedOffCtx: OffscreenCanvasRenderingContext2D | null = null;
let cachedW = 0;
let cachedH = 0;

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
export function drawMaskOverlay(
	ctx: CanvasRenderingContext2D,
	mask: Float32Array,
	maskW: number,
	maskH: number,
	displayW: number,
	displayH: number,
): void {
	// Reuse allocations across frames to avoid GC pressure
	if (cachedW !== maskW || cachedH !== maskH) {
		cachedImageData = ctx.createImageData(maskW, maskH);
		cachedOffscreen = new OffscreenCanvas(maskW, maskH);
		cachedOffCtx = cachedOffscreen.getContext("2d")!;
		cachedW = maskW;
		cachedH = maskH;
	}
	const imageData = cachedImageData!;
	const data = imageData.data;
	// Clear previous frame's data
	data.fill(0);
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

	cachedOffCtx!.putImageData(imageData, 0, 0);

	const crop = computeCrop(maskW, maskH, displayW, displayH);
	ctx.save();
	if (mode === "invert") {
		ctx.globalCompositeOperation = "difference";
	}
	ctx.translate(displayW, 0);
	ctx.scale(-1, 1);
	ctx.drawImage(
		cachedOffscreen!,
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
