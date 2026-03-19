/**
 * Motion detection module.
 * Compares consecutive raw segmentation masks to identify which pixels
 * of the silhouette are moving vs still. Only moving regions should
 * leave visual trails.
 */

import { params } from "./params";

let prevRawMask: Float32Array | null = null;

/**
 * Detect motion by comparing the current raw segmentation mask to the
 * previous frame's raw mask using per-pixel absolute difference.
 *
 * @param currentRaw - Thresholded confidence mask before temporal smoothing
 * @param width - Frame width in pixels
 * @param height - Frame height in pixels
 * @returns A motion map (0–1 per pixel, 1 = moving, 0 = still)
 */
export function detectMotion(
	currentRaw: Float32Array,
	width: number,
	height: number,
): Float32Array {
	const pixelCount = width * height;
	const motionMap = new Float32Array(pixelCount);
	const threshold = params.segmentation.motionThreshold;

	if (prevRawMask && prevRawMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			const diff = Math.abs(currentRaw[i] - prevRawMask[i]);
			motionMap[i] = diff > threshold ? diff : 0;
		}
	}

	// Store current frame as previous for the next call
	if (!prevRawMask || prevRawMask.length !== pixelCount) {
		prevRawMask = new Float32Array(pixelCount);
	}
	prevRawMask.set(currentRaw);

	return motionMap;
}
