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
let cachedBlurBuf: Uint8ClampedArray | null = null;
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
	// Half-res mode: process every other pixel in both dimensions (4x fewer pixels)
	const ds = params.overlay.downsample;
	const renderW = Math.ceil(maskW / ds);
	const renderH = Math.ceil(maskH / ds);

	// Reuse allocations across frames to avoid GC pressure
	if (cachedW !== renderW || cachedH !== renderH) {
		cachedImageData = ctx.createImageData(renderW, renderH);
		cachedOffscreen = new OffscreenCanvas(renderW, renderH);
		cachedOffCtx = cachedOffscreen.getContext("2d")!;
		cachedBlurBuf = new Uint8ClampedArray(renderW * renderH * 4);
		cachedW = renderW;
		cachedH = renderH;
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

	for (let ry = 0; ry < renderH; ry++) {
		for (let rx = 0; rx < renderW; rx++) {
			// Map back to full-res mask coordinates
			const x = rx * ds;
			const y = ry * ds;
			const i = y * maskW + x;
			const confidence = mask[i] ?? 0;
			const outIdx = (ry * renderW + rx) * 4;
			const idx = outIdx;

			if (mode === "contour") {
				// Edge detection: show only where mask changes sharply
				const right = x < maskW - 1 ? mask[i + 1] : confidence;
				const below = y < maskH - 1 ? mask[i + maskW] : confidence;
				const edge =
					Math.abs(confidence - right) + Math.abs(confidence - below);
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
	}

	// Apply box blur passes to smooth jagged mask edges
	const blurPasses = params.overlay.blur;
	if (blurPasses > 0) {
		const src = data;
		const tmp = cachedBlurBuf!;
		for (let pass = 0; pass < blurPasses; pass++) {
			for (let y = 0; y < renderH; y++) {
				for (let x = 0; x < renderW; x++) {
					let rSum = 0;
					let gSum = 0;
					let bSum = 0;
					let aSum = 0;
					let count = 0;
					for (let dy = -1; dy <= 1; dy++) {
						const ny = y + dy;
						if (ny < 0 || ny >= renderH) continue;
						for (let dx = -1; dx <= 1; dx++) {
							const nx = x + dx;
							if (nx < 0 || nx >= renderW) continue;
							const si = (ny * renderW + nx) * 4;
							rSum += src[si];
							gSum += src[si + 1];
							bSum += src[si + 2];
							aSum += src[si + 3];
							count++;
						}
					}
					const di = (y * renderW + x) * 4;
					tmp[di] = (rSum / count + 0.5) | 0;
					tmp[di + 1] = (gSum / count + 0.5) | 0;
					tmp[di + 2] = (bSum / count + 0.5) | 0;
					tmp[di + 3] = (aSum / count + 0.5) | 0;
				}
			}
			// Copy temp buffer back to source for next pass
			src.set(tmp);
		}
	}

	cachedOffCtx!.putImageData(imageData, 0, 0);

	// Compute crop in downsampled space (divide by ds)
	const crop = computeCrop(maskW, maskH, displayW, displayH);
	const dsCrop = {
		sx: crop.sx / ds,
		sy: crop.sy / ds,
		sw: crop.sw / ds,
		sh: crop.sh / ds,
	};
	ctx.save();
	if (mode === "invert") {
		ctx.globalCompositeOperation = "difference";
	}
	ctx.translate(displayW, 0);
	ctx.scale(-1, 1);
	ctx.drawImage(
		cachedOffscreen!,
		dsCrop.sx,
		dsCrop.sy,
		dsCrop.sw,
		dsCrop.sh,
		0,
		0,
		displayW,
		displayH,
	);
	ctx.restore();
}
