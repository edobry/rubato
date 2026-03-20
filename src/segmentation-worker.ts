/**
 * Web Worker script for MediaPipe body segmentation.
 *
 * Offloads ImageSegmenter inference from the main thread so that
 * compositing and rendering can proceed without jank.
 *
 * Usage from main thread:
 *   new Worker(new URL('./segmentation-worker.ts', import.meta.url), { type: 'module' })
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import type {
	WorkerErrorMessage,
	WorkerInboundMessage,
	WorkerReadyMessage,
	WorkerResultMessage,
} from "./worker-types";

let segmenter: ImageSegmenter | null = null;

/**
 * Post a typed message back to the main thread.
 *
 * Uses the options-bag overload of postMessage to avoid type conflicts
 * between Window.postMessage and Worker.postMessage in the DOM lib.
 */
function reply(
	msg: WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage,
	transfer?: Transferable[],
): void {
	if (transfer) {
		postMessage(msg, { transfer });
	} else {
		postMessage(msg);
	}
}

/**
 * Initialize the MediaPipe vision fileset and ImageSegmenter.
 */
async function handleInit(
	modelUrl: string,
	wasmPath: string,
	delegate: "GPU" | "CPU",
): Promise<void> {
	const vision = await FilesetResolver.forVisionTasks(wasmPath);

	segmenter = await ImageSegmenter.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath: modelUrl,
			delegate,
		},
		runningMode: "VIDEO",
		outputConfidenceMasks: true,
		outputCategoryMask: false,
	});

	reply({ type: "ready" });
}

/**
 * Run segmentation on a single video frame (ImageBitmap).
 * Applies confidence thresholding, then transfers the result buffer back.
 */
function handleFrame(
	bitmap: ImageBitmap,
	timestamp: number,
	threshold: number,
): void {
	if (!segmenter) {
		reply({ type: "error", error: "Segmenter not initialized" });
		bitmap.close();
		return;
	}

	const t0 = performance.now();

	let result: ReturnType<ImageSegmenter["segmentForVideo"]>;
	try {
		result = segmenter.segmentForVideo(bitmap, timestamp);
	} catch (err) {
		bitmap.close();
		reply({
			type: "error",
			error: `segmentForVideo failed: ${err instanceof Error ? err.message : String(err)}`,
		});
		return;
	}

	const width = bitmap.width;
	const height = bitmap.height;

	// Done with the bitmap — release GPU/CPU memory
	bitmap.close();

	const confidenceMasks = result.confidenceMasks;
	if (!confidenceMasks || confidenceMasks.length === 0) {
		reply({
			type: "error",
			error: "No confidence masks returned",
		});
		return;
	}

	const rawData = confidenceMasks[0]!.getAsFloat32Array();
	const pixelCount = width * height;

	// Create a new Float32Array with thresholding applied.
	// We must allocate a new buffer because we will transfer ownership
	// to the main thread, and the MediaPipe-internal buffer must stay intact.
	const mask = new Float32Array(pixelCount);
	for (let i = 0; i < pixelCount; i++) {
		mask[i] = rawData[i]! > threshold ? rawData[i]! : 0;
	}

	const inferenceMs = performance.now() - t0;

	// Transfer the underlying ArrayBuffer so it moves zero-copy
	reply({ type: "result", mask, width, height, inferenceMs }, [mask.buffer]);
}

/**
 * Main message handler.
 */
self.onmessage = async (e: MessageEvent<WorkerInboundMessage>) => {
	const msg = e.data;

	try {
		switch (msg.type) {
			case "init":
				await handleInit(msg.modelUrl, msg.wasmPath, msg.delegate);
				break;

			case "frame":
				handleFrame(msg.bitmap, msg.timestamp, msg.threshold);
				break;

			default:
				reply({
					type: "error",
					error: `Unknown message type: ${(msg as { type: string }).type}`,
				});
		}
	} catch (err) {
		reply({
			type: "error",
			error: err instanceof Error ? err.message : String(err),
		});
	}
};
