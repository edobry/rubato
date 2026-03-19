/**
 * Central parameter store.
 * All tunable values live here. The dev GUI reads/writes this object directly.
 * Export JSON from the GUI to persist to params.json.
 *
 * Sub-objects are wrapped with Proxy so that any property write automatically
 * fires registered listeners — no polling needed.
 */

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

export const params = {
	camera: reactive("camera", {
		resolution: "720p",
		// 1.0 = fill (crop to remove black bars), 0.0 = fit (show full frame, letterbox)
		fillAmount: 1.0,
	}),
	segmentation: reactive("segmentation", {
		model: "quality",
		delegate: "auto",
		confidenceThreshold: 0.5,
		temporalSmoothing: 0.4,
		// Run segmentation every Nth frame (1 = every frame, 2 = skip one, etc.)
		frameSkip: 1,
	}),
	overlay: reactive("overlay", {
		showOverlay: true,
		opacity: 0.5,
		color: "#00ffff",
		colorMode: "solid" as
			| "solid"
			| "rainbow"
			| "gradient"
			| "contour"
			| "invert"
			| "aura",
	}),
	autoTune: reactive("autoTune", {
		enabled: true,
		targetFps: 30,
		// Artificial delay (ms) added to segmentation to simulate slow hardware (0 = off)
		simulatedLoad: 0,
	}),
};

export type Params = typeof params;
