/**
 * Body segmentation module.
 * Wraps MediaPipe ImageSegmenter to produce per-frame person masks.
 * Uses the multiclass model for sharper boundaries and temporal
 * smoothing to reduce frame-to-frame jitter.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { params } from "./params";

// Multiclass model: separates person into sub-regions (hair, body, face, clothes)
// for sharper boundaries than the single-class segmenter
const MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float16/latest/selfie_multiclass_256x256.tflite";

let segmenter: ImageSegmenter | null = null;
let prevMask: Float32Array | null = null;

export async function initSegmentation(): Promise<void> {
	const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

	segmenter = await ImageSegmenter.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath: MODEL_URL,
			delegate: "GPU",
		},
		runningMode: "VIDEO",
		outputConfidenceMasks: true,
		outputCategoryMask: true,
	});
}

/**
 * Run segmentation on a video frame and return a processed person mask.
 * Returns a Float32Array of 0–1 values (1 = person) at camera resolution.
 * The returned array is owned by this module — safe to hold across frames.
 */
export function segmentFrame(
	video: HTMLVideoElement,
	timestampMs: number,
): Float32Array | null {
	if (!segmenter) return null;

	const result = segmenter.segmentForVideo(video, timestampMs);

	// Use category mask to identify person pixels (categories 1–5 are person parts)
	const categoryMask = result.categoryMask;
	// Use confidence masks for smooth edges on person regions
	const confidenceMasks = result.confidenceMasks;

	if (!categoryMask && !confidenceMasks?.length) return null;

	const width = video.videoWidth;
	const height = video.videoHeight;
	const pixelCount = width * height;

	// Build the current frame's mask
	const currentMask = new Float32Array(pixelCount);

	if (categoryMask && confidenceMasks && confidenceMasks.length > 0) {
		// Multiclass path: use category to decide person vs background,
		// then use the max confidence across person classes for smooth edges
		const categories = categoryMask.getAsUint8Array();

		for (let i = 0; i < pixelCount; i++) {
			const cat = categories[i];
			// Categories: 0=background, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=others(accessories)
			if (cat >= 1 && cat <= 5) {
				// Find confidence for this pixel's class
				const conf = confidenceMasks[cat]?.getAsFloat32Array();
				const confidence = conf ? conf[i] : 1.0;
				currentMask[i] =
					confidence > params.segmentation.confidenceThreshold ? confidence : 0;
			}
		}
	} else if (confidenceMasks && confidenceMasks.length > 0) {
		// Fallback: single-class confidence mask
		const raw = confidenceMasks[0].getAsFloat32Array();
		for (let i = 0; i < pixelCount; i++) {
			currentMask[i] =
				raw[i] > params.segmentation.confidenceThreshold ? raw[i] : 0;
		}
	}

	// Temporal smoothing: blend with previous frame
	if (prevMask && prevMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			currentMask[i] =
				prevMask[i] * params.segmentation.temporalSmoothing +
				currentMask[i] * (1 - params.segmentation.temporalSmoothing);
		}
	}

	// Store for next frame
	if (!prevMask || prevMask.length !== pixelCount) {
		prevMask = new Float32Array(pixelCount);
	}
	prevMask.set(currentMask);

	return currentMask;
}

export function getSegmenterResolution(video: HTMLVideoElement): {
	width: number;
	height: number;
} {
	return { width: video.videoWidth, height: video.videoHeight };
}
