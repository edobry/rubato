/**
 * Body segmentation module.
 * Wraps MediaPipe ImageSegmenter to produce per-frame person masks.
 * Supports GPU→CPU fallback for devices with limited WebGL (e.g. Raspberry Pi).
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { params, SEGMENTATION_MODELS } from "./params";

let segmenter: ImageSegmenter | null = null;
let prevMask: Float32Array | null = null;
let currentModelKey: string | null = null;
let currentDelegate: string | null = null;
let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null =
	null;

/** Resolve "auto" to an actual delegate, trying GPU first then CPU. */
async function createSegmenter(
	url: string,
	delegate: string,
): Promise<ImageSegmenter> {
	if (!vision) {
		vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
	}

	const options = {
		baseOptions: { modelAssetPath: url, delegate: "GPU" as "GPU" | "CPU" },
		runningMode: "VIDEO" as const,
		outputConfidenceMasks: true,
		outputCategoryMask: false,
	};

	if (delegate === "CPU") {
		options.baseOptions.delegate = "CPU";
		return ImageSegmenter.createFromOptions(vision, options);
	}

	if (delegate === "GPU") {
		options.baseOptions.delegate = "GPU";
		return ImageSegmenter.createFromOptions(vision, options);
	}

	// "auto": try GPU, fall back to CPU
	try {
		options.baseOptions.delegate = "GPU";
		const seg = await ImageSegmenter.createFromOptions(vision, options);

		// GPU creation can "succeed" but produce no output on weak GPUs.
		// We can't easily test that here, so we also check in segmentFrame
		// and re-init with CPU if we get no masks.
		console.log("Segmentation using GPU delegate");
		return seg;
	} catch {
		console.warn("GPU delegate failed, falling back to CPU");
		options.baseOptions.delegate = "CPU";
		const seg = await ImageSegmenter.createFromOptions(vision, options);
		console.log("Segmentation using CPU delegate");
		return seg;
	}
}

async function loadModel(modelKey: string, delegate: string): Promise<void> {
	const url = SEGMENTATION_MODELS[modelKey];
	if (!url) return;

	if (segmenter) {
		segmenter.close();
		segmenter = null;
	}

	segmenter = await createSegmenter(url, delegate);
	currentModelKey = modelKey;
	currentDelegate = delegate;
	prevMask = null;
	gpuFailCount = 0;
}

// Track consecutive frames with no mask output — signals silent GPU failure
let gpuFailCount = 0;
const GPU_FAIL_THRESHOLD = 30; // ~1 second at 30fps

export async function initSegmentation(): Promise<void> {
	await loadModel(params.segmentation.model, params.segmentation.delegate);
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

	// Hot-swap model or delegate if changed via GUI
	if (
		currentModelKey !== params.segmentation.model ||
		currentDelegate !== params.segmentation.delegate
	) {
		loadModel(params.segmentation.model, params.segmentation.delegate);
		return prevMask;
	}

	const result = segmenter.segmentForVideo(video, timestampMs);
	const confidenceMasks = result.confidenceMasks;

	if (!confidenceMasks?.length) {
		// Silent GPU failure detection: if we're in auto mode and getting
		// no masks consistently, fall back to CPU
		if (
			params.segmentation.delegate === "auto" ||
			params.segmentation.delegate === "GPU"
		) {
			gpuFailCount++;
			if (gpuFailCount >= GPU_FAIL_THRESHOLD) {
				console.warn(
					`No mask output for ${GPU_FAIL_THRESHOLD} frames — GPU not working, switching to CPU`,
				);
				params.segmentation.delegate = "CPU";
				loadModel(params.segmentation.model, "CPU");
				// Enable auto-tune to find optimal settings for this hardware
				if (!params.autoTune.enabled) {
					params.autoTune.enabled = true;
					console.log("Auto-tune enabled to optimize for constrained hardware");
				}
			}
		}
		return prevMask;
	}

	gpuFailCount = 0; // Reset on success

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
