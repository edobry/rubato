/**
 * Central parameter store.
 * All tunable values live here. The dev GUI reads/writes this object directly.
 * Export JSON from the GUI to persist to params.json.
 */

// Segmentation models — quality vs speed tradeoff:
// - "quality": selfie_segmenter_landscape, better edges, 256x256 internal
// - "fast": selfie_segmenter base, lighter, 256x144 internal, better for Pi
export const SEGMENTATION_MODELS: Record<string, string> = {
	quality:
		"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite",
	fast: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
};

export const params = {
	camera: {
		resolution: "720p",
		// 1.0 = fill (crop to remove black bars), 0.0 = fit (show full frame, letterbox)
		fillAmount: 1.0,
	},
	segmentation: {
		model: "quality",
		delegate: "auto",
		confidenceThreshold: 0.5,
		temporalSmoothing: 0.4,
	},
	overlay: {
		opacity: 0.5,
		showOverlay: true,
	},
};

export type Params = typeof params;
