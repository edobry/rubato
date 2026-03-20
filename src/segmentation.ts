/**
 * Body segmentation module.
 * Wraps MediaPipe ImageSegmenter to produce per-frame person masks.
 * Supports GPU→CPU fallback for devices with limited WebGL (e.g. Raspberry Pi).
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { params, SEGMENTATION_MODELS } from "./params";
import { hideStatus, showStatus } from "./status";

let segmenter: ImageSegmenter | null = null;
let prevMask: Float32Array | null = null;
let prevResult: SegmentationResult | null = null;
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

	// "auto": check if we previously failed GPU on this device
	const gpuFailed = localStorage.getItem("rubato-gpu-failed") === "true";
	if (gpuFailed) {
		console.log("Skipping GPU probe (previously failed on this device)");
		options.baseOptions.delegate = "CPU";
		const seg = await ImageSegmenter.createFromOptions(vision, options);
		console.log("Segmentation using CPU delegate (cached)");
		return seg;
	}

	// Try GPU, fall back to CPU
	try {
		options.baseOptions.delegate = "GPU";
		const seg = await ImageSegmenter.createFromOptions(vision, options);
		console.log("Segmentation using GPU delegate");
		return seg;
	} catch {
		console.warn("GPU delegate failed, falling back to CPU");
		localStorage.setItem("rubato-gpu-failed", "true");
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
	prevResult = null;
	gpuFailCount = 0;
}

// Track consecutive frames with no mask output — signals silent GPU failure
let gpuFailCount = 0;
const GPU_FAIL_THRESHOLD = 10; // Quick detection — ~0.3s at 30fps

export async function initSegmentation(): Promise<void> {
	await loadModel(params.segmentation.model, params.segmentation.delegate);
}

/** Result of a single segmentation frame. */
export interface SegmentationResult {
	/** Thresholded confidence mask BEFORE temporal smoothing. */
	raw: Float32Array;
	/** Mask after temporal smoothing (suitable for rendering). */
	smoothed: Float32Array;
}

/**
 * Run segmentation on a video frame and return raw + smoothed person masks.
 * Both arrays contain 0–1 values (1 = person) at camera resolution.
 * The returned arrays are owned by this module — safe to hold across frames.
 */
export function segmentFrame(
	video: HTMLVideoElement,
	timestampMs: number,
): SegmentationResult | null {
	if (!segmenter) return null;

	// Hot-swap model or delegate if changed via GUI
	if (
		currentModelKey !== params.segmentation.model ||
		currentDelegate !== params.segmentation.delegate
	) {
		void loadModel(params.segmentation.model, params.segmentation.delegate);
		return prevResult;
	}

	// Simulate slow hardware for autotune testing
	const load = params.autoTune.simulatedLoad;
	if (load > 0) {
		const end = performance.now() + load;
		while (performance.now() < end) {
			// busy-wait to actually consume CPU time
		}
	}

	let confidenceMasks:
		| ReturnType<ImageSegmenter["segmentForVideo"]>["confidenceMasks"]
		| null = null;
	try {
		const result = segmenter.segmentForVideo(video, timestampMs);
		confidenceMasks = result.confidenceMasks;
	} catch (err) {
		console.warn("segmentForVideo threw:", err);
	}

	// Check for missing masks
	let rawData: Float32Array | null = null;
	const hasMasks = confidenceMasks && confidenceMasks.length > 0;
	if (hasMasks) {
		rawData = confidenceMasks![0].getAsFloat32Array();
	}

	// Silent GPU failure detection: only check during probe period (first 30 frames)
	// After that, assume GPU is working — all-zero masks just mean no person in frame
	const inProbePeriod =
		gpuFailCount >= 0 && gpuFailCount < GPU_FAIL_THRESHOLD + 20;
	let maskFailed = !hasMasks;
	if (!maskFailed && inProbePeriod && rawData) {
		// During probe: check if mask is all zeros (GPU garbage)
		let hasNonZero = false;
		for (let i = 0; i < rawData.length; i += 100) {
			if (rawData[i] > 0.01) {
				hasNonZero = true;
				break;
			}
		}
		if (!hasNonZero) maskFailed = true;
	}

	if (maskFailed) {
		if (
			params.segmentation.delegate === "auto" ||
			params.segmentation.delegate === "GPU"
		) {
			gpuFailCount++;
			// Show probe status while probing
			if (gpuFailCount > 0 && gpuFailCount < GPU_FAIL_THRESHOLD) {
				showStatus("Probing GPU... step in front of camera", 0, true);
			}
			if (gpuFailCount >= GPU_FAIL_THRESHOLD) {
				console.warn(
					`No usable mask output for ${GPU_FAIL_THRESHOLD} frames — GPU not working, switching to CPU`,
				);
				showStatus("GPU unavailable — switched to CPU", 3000);
				localStorage.setItem("rubato-gpu-failed", "true");
				params.segmentation.delegate = "CPU";
				void loadModel(params.segmentation.model, "CPU");
				if (!params.autoTune.enabled) {
					params.autoTune.enabled = true;
					console.log("Auto-tune enabled to optimize for constrained hardware");
				}
			}
		}
		return prevResult;
	}

	if (gpuFailCount >= 0) {
		// Probe just succeeded — hide the probe status after a short delay
		hideStatus();
		setTimeout(() => showStatus("Ready", 2000), 200);
	}
	gpuFailCount = -1; // Mark probe complete — GPU is confirmed working
	const maskData = rawData!;
	const pixelCount = video.videoWidth * video.videoHeight;

	// Build the raw (thresholded but unsmoothed) mask
	const rawMask = new Float32Array(pixelCount);
	const threshold = params.segmentation.confidenceThreshold;

	for (let i = 0; i < pixelCount; i++) {
		rawMask[i] = maskData[i] > threshold ? maskData[i] : 0;
	}

	// Build the smoothed mask from the raw mask
	const smoothedMask = new Float32Array(rawMask);
	const smooth = params.segmentation.temporalSmoothing;
	if (smooth > 0 && prevMask && prevMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			smoothedMask[i] = prevMask[i] * smooth + smoothedMask[i] * (1 - smooth);
		}
	}

	if (!prevMask || prevMask.length !== pixelCount) {
		prevMask = new Float32Array(pixelCount);
	}
	prevMask.set(smoothedMask);

	prevResult = { raw: rawMask, smoothed: smoothedMask };
	return prevResult;
}

export function getSegmenterResolution(video: HTMLVideoElement): {
	width: number;
	height: number;
} {
	return { width: video.videoWidth, height: video.videoHeight };
}
