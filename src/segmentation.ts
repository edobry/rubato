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
		// Multiclass path: category mask is the authoritative person/background signal.
		// Confidence masks soften edges — sum all person-class confidences to get
		// overall "person-ness" per pixel, then threshold for clean boundaries.
		const categories = categoryMask.getAsUint8Array();

		// Pre-fetch all person-class confidence arrays
		const personConfs: Float32Array[] = [];
		for (let c = 1; c <= 5 && c < confidenceMasks.length; c++) {
			personConfs.push(confidenceMasks[c].getAsFloat32Array());
		}

		for (let i = 0; i < pixelCount; i++) {
			const cat = categories[i];
			// Categories: 0=background, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=others
			if (cat >= 1 && cat <= 5) {
				// Sum confidence across all person classes for this pixel
				let totalConf = 0;
				for (const conf of personConfs) {
					totalConf += conf[i];
				}
				// Clamp to 0–1 and apply threshold
				totalConf = Math.min(totalConf, 1);
				currentMask[i] =
					totalConf > params.segmentation.confidenceThreshold ? totalConf : 0;
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
