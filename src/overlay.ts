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

	// Precompute opacity factor to avoid per-pixel multiply
	const opacityFactor = 255 * opacity;

	// Fast path for "solid" mode — most common, avoids all branching
	if (mode === "solid") {
		for (let ry = 0; ry < renderH; ry++) {
			const srcRow = ry * ds * maskW;
			const dstRow = ry * renderW;
			for (let rx = 0; rx < renderW; rx++) {
				const c = mask[srcRow + rx * ds]!;
				if (c === 0) continue;
				const idx = (dstRow + rx) << 2;
				data[idx] = sr;
				data[idx + 1] = sg;
				data[idx + 2] = sb;
				data[idx + 3] = (c * opacityFactor) | 0;
			}
		}
	} else if (mode === "invert") {
		for (let ry = 0; ry < renderH; ry++) {
			const srcRow = ry * ds * maskW;
			const dstRow = ry * renderW;
			for (let rx = 0; rx < renderW; rx++) {
				const c = mask[srcRow + rx * ds]!;
				if (c === 0) continue;
				const idx = (dstRow + rx) << 2;
				data[idx] = 255;
				data[idx + 1] = 255;
				data[idx + 2] = 255;
				data[idx + 3] = (c * opacityFactor) | 0;
			}
		}
	} else if (mode === "contour") {
		for (let ry = 0; ry < renderH; ry++) {
			const srcRow = ry * ds * maskW;
			const dstRow = ry * renderW;
			for (let rx = 0; rx < renderW; rx++) {
				const x = rx * ds;
				const y = ry * ds;
				const i = srcRow + x;
				const c = mask[i]!;
				const right = x < maskW - 1 ? mask[i + 1]! : c;
				const below = y < maskH - 1 ? mask[i + maskW]! : c;
				const dr = c - right;
				const db = c - below;
				const edge = (dr > 0 ? dr : -dr) + (db > 0 ? db : -db);
				if (edge < 0.05) continue;
				const idx = (dstRow + rx) << 2;
				data[idx] = sr;
				data[idx + 1] = sg;
				data[idx + 2] = sb;
				const ea = edge * 5;
				data[idx + 3] = ((ea > 1 ? 1 : ea) * opacityFactor) | 0;
			}
		}
	} else {
		// Rainbow, gradient, aura — per-pixel color computation
		for (let ry = 0; ry < renderH; ry++) {
			for (let rx = 0; rx < renderW; rx++) {
				const x = rx * ds;
				const y = ry * ds;
				const confidence = mask[y * maskW + x]!;
				const idx = (ry * renderW + rx) << 2;

				if (mode === "aura") {
					if (confidence <= 0) continue;
					const pulse = 0.7 + 0.3 * Math.sin(rainbowHue * 0.05 + y * 0.02);
					const [r, g, b] = hslToRgb(
						(rainbowHue + y * 0.3) % 360,
						0.8,
						0.3 + 0.3 * pulse,
					);
					data[idx] = r;
					data[idx + 1] = g;
					data[idx + 2] = b;
					data[idx + 3] = (confidence * 200 * opacity * pulse) | 0;
					continue;
				}

				if (confidence === 0) continue;

				if (mode === "rainbow") {
					const [r, g, b] = hslToRgb(
						(rainbowHue + x * 0.5 + y * 0.3) % 360,
						1,
						0.5,
					);
					data[idx] = r;
					data[idx + 1] = g;
					data[idx + 2] = b;
				} else if (mode === "gradient") {
					const [r, g, b] = hslToRgb(
						(rainbowHue + (y / maskH) * 180) % 360,
						0.8,
						0.5,
					);
					data[idx] = r;
					data[idx + 1] = g;
					data[idx + 2] = b;
				}
				data[idx + 3] = (confidence * opacityFactor) | 0;
			}
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
							rSum += src[si]!;
							gSum += src[si + 1]!;
							bSum += src[si + 2]!;
							aSum += src[si + 3]!;
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

	// Compute crop in downsampled space (divide by ds).
	// Floor sx/sy and ceil sw/sh so the source rect is pixel-aligned and fully
	// covers the visible region.  Clamp to the OffscreenCanvas bounds so a
	// downsample change never produces an out-of-range or fractional source rect
	// (which would cause a visible position jump on the transition frame).
	const crop = computeCrop(maskW, maskH, displayW, displayH);
	const rawSx = crop.sx / ds;
	const rawSy = crop.sy / ds;
	const rawSw = crop.sw / ds;
	const rawSh = crop.sh / ds;
	const dsCrop = {
		sx: Math.max(0, Math.floor(rawSx)),
		sy: Math.max(0, Math.floor(rawSy)),
		sw: Math.min(renderW - Math.max(0, Math.floor(rawSx)), Math.ceil(rawSw)),
		sh: Math.min(renderH - Math.max(0, Math.floor(rawSy)), Math.ceil(rawSh)),
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
