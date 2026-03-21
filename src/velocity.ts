/**
 * Directional velocity extraction via grid-based centroid tracking.
 *
 * Divides the segmentation mask into a grid, computes the center-of-mass
 * of mask pixels in each cell, and tracks how those centroids shift between
 * frames. The result is a small RGBA8 velocity texture where R/G encode
 * horizontal/vertical velocity (0.5-centered) and B encodes magnitude.
 */

import { params } from "./params";
import { createTexture } from "./webgl-utils";

// --- Module-level state ---

let gl: WebGLRenderingContext | null = null;
let velocityTexture: WebGLTexture | null = null;

/** Centroids from the previous frame: [cx0, cy0, cx1, cy1, ...] in pixel coords.
 *  NaN indicates an empty cell (no mask pixels). */
let prevCentroids: Float32Array | null = null;
let prevGridSize = 0;
let prevMaskW = 0;
let prevMaskH = 0;

/** Reusable upload buffer — reallocated when grid size changes. */
let uploadBuf: Uint8Array | null = null;
let uploadGridSize = 0;

/**
 * Initialize the velocity module on a shared WebGL context.
 * Call once during startup.
 */
export function initVelocity(sharedGl: WebGLRenderingContext): void {
	gl = sharedGl;
	velocityTexture = createTexture(gl);
}

/**
 * Compute the velocity field from the current segmentation mask.
 * Returns the velocity texture (RGBA8, grid×grid), or null if not initialized.
 *
 * @param currentMask - Segmentation mask, values 0–1
 * @param w - Mask width in pixels
 * @param h - Mask height in pixels
 */
export function computeVelocityField(
	currentMask: Float32Array,
	w: number,
	h: number,
): WebGLTexture | null {
	if (!gl || !velocityTexture) return null;

	const gridSize = params.shadow.velocityGrid as number;
	if (gridSize <= 0) return null;

	const cellCount = gridSize * gridSize;
	const cellW = w / gridSize;
	const cellH = h / gridSize;

	// --- Compute centroids for current frame ---

	// Accumulators: weightedX, weightedY, totalWeight per cell
	const wx = new Float64Array(cellCount);
	const wy = new Float64Array(cellCount);
	const wt = new Float64Array(cellCount);

	for (let py = 0; py < h; py++) {
		const cellRow = Math.min(Math.floor(py / cellH), gridSize - 1);
		const rowOff = py * w;
		for (let px = 0; px < w; px++) {
			const val = currentMask[rowOff + px]!;
			if (val < 0.01) continue;
			const cellCol = Math.min(Math.floor(px / cellW), gridSize - 1);
			const ci = cellRow * gridSize + cellCol;
			wx[ci] = wx[ci]! + px * val;
			wy[ci] = wy[ci]! + py * val;
			wt[ci] = wt[ci]! + val;
		}
	}

	// Build centroid array: pairs of (cx, cy) in pixel coords; NaN for empty cells
	const centroids = new Float32Array(cellCount * 2);
	for (let i = 0; i < cellCount; i++) {
		if (wt[i]! > 0) {
			centroids[i * 2] = (wx[i]! / wt[i]!) as number;
			centroids[i * 2 + 1] = (wy[i]! / wt[i]!) as number;
		} else {
			centroids[i * 2] = Number.NaN;
			centroids[i * 2 + 1] = Number.NaN;
		}
	}

	// --- Compute velocity from centroid deltas ---

	// Ensure upload buffer is the right size
	if (!uploadBuf || uploadGridSize !== gridSize) {
		uploadBuf = new Uint8Array(cellCount * 4);
		uploadGridSize = gridSize;
	}

	// Maximum expected displacement per frame for normalization (in pixels).
	// Velocities beyond this are clamped to ±1 in normalized space.
	const maxDisplacement = Math.max(cellW, cellH) * 2;

	const hasPrev =
		prevCentroids !== null &&
		prevGridSize === gridSize &&
		prevMaskW === w &&
		prevMaskH === h;

	for (let i = 0; i < cellCount; i++) {
		const cx = centroids[i * 2]!;
		const cy = centroids[i * 2 + 1]!;
		const off = i * 4;

		if (!hasPrev || Number.isNaN(cx) || Number.isNaN(prevCentroids![i * 2]!)) {
			// First frame, empty cell now or previously — zero velocity
			uploadBuf[off] = 128; // R: 0.5 = zero horizontal
			uploadBuf[off + 1] = 128; // G: 0.5 = zero vertical
			uploadBuf[off + 2] = 0; // B: zero magnitude
			uploadBuf[off + 3] = 255; // A
			continue;
		}

		const dx = cx - prevCentroids![i * 2]!;
		const dy = cy - prevCentroids![i * 2 + 1]!;
		const mag = Math.sqrt(dx * dx + dy * dy);

		// Normalize to [-1, 1] range then encode as [0, 255] with 128 = zero
		const scale = maxDisplacement > 0 ? 1 / maxDisplacement : 0;
		const ndx = Math.max(-1, Math.min(1, dx * scale));
		const ndy = Math.max(-1, Math.min(1, dy * scale));
		const nmag = Math.min(1, mag * scale);

		uploadBuf[off] = Math.round(ndx * 127.5 + 127.5); // R: horizontal
		uploadBuf[off + 1] = Math.round(ndy * 127.5 + 127.5); // G: vertical
		uploadBuf[off + 2] = Math.round(nmag * 255); // B: magnitude
		uploadBuf[off + 3] = 255; // A
	}

	// --- Store centroids for next frame ---

	if (!prevCentroids || prevCentroids.length !== cellCount * 2) {
		prevCentroids = new Float32Array(cellCount * 2);
	}
	prevCentroids.set(centroids);
	prevGridSize = gridSize;
	prevMaskW = w;
	prevMaskH = h;

	// --- Upload to GPU ---

	gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		gridSize,
		gridSize,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		uploadBuf,
	);

	return velocityTexture;
}

/** Get the velocity texture without recomputing (for skipped frames). */
export function getVelocityTexture(): WebGLTexture | null {
	return velocityTexture;
}

/** Reset velocity tracking state. Call when switching presets or modes. */
export function resetVelocity(): void {
	prevCentroids = null;
	prevGridSize = 0;
	prevMaskW = 0;
	prevMaskH = 0;

	if (gl && velocityTexture) {
		gl.deleteTexture(velocityTexture);
		velocityTexture = createTexture(gl);
	}
}
