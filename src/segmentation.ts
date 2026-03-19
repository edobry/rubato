/**
 * Body segmentation module.
 * Wraps MediaPipe ImageSegmenter to produce per-frame person masks.
 * Uses the landscape model with thresholding and temporal smoothing.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { params } from "./params";

// Landscape model: better edge quality than base selfie_segmenter,
// single-class confidence output (0=background, 1=person)
const MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";

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
		outputCategoryMask: false,
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
	const confidenceMasks = result.confidenceMasks;
	if (!confidenceMasks?.length) return null;

	const raw = confidenceMasks[0].getAsFloat32Array();
	const pixelCount = video.videoWidth * video.videoHeight;

	const currentMask = new Float32Array(pixelCount);
	const threshold = params.segmentation.confidenceThreshold;

	// Threshold: cut low-confidence pixels to reduce bleed onto nearby objects
	for (let i = 0; i < pixelCount; i++) {
		currentMask[i] = raw[i] > threshold ? raw[i] : 0;
	}

	// Temporal smoothing: blend with previous frame to reduce jitter
	const smooth = params.segmentation.temporalSmoothing;
	if (smooth > 0 && prevMask && prevMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			currentMask[i] = prevMask[i] * smooth + currentMask[i] * (1 - smooth);
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
