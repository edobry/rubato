/**
 * Motion detection module.
 * Compares consecutive raw segmentation masks to identify which pixels
 * of the silhouette are moving vs still.
 *
 * Also maintains a simple trail accumulator: motion deposits into a
 * persistent buffer that decays over time, giving visible "remnants"
 * along the path of movement.
 */

import { params } from "./params";

let prevRawMask: Float32Array | null = null;
let trailBuffer: Float32Array | null = null;

/** Reset motion detection state. Call when switching presets or visualization modes. */
export function resetMotion(): void {
	prevRawMask = null;
	trailBuffer = null;
}

/**
 * Detect motion and accumulate trails.
 *
 * @returns An object with:
 *   - `motion`: raw frame-to-frame diff (flickers, only current frame)
 *   - `trail`: accumulated trail buffer (persists, decays over time)
 */
export function detectMotion(
	currentRaw: Float32Array,
	width: number,
	height: number,
): { motion: Float32Array; trail: Float32Array } {
	const pixelCount = width * height;
	const motionMap = new Float32Array(pixelCount);
	const threshold = params.segmentation.motionThreshold;
	const deposition = params.motion.deposition;
	const decay = params.motion.decay;

	// Compute raw motion diff
	if (prevRawMask && prevRawMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			const diff = Math.abs(currentRaw[i] - prevRawMask[i]);
			motionMap[i] = diff > threshold ? diff : 0;
		}
	}

	// Initialize trail buffer if needed
	if (!trailBuffer || trailBuffer.length !== pixelCount) {
		trailBuffer = new Float32Array(pixelCount);
	}

	// Accumulate motion into trail buffer + apply decay
	for (let i = 0; i < pixelCount; i++) {
		// Deposit: add motion energy, clamped to 1
		trailBuffer[i] = Math.min(1, trailBuffer[i] + motionMap[i] * deposition);
		// Decay: multiply toward zero
		trailBuffer[i] *= decay;
		// Clean up near-zero values
		if (trailBuffer[i] < 0.005) trailBuffer[i] = 0;
	}

	// Store current frame
	if (!prevRawMask || prevRawMask.length !== pixelCount) {
		prevRawMask = new Float32Array(pixelCount);
	}
	prevRawMask.set(currentRaw);

	return { motion: motionMap, trail: trailBuffer };
}
