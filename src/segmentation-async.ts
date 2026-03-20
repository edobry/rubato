/**
 * Async segmentation manager.
 * Runs MediaPipe inference in a Web Worker so the render loop never blocks.
 * Falls back to synchronous segmentation if workers aren't available.
 */

import type {
	WorkerInMessage,
	WorkerOutMessage,
	WorkerResultMessage,
} from "./worker-types";

let worker: Worker | null = null;
let workerAvailable = false;
let busy = false;
let latestResult: {
	mask: Float32Array;
	width: number;
	height: number;
} | null = null;
let lastInferenceMs = 0;

/**
 * Spawn the segmentation Web Worker and send the init message.
 * Resolves when the worker posts a 'ready' message.
 */
export function initSegmentationAsync(
	modelUrl: string,
	delegate: string,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		try {
			worker = new Worker(
				new URL("./segmentation-worker.ts", import.meta.url),
				{ type: "module" },
			);
		} catch (err) {
			console.warn("Failed to create segmentation worker:", err);
			workerAvailable = false;
			reject(err);
			return;
		}

		const onMessage = (e: MessageEvent<WorkerOutMessage>) => {
			const msg = e.data;

			switch (msg.type) {
				case "ready":
					workerAvailable = true;
					resolve();
					break;

				case "result":
					handleResult(msg);
					break;

				case "error":
					console.error("Segmentation worker error:", msg.error);
					// If error arrives before ready, reject the init promise
					if (!workerAvailable) {
						reject(new Error(msg.error));
					}
					break;
			}
		};

		worker.addEventListener("message", onMessage);
		worker.addEventListener("error", (e) => {
			console.error("Worker runtime error:", e);
			workerAvailable = false;
			if (!workerAvailable) {
				reject(e);
			}
		});

		// Send init message
		const resolvedDelegate: "GPU" | "CPU" = delegate === "CPU" ? "CPU" : "GPU";

		const initMsg: WorkerInMessage = {
			type: "init",
			modelUrl,
			wasmPath: "/mediapipe/wasm",
			delegate: resolvedDelegate,
		};
		worker.postMessage(initMsg);
	});
}

function handleResult(msg: WorkerResultMessage): void {
	busy = false;
	lastInferenceMs = msg.inferenceMs;
	latestResult = {
		mask: msg.mask,
		width: msg.width,
		height: msg.height,
	};
}

/**
 * Send a video frame to the worker for segmentation.
 * If the worker is still processing a previous frame, this call is a no-op
 * (natural back-pressure — frames are simply skipped).
 */
export async function sendFrame(
	video: HTMLVideoElement,
	threshold: number,
): Promise<void> {
	if (!worker || !workerAvailable || busy) return;

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(video);
	} catch (err) {
		console.warn("createImageBitmap failed:", err);
		workerAvailable = false;
		return;
	}

	busy = true;

	const frameMsg: WorkerInMessage = {
		type: "frame",
		bitmap,
		timestamp: performance.now(),
		threshold,
	};

	// Transfer the ImageBitmap to avoid copying
	worker.postMessage(frameMsg, [bitmap]);
}

/**
 * Return the most recent segmentation mask from the worker, or null if
 * no result has been received yet. Non-blocking.
 */
export function getLatestResult(): {
	mask: Float32Array;
	width: number;
	height: number;
} | null {
	return latestResult;
}

/** Last inference time in milliseconds (for performance display). */
export function getInferenceTime(): number {
	return lastInferenceMs;
}

/** Clear cached results so stale data isn't reused after a preset switch. */
export function clearLatestResult(): void {
	latestResult = null;
}

/**
 * Re-initialize the worker with a new model/delegate.
 * Terminates the existing worker and spawns a fresh one.
 */
export async function reinitWorker(
	modelUrl: string,
	delegate: string,
): Promise<void> {
	if (worker) {
		worker.terminate();
		worker = null;
	}
	workerAvailable = false;
	busy = false;
	latestResult = null;
	lastInferenceMs = 0;
	await initSegmentationAsync(modelUrl, delegate);
}

/** True if the Web Worker was successfully created and is ready. */
export function isWorkerAvailable(): boolean {
	return workerAvailable;
}
