/**
 * Segmentation pipeline state machine.
 *
 * Replaces scattered boolean flags across main.ts, segmentation-async.ts,
 * and segmentation.ts with a single explicit state machine that enforces
 * valid transitions and provides a single source of truth.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { detectDevice } from "./device";
import { params, SEGMENTATION_MODELS } from "./params";
import { hideStatus, showStatus } from "./status";
import type {
	WorkerInMessage,
	WorkerOutMessage,
	WorkerResultMessage,
} from "./worker-types";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type SegState =
	| { status: "uninitialized" }
	| { status: "initializing"; mode: "worker" | "sync" }
	| { status: "ready"; mode: "worker" | "sync" }
	| { status: "processing"; mode: "worker" | "sync" }
	| { status: "failed"; error: string }
	| { status: "reinitializing"; mode: "worker" | "sync" };

export interface SegmentationResult {
	mask: Float32Array;
	width: number;
	height: number;
}

export interface SegmentationPipeline {
	getState(): SegState;
	init(modelUrl: string, delegate: string): Promise<void>;
	sendFrame(video: HTMLVideoElement, threshold: number): void;
	getLatestResult(): SegmentationResult | null;
	reinit(modelUrl: string, delegate: string): Promise<void>;
	reset(): void;
}

// ---------------------------------------------------------------------------
// Sync segmentation internals (lifted from segmentation.ts)
// ---------------------------------------------------------------------------

let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null =
	null;

async function createSegmenter(
	url: string,
	delegate: string,
): Promise<ImageSegmenter> {
	if (!vision) {
		vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
	}

	const options = {
		baseOptions: {
			modelAssetPath: url,
			delegate: "GPU" as "GPU" | "CPU",
		},
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

// ---------------------------------------------------------------------------
// Pipeline implementation
// ---------------------------------------------------------------------------

const GPU_FAIL_THRESHOLD = 10;

class SegmentationPipelineImpl implements SegmentationPipeline {
	private state: SegState = { status: "uninitialized" };

	// Latest result — single source of truth
	private latestResult: SegmentationResult | null = null;

	// Generation counter: bumped on reset/reinit, stale results discarded
	private generation = 0;

	// --- Worker state ---
	private worker: Worker | null = null;
	private workerBusy = false;
	private workerSendGeneration = 0;

	// --- Sync state ---
	private segmenter: ImageSegmenter | null = null;
	private prevMask: Float32Array | null = null;
	private prevSyncResult: {
		raw: Float32Array;
		smoothed: Float32Array;
	} | null = null;
	private gpuFailCount = 0;
	private currentModelUrl: string | null = null;

	getState(): SegState {
		return this.state;
	}

	/**
	 * Initialize the segmentation pipeline.
	 * Tries Web Worker first, falls back to synchronous.
	 */
	async init(modelUrl: string, delegate: string): Promise<void> {
		if (
			this.state.status === "initializing" ||
			this.state.status === "reinitializing"
		) {
			console.warn(
				"[segmentation-state] init called while already initializing, ignoring",
			);
			return;
		}

		this.state = { status: "initializing", mode: "worker" };
		this.currentModelUrl = modelUrl;

		// Try async worker first
		try {
			await this.initWorker(modelUrl, delegate);
			this.state = { status: "ready", mode: "worker" };
			console.log("segmentation ready (Web Worker)");
			showStatus(
				"Segmentation ready (worker) — stand in front of camera",
				3000,
			);
			return;
		} catch {
			console.warn(
				"Worker init failed, falling back to synchronous segmentation",
			);
		}

		// Fall back to synchronous
		this.state = { status: "initializing", mode: "sync" };
		try {
			await this.initSync(modelUrl, delegate);
			this.state = { status: "ready", mode: "sync" };
			console.log("segmentation ready (sync)");
			showStatus("Segmentation ready — stand in front of camera", 3000);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this.state = { status: "failed", error: errorMsg };
			console.error("Segmentation failed to load:", err);
			showStatus("Segmentation failed to load", 5000);
		}
	}

	/**
	 * Send a frame for segmentation. Non-blocking in worker mode.
	 * No-op if not in a ready/processing state.
	 */
	sendFrame(video: HTMLVideoElement, threshold: number): void {
		if (this.state.status !== "ready" && this.state.status !== "processing") {
			console.warn(`[pipeline] sendFrame rejected: state=${this.state.status}`);
			return;
		}

		const mode = this.state.mode;

		if (mode === "worker") {
			this.sendFrameWorker(video, threshold);
		} else {
			this.sendFrameSync(video, threshold);
		}
	}

	getLatestResult(): SegmentationResult | null {
		return this.latestResult;
	}

	/**
	 * Re-initialize with a new model/delegate.
	 * Clears all cached state atomically, then re-initializes.
	 */
	async reinit(modelUrl: string, delegate: string): Promise<void> {
		const prevMode =
			this.state.status !== "uninitialized" && this.state.status !== "failed"
				? this.state.mode
				: "worker";

		this.state = { status: "reinitializing", mode: prevMode };
		this.generation++;
		this.latestResult = null;
		this.currentModelUrl = modelUrl;

		if (prevMode === "worker") {
			// Terminate old worker and re-init
			if (this.worker) {
				this.worker.terminate();
				this.worker = null;
			}
			this.workerBusy = false;

			try {
				await this.initWorker(modelUrl, delegate);
				this.state = { status: "ready", mode: "worker" };
				console.log("[rubato] worker re-initialized successfully");
				showStatus("Segmentation model reloaded", 2000);
				return;
			} catch {
				console.warn("Worker re-init failed, falling back to sync");
			}

			// Fall back to sync
			try {
				await this.initSync(modelUrl, delegate);
				this.state = { status: "ready", mode: "sync" };
				showStatus("Segmentation model reloaded (sync)", 2000);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				this.state = { status: "failed", error: errorMsg };
				showStatus("Segmentation model reload failed", 3000);
			}
		} else {
			// Was in sync mode — re-init sync
			try {
				await this.initSync(modelUrl, delegate);
				this.state = { status: "ready", mode: "sync" };
				showStatus("Segmentation model reloaded", 2000);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				this.state = { status: "failed", error: errorMsg };
				showStatus("Segmentation model reload failed", 3000);
			}
		}
	}

	/** Atomically clear all cached results (e.g. on preset switch). */
	reset(): void {
		this.generation++;
		this.latestResult = null;
		this.workerBusy = false;
		this.prevMask = null;
		this.prevSyncResult = null;
		// Ensure state allows new frames after reset
		if (this.state.status === "processing" || this.state.status === "ready") {
			this.state = { status: "ready", mode: this.state.mode };
		}
		console.log(
			`[pipeline] reset: gen=${this.generation}, state=${this.state.status}`,
		);
	}

	// -----------------------------------------------------------------------
	// Worker internals
	// -----------------------------------------------------------------------

	private initWorker(modelUrl: string, delegate: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			try {
				this.worker = new Worker(
					new URL("./segmentation-worker.ts", import.meta.url),
					{ type: "module" },
				);
			} catch (err) {
				console.warn("Failed to create segmentation worker:", err);
				reject(err);
				return;
			}

			let resolved = false;

			const onMessage = (e: MessageEvent<WorkerOutMessage>) => {
				const msg = e.data;

				switch (msg.type) {
					case "ready":
						resolved = true;
						resolve();
						break;

					case "result":
						this.handleWorkerResult(msg);
						break;

					case "error":
						console.error("Segmentation worker error:", msg.error);
						if (!resolved) {
							reject(new Error(msg.error));
						}
						break;
				}
			};

			this.worker.addEventListener("message", onMessage);
			this.worker.addEventListener("error", (e) => {
				console.error("Worker runtime error:", e);
				if (!resolved) {
					reject(e);
				}
			});

			const resolvedDelegate: "GPU" | "CPU" =
				delegate === "CPU" ? "CPU" : "GPU";

			const initMsg: WorkerInMessage = {
				type: "init",
				modelUrl,
				wasmPath: "/mediapipe/wasm",
				delegate: resolvedDelegate,
			};
			this.worker.postMessage(initMsg);
		});
	}

	private handleWorkerResult(msg: WorkerResultMessage): void {
		this.workerBusy = false;

		// Discard results from before the last reset/reinit
		if (this.workerSendGeneration !== this.generation) {
			console.log(
				`[pipeline] discarding stale result: sendGen=${this.workerSendGeneration}, gen=${this.generation}`,
			);
			return;
		}

		this.latestResult = {
			mask: msg.mask,
			width: msg.width,
			height: msg.height,
		};

		// Transition back to ready from processing
		if (this.state.status === "processing") {
			this.state = { status: "ready", mode: "worker" };
		}
	}

	private sendFrameWorker(video: HTMLVideoElement, threshold: number): void {
		if (!this.worker || this.workerBusy) return;

		this.state = { status: "processing", mode: "worker" };
		this.workerBusy = true;
		this.workerSendGeneration = this.generation;

		// createImageBitmap is async — fire-and-forget to avoid blocking
		createImageBitmap(video)
			.then((bitmap) => {
				if (!this.worker) return;

				const frameMsg: WorkerInMessage = {
					type: "frame",
					bitmap,
					timestamp: performance.now(),
					threshold,
				};

				this.worker.postMessage(frameMsg, [bitmap]);
			})
			.catch((err) => {
				console.warn("createImageBitmap failed:", err);
				this.workerBusy = false;
				// Worker may have been invalidated
				this.state = { status: "ready", mode: "worker" };
			});
	}

	// -----------------------------------------------------------------------
	// Sync internals
	// -----------------------------------------------------------------------

	private async initSync(modelUrl: string, delegate: string): Promise<void> {
		if (this.segmenter) {
			this.segmenter.close();
			this.segmenter = null;
		}

		this.segmenter = await createSegmenter(modelUrl, delegate);
		this.prevMask = null;
		this.prevSyncResult = null;
		this.gpuFailCount = 0;
	}

	private sendFrameSync(video: HTMLVideoElement, threshold: number): void {
		if (!this.segmenter) {
			console.warn("[pipeline] sendFrameSync: no segmenter available!");
			return;
		}

		this.state = { status: "processing", mode: "sync" };

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
			const result = this.segmenter.segmentForVideo(video, performance.now());
			confidenceMasks = result.confidenceMasks;
		} catch (err) {
			console.warn("segmentForVideo threw:", err);
		}

		// Check for missing masks
		let rawData: Float32Array | null = null;
		const hasMasks = confidenceMasks && confidenceMasks.length > 0;
		if (hasMasks) {
			rawData = confidenceMasks![0]!.getAsFloat32Array();
		}

		// Silent GPU failure detection during probe period
		const inProbePeriod =
			this.gpuFailCount >= 0 && this.gpuFailCount < GPU_FAIL_THRESHOLD + 20;
		let maskFailed = !hasMasks;
		if (!maskFailed && inProbePeriod && rawData) {
			let hasNonZero = false;
			for (let i = 0; i < rawData.length; i += 100) {
				if (rawData[i]! > 0.01) {
					hasNonZero = true;
					break;
				}
			}
			if (!hasNonZero) maskFailed = true;
		}

		if (maskFailed) {
			// Only probe for GPU failure on constrained devices (Pi etc).
			// On desktop GPUs, all-zero masks just mean no person in frame.
			const device = detectDevice();
			if (
				device.isConstrained &&
				(params.segmentation.delegate === "auto" ||
					params.segmentation.delegate === "GPU")
			) {
				this.gpuFailCount++;
				if (this.gpuFailCount > 0 && this.gpuFailCount < GPU_FAIL_THRESHOLD) {
					showStatus("Probing GPU... step in front of camera", 0, true);
				}
				if (this.gpuFailCount >= GPU_FAIL_THRESHOLD) {
					console.warn(
						`No usable mask output for ${GPU_FAIL_THRESHOLD} frames — GPU not working, switching to CPU`,
					);
					showStatus("GPU unavailable — switched to CPU", 3000);
					localStorage.setItem("rubato-gpu-failed", "true");
					params.segmentation.delegate = "CPU";
					this.state = { status: "reinitializing", mode: "sync" };
					void this.initSync(this.currentModelUrl!, "CPU");
					if (!params.autoTune.enabled) {
						params.autoTune.enabled = true;
						console.log(
							"Auto-tune enabled to optimize for constrained hardware",
						);
					}
				}
			}
			// Use previous result if available
			if (this.prevSyncResult) {
				this.latestResult = {
					mask: this.prevSyncResult.smoothed,
					width: video.videoWidth,
					height: video.videoHeight,
				};
			}
			this.state = { status: "ready", mode: "sync" };
			return;
		}

		if (this.gpuFailCount >= 0) {
			hideStatus();
			setTimeout(() => showStatus("Ready", 2000), 200);
		}
		this.gpuFailCount = -1; // Probe complete — GPU confirmed

		const maskData = rawData!;
		const pixelCount = video.videoWidth * video.videoHeight;

		// Build the raw (thresholded but unsmoothed) mask
		const rawMask = new Float32Array(pixelCount);
		for (let i = 0; i < pixelCount; i++) {
			rawMask[i] = maskData[i]! > threshold ? maskData[i]! : 0;
		}

		// Build the smoothed mask
		const smoothedMask = new Float32Array(rawMask);
		const smooth = params.segmentation.temporalSmoothing;
		if (smooth > 0 && this.prevMask && this.prevMask.length === pixelCount) {
			for (let i = 0; i < pixelCount; i++) {
				smoothedMask[i] =
					this.prevMask[i]! * smooth + smoothedMask[i]! * (1 - smooth);
			}
		}

		if (!this.prevMask || this.prevMask.length !== pixelCount) {
			this.prevMask = new Float32Array(pixelCount);
		}
		this.prevMask.set(smoothedMask);

		this.prevSyncResult = { raw: rawMask, smoothed: smoothedMask };
		this.latestResult = {
			mask: smoothedMask,
			width: video.videoWidth,
			height: video.videoHeight,
		};

		this.state = { status: "ready", mode: "sync" };
	}
}

/** Create a new segmentation pipeline instance. */
export function createSegmentationPipeline(): SegmentationPipeline {
	return new SegmentationPipelineImpl();
}

/**
 * Helper: resolve the model URL and delegate from current params,
 * respecting the GPU-failed flag.
 */
export function resolveModelConfig(): {
	modelUrl: string;
	delegate: string;
} {
	const modelUrl = (SEGMENTATION_MODELS[params.segmentation.model] ??
		SEGMENTATION_MODELS.fast)!;
	const delegate =
		localStorage.getItem("rubato-gpu-failed") === "true"
			? "CPU"
			: params.segmentation.delegate;
	return { modelUrl, delegate };
}
