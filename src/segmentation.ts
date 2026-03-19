/**
 * Body segmentation module.
 * Wraps MediaPipe ImageSegmenter to produce per-frame person masks.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { params, SEGMENTATION_MODELS } from "./params";

let segmenter: ImageSegmenter | null = null;
let prevMask: Float32Array | null = null;
let currentModelKey: string | null = null;
let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null =
	null;

async function loadModel(modelKey: string): Promise<void> {
	const url = SEGMENTATION_MODELS[modelKey];
	if (!url) return;

	if (segmenter) {
		segmenter.close();
	}

	if (!vision) {
		vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
	}

	segmenter = await ImageSegmenter.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath: url,
			delegate: "GPU",
		},
		runningMode: "VIDEO",
		outputConfidenceMasks: true,
		outputCategoryMask: false,
	});

	currentModelKey = modelKey;
	prevMask = null;
}

export async function initSegmentation(): Promise<void> {
	await loadModel(params.segmentation.model);
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

	// Hot-swap model if changed via GUI
	if (currentModelKey !== params.segmentation.model) {
		loadModel(params.segmentation.model);
		return prevMask; // return last good mask while loading
	}

	const result = segmenter.segmentForVideo(video, timestampMs);
	const confidenceMasks = result.confidenceMasks;
	if (!confidenceMasks?.length) return null;

	const raw = confidenceMasks[0].getAsFloat32Array();
	const pixelCount = video.videoWidth * video.videoHeight;

	const currentMask = new Float32Array(pixelCount);
	const threshold = params.segmentation.confidenceThreshold;

	for (let i = 0; i < pixelCount; i++) {
		currentMask[i] = raw[i] > threshold ? raw[i] : 0;
	}

	const smooth = params.segmentation.temporalSmoothing;
	if (smooth > 0 && prevMask && prevMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			currentMask[i] = prevMask[i] * smooth + currentMask[i] * (1 - smooth);
		}
	}

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
