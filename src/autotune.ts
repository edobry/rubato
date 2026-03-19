/**
 * Auto-tuner: monitors FPS and adjusts quality settings to hit target framerate.
 *
 * Uses hill-climbing with memory to avoid oscillation:
 * - Enumerates a discrete configuration space of (frameSkip, model, resolution) combos
 *   ordered from highest quality to lowest.
 * - Tracks FPS history per configuration to remember what worked.
 * - Once a stable config is found (FPS in target range for N seconds), stops adjusting.
 * - Only re-evaluates if FPS drops significantly (>20% below target) for a sustained period.
 * - Hysteresis: won't upgrade unless FPS has been well above target for 5+ seconds.
 * - Tracks best-known config and can jump directly to it instead of linear climbing.
 */

import { params } from "./params";

// --- Constants ---

const SAMPLE_WINDOW = 60;
const SETTLE_TIME = 3000;

const RESOLUTION_LADDER = ["720p", "480p", "360p"];
const MODEL_LADDER = ["quality", "fast"];
const MAX_FRAME_SKIP = 4;

/** How long FPS must stay in the target range before we consider the config stable (ms). */
const STABLE_DURATION = 4000;
/** How long FPS must be well above target before we attempt an upgrade (ms). */
const UPGRADE_HYSTERESIS = 5000;
/** FPS must exceed target by at least this much before upgrade hysteresis timer starts. */
const UPGRADE_HEADROOM = 8;
/** FPS must drop this fraction below target for a sustained period to trigger re-evaluation. */
const DROP_THRESHOLD = 0.2;
/** How long (ms) FPS must stay below the drop threshold to break out of stable state. */
const DROP_SUSTAINED_DURATION = 2000;
/** Minimum number of FPS samples before we trust a config's recorded average. */
const MIN_SAMPLES_FOR_TRUST = 3;

// --- Configuration space ---

interface Config {
	frameSkip: number;
	model: string;
	resolution: string;
}

interface ConfigRecord {
	config: Config;
	fpsSamples: number[];
	averageFps: number;
}

/** Build the ordered list of configs from highest quality (index 0) to lowest. */
function buildConfigLadder(): Config[] {
	const configs: Config[] = [];
	for (const resolution of RESOLUTION_LADDER) {
		for (const model of MODEL_LADDER) {
			for (let frameSkip = 1; frameSkip <= MAX_FRAME_SKIP; frameSkip++) {
				configs.push({ frameSkip, model, resolution });
			}
		}
	}
	return configs;
}

const CONFIG_LADDER = buildConfigLadder();

function configKey(c: Config): string {
	return `${c.resolution}/${c.model}/skip${c.frameSkip}`;
}

function configsEqual(a: Config, b: Config): boolean {
	return (
		a.frameSkip === b.frameSkip &&
		a.model === b.model &&
		a.resolution === b.resolution
	);
}

function configIndex(c: Config): number {
	return CONFIG_LADDER.findIndex((x) => configsEqual(x, c));
}

// --- State ---

let frameTimes: number[] = [];
let lastAdjustTime = 0;

/** FPS history per config key. */
const configHistory: Map<string, ConfigRecord> = new Map();

/** Best config seen: above target and highest quality. */
let bestKnownConfig: Config | null = null;
let bestKnownFps = 0;

/** Timestamp when current config first entered the "stable" FPS band. */
let stableEnteredAt = 0;
/** Timestamp when FPS first went well above target (for upgrade hysteresis). */
let upgradeHeadroomSince = 0;
/** Timestamp when FPS first dropped significantly below target while stable. */
let dropDetectedAt = 0;
/** Whether the current config is considered stable. */
let isStable = false;

// --- Public state for GUI display ---

export const autoTuneState = {
	fps: 0,
	status: "idle" as
		| "idle"
		| "collecting"
		| "settling"
		| "degrading"
		| "upgrading"
		| "optimal"
		| "floor"
		| "stable",
	lastAction: "",
	adjustCount: 0,
	log: [] as string[],
};

type LogChangeListener = (log: string[]) => void;
const logListeners: LogChangeListener[] = [];

/** Subscribe to autotune log changes. Returns an unsubscribe function. */
export function onLogChange(fn: LogChangeListener): () => void {
	logListeners.push(fn);
	return () => {
		const idx = logListeners.indexOf(fn);
		if (idx >= 0) logListeners.splice(idx, 1);
	};
}

function notifyLogListeners(): void {
	for (const fn of logListeners) fn(autoTuneState.log);
}

// --- Helpers ---

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
	notifyLogListeners();
}

function qualityLevel(): string {
	return `${params.camera.resolution}/${params.segmentation.model}/skip${params.segmentation.frameSkip}`;
}

function getCurrentConfig(): Config {
	return {
		frameSkip: params.segmentation.frameSkip,
		model: params.segmentation.model,
		resolution: params.camera.resolution,
	};
}

function applyConfig(c: Config): void {
	params.segmentation.frameSkip = c.frameSkip;
	params.segmentation.model = c.model;
	params.camera.resolution = c.resolution;
}

function recordFps(config: Config, fps: number): void {
	const key = configKey(config);
	let record = configHistory.get(key);
	if (!record) {
		record = { config: { ...config }, fpsSamples: [], averageFps: 0 };
		configHistory.set(key, record);
	}
	record.fpsSamples.push(fps);
	// Keep only last 10 samples per config
	if (record.fpsSamples.length > 10) record.fpsSamples.shift();
	record.averageFps =
		record.fpsSamples.reduce((a, b) => a + b, 0) / record.fpsSamples.length;
}

function updateBestKnown(config: Config, fps: number, target: number): void {
	if (fps < target) return;
	const idx = configIndex(config);
	const bestIdx = bestKnownConfig ? configIndex(bestKnownConfig) : -1;
	// Prefer higher quality (lower index), or same quality with closer-to-target fps
	if (
		!bestKnownConfig ||
		idx < bestIdx ||
		(idx === bestIdx && fps >= target && fps < bestKnownFps)
	) {
		bestKnownConfig = { ...config };
		bestKnownFps = fps;
	}
}

/** Find the next config to try when degrading, skipping configs known to be too slow. */
function findDegradeTarget(current: Config, target: number): Config | null {
	const currentIdx = configIndex(current);
	for (let i = currentIdx + 1; i < CONFIG_LADDER.length; i++) {
		const candidate = CONFIG_LADDER[i];
		const key = configKey(candidate);
		const record = configHistory.get(key);
		// Skip configs we already know are too slow (unless we have very few samples)
		if (
			record &&
			record.fpsSamples.length >= MIN_SAMPLES_FOR_TRUST &&
			record.averageFps < target * (1 - DROP_THRESHOLD)
		) {
			continue;
		}
		return candidate;
	}
	// Everything below is known bad or we're at the bottom — use the last config
	return currentIdx < CONFIG_LADDER.length - 1
		? CONFIG_LADDER[CONFIG_LADDER.length - 1]
		: null;
}

/** Find the best upgrade target: use best-known config if available, otherwise step up one. */
function findUpgradeTarget(current: Config, target: number): Config | null {
	const currentIdx = configIndex(current);
	// If we have a best-known config that's higher quality, jump there
	if (bestKnownConfig) {
		const bestIdx = configIndex(bestKnownConfig);
		if (bestIdx < currentIdx) {
			const key = configKey(bestKnownConfig);
			const record = configHistory.get(key);
			// Only jump if we trust that it worked
			if (
				record &&
				record.fpsSamples.length >= MIN_SAMPLES_FOR_TRUST &&
				record.averageFps >= target
			) {
				return bestKnownConfig;
			}
		}
	}
	// Otherwise step up by one level, skipping configs known to be too demanding
	for (let i = currentIdx - 1; i >= 0; i--) {
		const candidate = CONFIG_LADDER[i];
		const key = configKey(candidate);
		const record = configHistory.get(key);
		// Skip configs we know can't hit the target
		if (
			record &&
			record.fpsSamples.length >= MIN_SAMPLES_FOR_TRUST &&
			record.averageFps < target
		) {
			continue;
		}
		// Only try one step up (conservative)
		return candidate;
	}
	return null;
}

function resetTimers(): void {
	stableEnteredAt = 0;
	upgradeHeadroomSince = 0;
	dropDetectedAt = 0;
	isStable = false;
}

function switchConfig(config: Config, direction: string): void {
	applyConfig(config);
	lastAdjustTime = performance.now();
	frameTimes = [];
	resetTimers();
	log(`${direction} ${qualityLevel()}`);
}

// --- Main tick ---

export function autoTuneTick(): void {
	const now = performance.now();
	frameTimes.push(now);
	if (frameTimes.length > SAMPLE_WINDOW) frameTimes.shift();

	autoTuneState.fps = currentFps();

	if (!params.autoTune.enabled) {
		autoTuneState.status = "idle";
		resetTimers();
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
	const current = getCurrentConfig();

	// Record this measurement
	recordFps(current, fps);
	updateBestKnown(current, fps, target);

	const belowTarget = fps < target;
	const significantDrop = fps < target * (1 - DROP_THRESHOLD);
	const wellAboveTarget = fps > target + UPGRADE_HEADROOM;
	const inTargetBand = fps >= target && !wellAboveTarget;

	// --- Stable state logic ---
	if (isStable) {
		if (significantDrop) {
			// Start or continue drop detection timer
			if (dropDetectedAt === 0) {
				dropDetectedAt = now;
			} else if (now - dropDetectedAt >= DROP_SUSTAINED_DURATION) {
				// Sustained drop: break out of stable and degrade
				log(
					`Stable config lost: FPS ${fps} dropped >20% below target ${target}`,
				);
				isStable = false;
				dropDetectedAt = 0;
				const degradeTarget = findDegradeTarget(current, target);
				if (degradeTarget && !configsEqual(degradeTarget, current)) {
					switchConfig(degradeTarget, "↓");
					autoTuneState.status = "degrading";
				} else {
					autoTuneState.status = "floor";
				}
				return;
			}
		} else {
			dropDetectedAt = 0;
		}

		// While stable, check for sustained headroom to attempt upgrade
		if (wellAboveTarget) {
			if (upgradeHeadroomSince === 0) {
				upgradeHeadroomSince = now;
			} else if (now - upgradeHeadroomSince >= UPGRADE_HYSTERESIS) {
				const upgradeTarget = findUpgradeTarget(current, target);
				if (upgradeTarget && !configsEqual(upgradeTarget, current)) {
					switchConfig(upgradeTarget, "↑");
					autoTuneState.status = "upgrading";
					return;
				}
			}
		} else {
			upgradeHeadroomSince = 0;
		}

		autoTuneState.status = "stable";
		return;
	}

	// --- Non-stable: actively searching for a good config ---

	if (inTargetBand) {
		// FPS is in the sweet spot — start stability timer
		if (stableEnteredAt === 0) {
			stableEnteredAt = now;
		} else if (now - stableEnteredAt >= STABLE_DURATION) {
			isStable = true;
			stableEnteredAt = 0;
			upgradeHeadroomSince = 0;
			dropDetectedAt = 0;
			log(`Stable at ${qualityLevel()} (${fps} fps)`);
			autoTuneState.status = "stable";
			return;
		}
		autoTuneState.status = "optimal";
		return;
	}

	// Reset stability timer if we leave the sweet spot
	stableEnteredAt = 0;

	if (belowTarget) {
		// Need to degrade
		const degradeTarget = findDegradeTarget(current, target);
		if (degradeTarget && !configsEqual(degradeTarget, current)) {
			switchConfig(degradeTarget, "↓");
			autoTuneState.status = "degrading";
		} else {
			autoTuneState.status = "floor";
			if (autoTuneState.lastAction !== "At minimum quality") {
				log(`At minimum quality, ${fps} fps (target: ${target})`);
			}
		}
	} else if (wellAboveTarget) {
		// FPS well above target — start hysteresis timer for upgrade
		if (upgradeHeadroomSince === 0) {
			upgradeHeadroomSince = now;
			autoTuneState.status = "optimal";
		} else if (now - upgradeHeadroomSince >= UPGRADE_HYSTERESIS) {
			const upgradeTarget = findUpgradeTarget(current, target);
			if (upgradeTarget && !configsEqual(upgradeTarget, current)) {
				switchConfig(upgradeTarget, "↑");
				autoTuneState.status = "upgrading";
			} else {
				autoTuneState.status = "optimal";
			}
		} else {
			autoTuneState.status = "optimal";
		}
	}
}
