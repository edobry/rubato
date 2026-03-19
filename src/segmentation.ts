/**
 * Body segmentation module.
 * Wraps MediaPipe ImageSegmenter to produce per-frame confidence masks.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenter: ImageSegmenter | null = null;

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
 * Run segmentation on a video frame and return the confidence mask.
 * The returned Float32Array contains values 0–1 per pixel (1 = person).
 * The array is owned by MediaPipe and will be overwritten on the next call.
 */
export function segmentFrame(
	video: HTMLVideoElement,
	timestampMs: number,
): Float32Array | null {
	if (!segmenter) return null;

	const result = segmenter.segmentForVideo(video, timestampMs);
	const mask = result.confidenceMasks?.[0];
	if (!mask) return null;

	return mask.getAsFloat32Array();
}

export function getSegmenterResolution(video: HTMLVideoElement): {
	width: number;
	height: number;
} {
	return { width: video.videoWidth, height: video.videoHeight };
}
