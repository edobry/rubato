/**
 * Auto-tuner: monitors FPS and progressively degrades quality to hit target framerate.
 *
 * Adjustment order (least to most impactful visually):
 * 1. Increase frame skip (2 → 3 → 4)
 * 2. Switch model to "fast"
 * 3. Lower camera resolution (720p → 480p → 360p)
 *
 * If FPS is well above target, it gradually upgrades back.
 * Waits between adjustments to let FPS stabilize.
 */

import { params } from "./params";

const SAMPLE_WINDOW = 60; // Frames to average over
const SETTLE_TIME = 3000; // ms to wait after an adjustment before re-evaluating
const HEADROOM = 5; // fps above target before considering upgrade

const RESOLUTION_LADDER = ["720p", "480p", "360p"];
const MODEL_LADDER = ["quality", "fast"];
const MAX_FRAME_SKIP = 4;

let frameTimes: number[] = [];
let lastAdjustTime = 0;
let adjustmentsLog: string[] = [];

export function getAutoTuneLog(): string[] {
	return adjustmentsLog;
}

function currentFps(): number {
	if (frameTimes.length < 2) return 0;
	const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0];
	if (elapsed === 0) return 0;
	return Math.round(((frameTimes.length - 1) / elapsed) * 1000);
}

function log(msg: string): void {
	const entry = `[autotune] ${msg}`;
	console.log(entry);
	adjustmentsLog.push(entry);
	if (adjustmentsLog.length > 20) adjustmentsLog.shift();
}

function resolutionIndex(): number {
	return RESOLUTION_LADDER.indexOf(params.camera.resolution);
}

function modelIndex(): number {
	return MODEL_LADDER.indexOf(params.segmentation.model);
}

/** Try to degrade one step. Returns true if an adjustment was made. */
function degrade(): boolean {
	// 1. Increase frame skip
	if (params.segmentation.frameSkip < MAX_FRAME_SKIP) {
		params.segmentation.frameSkip++;
		log(`Frame skip → ${params.segmentation.frameSkip}`);
		return true;
	}

	// 2. Switch to fast model
	const mi = modelIndex();
	if (mi < MODEL_LADDER.length - 1) {
		params.segmentation.model = MODEL_LADDER[mi + 1];
		log(`Model → ${params.segmentation.model}`);
		return true;
	}

	// 3. Lower resolution
	const ri = resolutionIndex();
	if (ri < RESOLUTION_LADDER.length - 1) {
		params.camera.resolution = RESOLUTION_LADDER[ri + 1];
		log(`Resolution → ${params.camera.resolution}`);
		return true;
	}

	return false; // Already at lowest quality
}

/** Try to upgrade one step. Returns true if an adjustment was made. */
function upgrade(): boolean {
	// Reverse order: resolution → model → frame skip

	// 1. Raise resolution
	const ri = resolutionIndex();
	if (ri > 0) {
		params.camera.resolution = RESOLUTION_LADDER[ri - 1];
		log(`Resolution → ${params.camera.resolution}`);
		return true;
	}

	// 2. Switch to quality model
	const mi = modelIndex();
	if (mi > 0) {
		params.segmentation.model = MODEL_LADDER[mi - 1];
		log(`Model → ${params.segmentation.model}`);
		return true;
	}

	// 3. Decrease frame skip
	if (params.segmentation.frameSkip > 1) {
		params.segmentation.frameSkip--;
		log(`Frame skip → ${params.segmentation.frameSkip}`);
		return true;
	}

	return false; // Already at highest quality
}

/**
 * Call once per frame from the render loop.
 * Monitors FPS and adjusts params when auto-tune is enabled.
 */
export function autoTuneTick(): void {
	const now = performance.now();
	frameTimes.push(now);
	if (frameTimes.length > SAMPLE_WINDOW) frameTimes.shift();

	if (!params.autoTune.enabled) return;
	if (frameTimes.length < SAMPLE_WINDOW) return; // Need enough data
	if (now - lastAdjustTime < SETTLE_TIME) return; // Wait for stabilization

	const fps = currentFps();
	const target = params.autoTune.targetFps;

	if (fps < target) {
		if (degrade()) {
			lastAdjustTime = now;
			frameTimes = []; // Reset after adjustment
		}
	} else if (fps > target + HEADROOM) {
		if (upgrade()) {
			lastAdjustTime = now;
			frameTimes = [];
		}
	}
}
