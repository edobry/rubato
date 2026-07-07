/**
 * Segmentation pipeline state machine.
 *
 * Replaces scattered boolean flags across main.ts, segmentation-async.ts,
 * and segmentation.ts with a single explicit state machine that enforces
 * valid transitions and provides a single source of truth.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { detectDevice, isMobile } from "./device";
import { isGpuFailed, setGpuFailed } from "./gpu-flag";
import { params, SEGMENTATION_MODELS } from "./params";
import { hideStatus, showStatus } from "./status";
import { showToast } from "./toast";
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
	/**
	 * EMA estimate of segmentation results delivered per second (worker or
	 * sync). Returns 0 until a few results have arrived; decays toward 0 when
	 * results stop. Lets autotune detect when inference is the bottleneck.
	 */
	getResultRate(): number;
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

	// "auto": check if we recently failed GPU on this device
	if (isGpuFailed()) {
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
		setGpuFailed();
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
/** Consecutive worker frame errors before switching delegate / falling back. */
const WORKER_ERROR_THRESHOLD = 5;
/** Consecutive createImageBitmap failures before falling back to sync mode. */
const BITMAP_FAIL_THRESHOLD = 30;

/**
 * Reference inter-result interval for temporalSmoothing, ~30 results/s.
 * The EMA factor in params was tuned when production segmentation ran on the
 * sync path at roughly this rate, so `temporalSmoothing` is interpreted as
 * "retention per 33.3ms tick" and rescaled to the actual interval between
 * results: sEff = s^(dt / TICK). This keeps the smoothing time-constant
 * identical regardless of how fast results arrive (worker vs sync, fast vs
 * slow hardware).
 */
const SMOOTHING_TICK_MS = 1000 / 30;

/** EMA time-constant for the results-per-second estimate (~2s window). */
const RESULT_RATE_WINDOW_MS = 2000;
/** Inter-result intervals required before getResultRate() reports non-zero. */
const RESULT_RATE_MIN_SAMPLES = 3;

/** dt-normalized EMA retention: `s` per SMOOTHING_TICK_MS, rescaled to dtMs. */
function effectiveSmoothing(s: number, dtMs: number): number {
	return s ** (dtMs / SMOOTHING_TICK_MS);
}

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
	/** Delegate the current worker was successfully initialized with. */
	private workerDelegate: "GPU" | "CPU" | null = null;
	/** Consecutive worker frame errors (reset on every successful result). */
	private workerErrorStreak = 0;
	/** Consecutive createImageBitmap failures (reset on every success). */
	private bitmapFailStreak = 0;
	/**
	 * Zero-mask probe counter for the worker path (mirrors sync gpuFailCount):
	 * >= 0 while probing for silent GPU failure, -1 once a usable mask has
	 * been seen or probing is disabled.
	 */
	private workerProbeCount = -1;
	/** Guards against overlapping automatic recovery attempts. */
	private recovering = false;

	// --- Worker-path temporal smoothing ---
	/**
	 * Previous smoothed mask, private to the pipeline (never handed to
	 * consumers). Reused across results; reallocated only on dimension change.
	 */
	private workerPrevMask: Float32Array | null = null;
	/** Generation workerPrevMask was written in — stale gens never blend. */
	private workerPrevMaskGen = -1;
	/** performance.now() when workerPrevMask was written; -1 = invalid. */
	private workerPrevMaskTs = -1;

	// --- Result-rate tracking (both modes) ---
	/** performance.now() of the previous accepted result; -1 = none yet. */
	private rateLastTs = -1;
	/** EMA of the inter-result interval in ms; -1 until seeded. */
	private rateEmaIntervalMs = -1;
	/** Number of inter-result intervals observed so far. */
	private rateSampleCount = 0;

	// --- Sync state ---
	private segmenter: ImageSegmenter | null = null;
	private prevMask: Float32Array | null = null;
	/** performance.now() when prevMask was written; -1 = invalid. */
	private syncPrevMaskTs = -1;
	private prevSyncResult: {
		raw: Float32Array;
		smoothed: Float32Array;
	} | null = null;
	private gpuFailCount = 0;
	private currentModelUrl: string | null = null;
	private currentDelegate: string | null = null;

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
		this.currentDelegate = delegate;

		// Try async worker first
		try {
			await this.initWorkerWithFallback(modelUrl, delegate);
			this.state = { status: "ready", mode: "worker" };
			console.log(`segmentation ready (Web Worker, ${this.workerDelegate})`);
			showStatus(
				"Segmentation ready (worker) — stand in front of camera",
				3000,
			);
			return;
		} catch {
			console.warn(
				"Worker init failed, falling back to synchronous segmentation",
			);
			showStatus("Segmentation worker unavailable — using fallback mode", 3000);
		}

		// Fall back to synchronous
		this.state = { status: "initializing", mode: "sync" };
		try {
			await this.initSync(modelUrl, delegate);
			this.state = { status: "ready", mode: "sync" };
			console.log("segmentation ready (sync)");
			showStatus("Segmentation ready — stand in front of camera", 3000);
			showToast("Segmentation running in fallback mode", 4000);
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

	getResultRate(): number {
		if (
			this.rateSampleCount < RESULT_RATE_MIN_SAMPLES ||
			this.rateEmaIntervalMs <= 0 ||
			this.rateLastTs < 0
		) {
			return 0;
		}
		// Decay toward 0 when results stop arriving: once the gap since the
		// last result exceeds the smoothed interval, the gap dominates.
		const gap = performance.now() - this.rateLastTs;
		return 1000 / Math.max(this.rateEmaIntervalMs, gap);
	}

	/** Record an accepted result for the results/s estimate. Allocation-free. */
	private noteResult(now: number): void {
		if (this.rateLastTs >= 0) {
			const dt = now - this.rateLastTs;
			if (this.rateEmaIntervalMs < 0) {
				this.rateEmaIntervalMs = dt;
			} else {
				// dt-weighted EMA so the window is time-based, not sample-based
				const alpha = 1 - Math.exp(-dt / RESULT_RATE_WINDOW_MS);
				this.rateEmaIntervalMs += alpha * (dt - this.rateEmaIntervalMs);
			}
			this.rateSampleCount++;
		}
		this.rateLastTs = now;
	}

	/**
	 * Skip the next inter-result interval (e.g. across reinit/recovery, whose
	 * downtime would pollute the interval EMA). Keeps the smoothed estimate so
	 * autotune isn't blinded by every preset switch.
	 */
	private skipNextRateInterval(): void {
		this.rateLastTs = -1;
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
		this.skipNextRateInterval();
		this.currentModelUrl = modelUrl;
		this.currentDelegate = delegate;

		if (prevMode === "worker") {
			// Terminate old worker and re-init
			this.terminateWorker();

			try {
				await this.initWorkerWithFallback(modelUrl, delegate);
				this.state = { status: "ready", mode: "worker" };
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
		this.syncPrevMaskTs = -1;
		// Worker smoothing history is invalidated by the generation bump
		// (workerPrevMaskGen no longer matches); the buffer itself is reused.
		this.skipNextRateInterval();
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

	private initWorker(modelUrl: string, delegate: "GPU" | "CPU"): Promise<void> {
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
						if (!resolved) {
							console.error("Segmentation worker init error:", msg.error);
							reject(new Error(msg.error));
						} else {
							this.handleWorkerFrameError(msg.error);
						}
						break;
				}
			};

			this.worker.addEventListener("message", onMessage);
			this.worker.addEventListener("error", (e) => {
				console.error("Worker runtime error:", e);
				if (!resolved) {
					reject(e);
				} else {
					this.handleWorkerFrameError(e.message || "worker runtime error");
				}
			});

			const initMsg: WorkerInMessage = {
				type: "init",
				modelUrl,
				wasmPath: `${location.origin}/mediapipe/wasm`,
				delegate,
			};
			this.worker.postMessage(initMsg);
		});
	}

	/**
	 * Initialize the worker, retrying once with the CPU delegate if the GPU
	 * delegate fails. The GPU failure is only persisted when the CPU retry
	 * succeeds, so unrelated worker failures (module loading, WASM fetch)
	 * don't permanently blacklist the GPU on this device.
	 */
	private async initWorkerWithFallback(
		modelUrl: string,
		delegate: string,
	): Promise<void> {
		const resolved: "GPU" | "CPU" =
			delegate === "CPU" || (delegate === "auto" && isGpuFailed())
				? "CPU"
				: "GPU";

		try {
			await this.initWorker(modelUrl, resolved);
			this.onWorkerInitialized(resolved);
			return;
		} catch (err) {
			this.terminateWorker();
			if (resolved === "CPU") throw err;
			console.warn(
				"[pipeline] worker GPU init failed, retrying with CPU delegate:",
				err,
			);
		}

		try {
			await this.initWorker(modelUrl, "CPU");
		} catch (err) {
			this.terminateWorker();
			throw err;
		}
		// GPU init failed but CPU works — remember that on this device
		setGpuFailed();
		console.warn("[pipeline] GPU delegate unavailable — worker using CPU");
		showStatus("GPU unavailable — switched to CPU", 3000);
		showToast("GPU unavailable — switched to CPU segmentation", 4000);
		this.onWorkerInitialized("CPU");
	}

	/** Reset per-worker health tracking after a successful worker init. */
	private onWorkerInitialized(delegate: "GPU" | "CPU"): void {
		this.workerDelegate = delegate;
		this.workerBusy = false;
		this.workerErrorStreak = 0;
		this.bitmapFailStreak = 0;
		// Probe for silent GPU failure (all-zero masks) only on GPU
		this.workerProbeCount = delegate === "GPU" ? 0 : -1;
	}

	private terminateWorker(): void {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		this.workerBusy = false;
	}

	/**
	 * Handle an error reply from the worker for a single frame.
	 * Always clears workerBusy — a reply arrived, even if it's an error —
	 * so one failed frame can't deadlock frame sending forever.
	 */
	private handleWorkerFrameError(error: string): void {
		this.workerBusy = false;
		if (this.state.status === "processing") {
			this.state = { status: "ready", mode: "worker" };
		}

		this.workerErrorStreak++;
		console.error(
			`[pipeline] worker frame error (${this.workerErrorStreak} consecutive): ${error}`,
		);
		if (this.workerErrorStreak < WORKER_ERROR_THRESHOLD) return;
		this.workerErrorStreak = 0;

		if (this.workerDelegate === "GPU") {
			setGpuFailed();
			params.segmentation.delegate = "CPU";
			showStatus("GPU segmentation failing — switching to CPU", 3000);
			void this.recover(
				"worker-cpu",
				`${WORKER_ERROR_THRESHOLD} consecutive worker errors on GPU`,
			);
		} else {
			showStatus("Segmentation worker failing — switching to fallback", 3000);
			void this.recover(
				"sync",
				`${WORKER_ERROR_THRESHOLD} consecutive worker errors on CPU`,
			);
		}
	}

	/**
	 * Automatic runtime recovery: re-init the worker on the CPU delegate, or
	 * fall back to the sync main-thread pipeline. Triggered by worker error
	 * streaks, the zero-mask GPU probe, and createImageBitmap failures.
	 * Bumps the generation (like reinit) so in-flight results are discarded.
	 */
	private async recover(
		target: "worker-cpu" | "sync",
		reason: string,
	): Promise<void> {
		if (this.recovering) return;
		if (
			this.state.status === "uninitialized" ||
			this.state.status === "failed"
		) {
			return;
		}
		this.recovering = true;
		console.warn(`[pipeline] recovering (${target}): ${reason}`);

		// Invalidate in-flight frames/results, like reinit()
		this.generation++;
		this.skipNextRateInterval();
		this.state = {
			status: "reinitializing",
			mode: target === "worker-cpu" ? "worker" : "sync",
		};
		this.terminateWorker();

		const modelUrl = this.currentModelUrl;
		if (!modelUrl) {
			this.state = { status: "failed", error: "no model configured" };
			this.recovering = false;
			return;
		}

		try {
			if (target === "worker-cpu") {
				try {
					await this.initWorker(modelUrl, "CPU");
					this.onWorkerInitialized("CPU");
					this.state = { status: "ready", mode: "worker" };
					console.log("[pipeline] worker reinitialized with CPU delegate");
					showStatus("Segmentation switched to CPU", 3000);
					showToast("Segmentation switched to CPU", 4000);
					return;
				} catch (err) {
					this.terminateWorker();
					console.warn(
						"[pipeline] worker CPU re-init failed, falling back to sync:",
						err,
					);
				}
			}

			try {
				await this.initSync(modelUrl, this.currentDelegate ?? "auto");
				this.state = { status: "ready", mode: "sync" };
				console.log("[pipeline] segmentation fell back to sync mode");
				showStatus("Segmentation running in fallback mode", 3000);
				showToast("Segmentation running in fallback mode", 4000);
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				this.state = { status: "failed", error: errorMsg };
				console.error(
					"[pipeline] recovery failed, segmentation unavailable:",
					err,
				);
				showStatus("Segmentation failed", 5000);
			}
		} finally {
			this.recovering = false;
		}
	}

	private handleWorkerResult(msg: WorkerResultMessage): void {
		this.workerBusy = false;
		this.workerErrorStreak = 0;

		// Discard results from before the last reset/reinit
		if (this.workerSendGeneration !== this.generation) {
			console.log(
				`[pipeline] discarding stale result: sendGen=${this.workerSendGeneration}, gen=${this.generation}`,
			);
			return;
		}

		// Capture before the probe: probeWorkerMask can kick off recover(),
		// which bumps the generation synchronously.
		const gen = this.generation;
		const now = performance.now();
		// Before the probe, so recover()'s skipNextRateInterval() excludes the
		// recovery downtime from the rate EMA.
		this.noteResult(now);

		// Silent GPU failure detection during the initial probe window
		// (reads the raw mask, before temporal smoothing)
		if (this.workerProbeCount >= 0) {
			this.probeWorkerMask(msg.mask);
		}

		this.applyWorkerSmoothing(msg.mask, gen, now);

		// msg.mask arrived via transfer, so this thread owns it exclusively:
		// it is smoothed in place above and that same array is handed to
		// consumers. Every worker message carries a fresh Float32Array, so
		// consumers comparing mask references (main.ts new-result detection)
		// see a new object per result.
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

	/**
	 * Blend the incoming worker mask with the previous smoothed mask, in
	 * place: mask[i] = prev[i] * sEff + mask[i] * (1 - sEff), with sEff
	 * dt-normalized via effectiveSmoothing so the smoothing time-constant is
	 * independent of the result rate (identical semantics to the sync path).
	 *
	 * Buffer ownership: `mask` is the transferred worker buffer, exclusively
	 * owned by this thread — smoothing it in place costs no allocation. The
	 * running history lives in workerPrevMask, a private reused buffer that is
	 * never exposed to consumers.
	 */
	private applyWorkerSmoothing(
		mask: Float32Array,
		gen: number,
		now: number,
	): void {
		const s = params.segmentation.temporalSmoothing;
		if (s <= 0) {
			// Smoothing disabled — drop history so re-enabling starts fresh
			this.workerPrevMaskTs = -1;
			return;
		}

		const prev = this.workerPrevMask;
		const canBlend =
			prev !== null &&
			prev.length === mask.length && // dimension change → reseed
			this.workerPrevMaskGen === gen && // reset/reinit/recover → reseed
			this.workerPrevMaskTs >= 0;

		if (canBlend) {
			const sEff = effectiveSmoothing(s, now - this.workerPrevMaskTs);
			const inv = 1 - sEff;
			for (let i = 0; i < mask.length; i++) {
				mask[i] = prev[i]! * sEff + mask[i]! * inv;
			}
		}

		// Persist the smoothed mask as the new history; the buffer is kept
		// across resets and reallocated only on dimension change.
		if (!this.workerPrevMask || this.workerPrevMask.length !== mask.length) {
			this.workerPrevMask = new Float32Array(mask.length);
		}
		this.workerPrevMask.set(mask);
		this.workerPrevMaskGen = gen;
		this.workerPrevMaskTs = now;
	}

	/**
	 * Probe worker masks for silent GPU failure (mirrors the sync path's
	 * zero-mask probe in sendFrameSync). Only runs during an initial window
	 * after worker init; disabled permanently once a usable mask is seen.
	 */
	private probeWorkerMask(mask: Float32Array): void {
		let hasNonZero = false;
		for (let i = 0; i < mask.length; i += 100) {
			if (mask[i]! > 0.01) {
				hasNonZero = true;
				break;
			}
		}
		if (hasNonZero) {
			if (this.workerProbeCount > 0) {
				hideStatus();
				showStatus("Ready", 2000);
			}
			this.workerProbeCount = -1; // Probe complete — GPU confirmed
			return;
		}

		this.workerProbeCount++;

		// Only auto-switch on constrained or mobile devices (like the sync
		// path): on desktop GPUs, all-zero masks just mean no person in frame.
		const device = detectDevice();
		const canSwitch =
			this.workerDelegate === "GPU" &&
			(device.isConstrained || isMobile()) &&
			(params.segmentation.delegate === "auto" ||
				params.segmentation.delegate === "GPU");
		if (!canSwitch) {
			// Bounded window — stop scanning after a while
			if (this.workerProbeCount >= GPU_FAIL_THRESHOLD + 20) {
				this.workerProbeCount = -1;
			}
			return;
		}

		if (this.workerProbeCount < GPU_FAIL_THRESHOLD) {
			showStatus("Probing GPU... step in front of camera", 0, true);
			return;
		}

		console.warn(
			`[pipeline] no usable mask output for ${GPU_FAIL_THRESHOLD} worker frames — GPU not working, switching to CPU`,
		);
		showStatus("GPU unavailable — switched to CPU", 3000);
		setGpuFailed();
		params.segmentation.delegate = "CPU";
		if (device.isConstrained && !params.autoTune.enabled) {
			params.autoTune.enabled = true;
			console.log("Auto-tune enabled to optimize for constrained hardware");
		}
		void this.recover("worker-cpu", "all-zero masks on GPU delegate");
	}

	private sendFrameWorker(video: HTMLVideoElement, threshold: number): void {
		if (!this.worker || this.workerBusy) return;

		this.state = { status: "processing", mode: "worker" };
		this.workerBusy = true;
		this.workerSendGeneration = this.generation;
		const gen = this.generation;

		// createImageBitmap is async — fire-and-forget to avoid blocking
		createImageBitmap(video)
			.then((bitmap) => {
				// Worker replaced or generation bumped (reset/reinit/recovery)
				// while the bitmap was in flight — drop the frame.
				if (!this.worker || gen !== this.generation) {
					bitmap.close();
					return;
				}
				this.bitmapFailStreak = 0;

				const frameMsg: WorkerInMessage = {
					type: "frame",
					bitmap,
					timestamp: performance.now(),
					threshold,
				};

				this.worker.postMessage(frameMsg, [bitmap]);
			})
			.catch((err) => {
				this.workerBusy = false;
				if (this.state.status === "processing") {
					this.state = { status: "ready", mode: "worker" };
				}

				this.bitmapFailStreak++;
				if (this.bitmapFailStreak === 1) {
					console.warn(
						"[pipeline] createImageBitmap failed (suppressing repeats):",
						err,
					);
				}
				if (this.bitmapFailStreak >= BITMAP_FAIL_THRESHOLD) {
					this.bitmapFailStreak = 0;
					console.warn(
						`[pipeline] createImageBitmap failed ${BITMAP_FAIL_THRESHOLD} times in a row — worker mode unusable`,
					);
					showStatus("Frame capture unavailable — switching to fallback", 3000);
					void this.recover(
						"sync",
						`${BITMAP_FAIL_THRESHOLD} consecutive createImageBitmap failures`,
					);
				}
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
		this.syncPrevMaskTs = -1;
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

		let segResult: ReturnType<ImageSegmenter["segmentForVideo"]> | null = null;
		let confidenceMasks:
			| ReturnType<ImageSegmenter["segmentForVideo"]>["confidenceMasks"]
			| null = null;
		try {
			segResult = this.segmenter.segmentForVideo(video, performance.now());
			confidenceMasks = segResult.confidenceMasks;
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
			// Done reading rawData — free the MediaPipe-owned masks
			segResult?.close();
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
					setGpuFailed();
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

		// Done reading rawData — free the MediaPipe-owned masks. Without this
		// each frame leaks an MPMask (WebKit warns about it explicitly).
		segResult?.close();

		// Build the smoothed mask (dt-normalized EMA — identical semantics to
		// the worker path in applyWorkerSmoothing)
		const smoothedMask = new Float32Array(rawMask);
		const smooth = params.segmentation.temporalSmoothing;
		const now = performance.now();
		if (
			smooth > 0 &&
			this.prevMask &&
			this.prevMask.length === pixelCount &&
			this.syncPrevMaskTs >= 0
		) {
			const sEff = effectiveSmoothing(smooth, now - this.syncPrevMaskTs);
			const inv = 1 - sEff;
			for (let i = 0; i < pixelCount; i++) {
				smoothedMask[i] = this.prevMask[i]! * sEff + smoothedMask[i]! * inv;
			}
		}

		if (!this.prevMask || this.prevMask.length !== pixelCount) {
			this.prevMask = new Float32Array(pixelCount);
		}
		this.prevMask.set(smoothedMask);
		this.syncPrevMaskTs = now;
		this.noteResult(now);

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
	const delegate = isGpuFailed() ? "CPU" : params.segmentation.delegate;
	return { modelUrl, delegate };
}
