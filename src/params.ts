/**
 * Central parameter store.
 * All tunable values live here. The dev GUI reads/writes this object directly.
 * Defaults are loaded from params.json at build time via Vite's JSON import.
 *
 * Sub-objects are wrapped with Proxy so that any property write automatically
 * fires registered listeners — no polling needed.
 */

import defaults from "../params.json";

// Segmentation models — quality vs speed tradeoff:
// - "quality": selfie_segmenter_landscape, better edges, 256x256 internal
// - "fast": selfie_segmenter base, lighter, 256x144 internal, better for Pi
export const SEGMENTATION_MODELS: Record<string, string> = {
	quality:
		"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite",
	fast: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
};

type ParamChangeListener = (section: string, key: string) => void;
const listeners: ParamChangeListener[] = [];

/** Subscribe to any param change. Returns an unsubscribe function. */
export function onParamChange(fn: ParamChangeListener): () => void {
	listeners.push(fn);
	return () => {
		const idx = listeners.indexOf(fn);
		if (idx >= 0) listeners.splice(idx, 1);
	};
}

/** Wrap a plain object so that setting any property notifies listeners. */
function reactive<T extends Record<string, unknown>>(
	section: string,
	target: T,
): T {
	return new Proxy(target, {
		set(obj, prop, value) {
			const old = obj[prop as keyof T];
			const result = Reflect.set(obj, prop, value);
			if (old !== value) {
				for (const fn of listeners) fn(section, prop as string);
			}
			return result;
		},
	});
}

const d = defaults;

export const params = {
	camera: reactive("camera", {
		showFeed: d.camera.showFeed,
		resolution: d.camera.resolution,
		fillAmount: d.camera.fillAmount,
	}),
	segmentation: reactive("segmentation", {
		model: d.segmentation.model,
		delegate: d.segmentation.delegate,
		confidenceThreshold: d.segmentation.confidenceThreshold,
		temporalSmoothing: d.segmentation.temporalSmoothing,
		frameSkip: d.segmentation.frameSkip,
		motionThreshold: d.segmentation.motionThreshold,
	}),
	fog: reactive("fog", {
		speed: d.fog.speed,
		scale: d.fog.scale,
		density: d.fog.density,
		brightness: d.fog.brightness,
		color: d.fog.color,
	}),
	motion: reactive("motion", {
		// How strongly motion deposits into the trail buffer (0-5)
		deposition: d.motion.deposition,
		// Per-frame decay multiplier (0.9 = fast fade, 0.99 = slow fade)
		decay: d.motion.decay,
	}),
	overlay: reactive("overlay", {
		showOverlay: d.overlay.showOverlay,
		// What to visualize: "mask", "motion" (raw diff), "trail" (accumulated), "both" (mask+trail)
		visualize: d.overlay.visualize as "mask" | "motion" | "trail" | "both",
		opacity: d.overlay.opacity,
		color: d.overlay.color,
		colorMode: d.overlay.colorMode as
			| "solid"
			| "rainbow"
			| "gradient"
			| "contour"
			| "invert"
			| "aura",
		// Overlay downsample factor (1=full res, 2=half, 4=quarter)
		downsample: d.overlay.downsample,
	}),
	autoTune: reactive("autoTune", {
		enabled: d.autoTune.enabled,
		targetFps: d.autoTune.targetFps,
		simulatedLoad: d.autoTune.simulatedLoad,
		settleTime: d.autoTune.settletime,
		stableDuration: d.autoTune.stableDuration,
		upgradeHysteresis: d.autoTune.upgradeHysteresis,
		upgradeHeadroom: d.autoTune.upgradeHeadroom,
		dropThreshold: d.autoTune.dropThreshold,
		dropSustainedDuration: d.autoTune.dropSustainedDuration,
		tolerancePct: d.autoTune.tolerancePct,
	}),
};

export type Params = typeof params;
