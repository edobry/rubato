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

const SAMPLE_WINDOW = 60;
const SETTLE_TIME = 3000;
const HEADROOM = 5;

const RESOLUTION_LADDER = ["720p", "480p", "360p"];
const MODEL_LADDER = ["quality", "fast"];
const MAX_FRAME_SKIP = 4;

let frameTimes: number[] = [];
let lastAdjustTime = 0;

// Public state for GUI display
export const autoTuneState = {
	fps: 0,
	status: "idle" as
		| "idle"
		| "collecting"
		| "settling"
		| "degrading"
		| "upgrading"
		| "optimal"
		| "floor",
	lastAction: "",
	adjustCount: 0,
	log: [] as string[],
};

function currentFps(): number {
	if (frameTimes.length < 2) return 0;
	const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0];
	if (elapsed === 0) return 0;
	return Math.round(((frameTimes.length - 1) / elapsed) * 1000);
}

function log(msg: string): void {
	const entry = `${new Date().toLocaleTimeString()} ${msg}`;
	console.log(`[autotune] ${msg}`);
	autoTuneState.log.push(entry);
	if (autoTuneState.log.length > 20) autoTuneState.log.shift();
	autoTuneState.lastAction = msg;
	autoTuneState.adjustCount++;
}

function qualityLevel(): string {
	return `${params.camera.resolution}/${params.segmentation.model}/skip${params.segmentation.frameSkip}`;
}

function resolutionIndex(): number {
	return RESOLUTION_LADDER.indexOf(params.camera.resolution);
}

function modelIndex(): number {
	return MODEL_LADDER.indexOf(params.segmentation.model);
}

function canDegrade(): boolean {
	return (
		params.segmentation.frameSkip < MAX_FRAME_SKIP ||
		modelIndex() < MODEL_LADDER.length - 1 ||
		resolutionIndex() < RESOLUTION_LADDER.length - 1
	);
}

function canUpgrade(): boolean {
	return (
		resolutionIndex() > 0 ||
		modelIndex() > 0 ||
		params.segmentation.frameSkip > 1
	);
}

function degrade(): boolean {
	if (params.segmentation.frameSkip < MAX_FRAME_SKIP) {
		params.segmentation.frameSkip++;
		log(`↓ Frame skip → ${params.segmentation.frameSkip} (${qualityLevel()})`);
		return true;
	}
	const mi = modelIndex();
	if (mi < MODEL_LADDER.length - 1) {
		params.segmentation.model = MODEL_LADDER[mi + 1];
		log(`↓ Model → ${params.segmentation.model} (${qualityLevel()})`);
		return true;
	}
	const ri = resolutionIndex();
	if (ri < RESOLUTION_LADDER.length - 1) {
		params.camera.resolution = RESOLUTION_LADDER[ri + 1];
		log(`↓ Resolution → ${params.camera.resolution} (${qualityLevel()})`);
		return true;
	}
	return false;
}

function upgrade(): boolean {
	const ri = resolutionIndex();
	if (ri > 0) {
		params.camera.resolution = RESOLUTION_LADDER[ri - 1];
		log(`↑ Resolution → ${params.camera.resolution} (${qualityLevel()})`);
		return true;
	}
	const mi = modelIndex();
	if (mi > 0) {
		params.segmentation.model = MODEL_LADDER[mi - 1];
		log(`↑ Model → ${params.segmentation.model} (${qualityLevel()})`);
		return true;
	}
	if (params.segmentation.frameSkip > 1) {
		params.segmentation.frameSkip--;
		log(`↑ Frame skip → ${params.segmentation.frameSkip} (${qualityLevel()})`);
		return true;
	}
	return false;
}

export function autoTuneTick(): void {
	const now = performance.now();
	frameTimes.push(now);
	if (frameTimes.length > SAMPLE_WINDOW) frameTimes.shift();

	autoTuneState.fps = currentFps();

	if (!params.autoTune.enabled) {
		autoTuneState.status = "idle";
		return;
	}

	if (frameTimes.length < SAMPLE_WINDOW) {
		autoTuneState.status = "collecting";
		return;
	}

	if (now - lastAdjustTime < SETTLE_TIME) {
		autoTuneState.status = "settling";
		return;
	}

	const fps = autoTuneState.fps;
	const target = params.autoTune.targetFps;

	if (fps < target) {
		if (degrade()) {
			autoTuneState.status = "degrading";
			lastAdjustTime = now;
			frameTimes = [];
		} else {
			autoTuneState.status = "floor";
			if (autoTuneState.lastAction !== "⚠ At minimum quality") {
				log(`⚠ At minimum quality, ${fps} fps (target: ${target})`);
			}
		}
	} else if (fps > target + HEADROOM && canUpgrade()) {
		if (upgrade()) {
			autoTuneState.status = "upgrading";
			lastAdjustTime = now;
			frameTimes = [];
		}
	} else {
		autoTuneState.status = canDegrade() || canUpgrade() ? "optimal" : "floor";
	}
}
