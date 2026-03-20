/**
 * Shared message types for the segmentation Web Worker.
 * Used by both the worker script and the main-thread manager.
 */

/** Sent to the worker to initialize MediaPipe. */
export interface WorkerInitMessage {
	type: "init";
	modelUrl: string;
	wasmPath: string;
	delegate: "GPU" | "CPU";
}

/** Sent to the worker with a video frame to segment. */
export interface WorkerFrameMessage {
	type: "frame";
	bitmap: ImageBitmap;
	timestamp: number;
	threshold: number;
}

/** Union of messages the main thread sends to the worker. */
export type WorkerInboundMessage = WorkerInitMessage | WorkerFrameMessage;

/** Sent from the worker after successful initialization. */
export interface WorkerReadyMessage {
	type: "ready";
}

/** Sent from the worker with segmentation results for a frame. */
export interface WorkerResultMessage {
	type: "result";
	mask: Float32Array;
	width: number;
	height: number;
	inferenceMs: number;
}

/** Sent from the worker when an error occurs. */
export interface WorkerErrorMessage {
	type: "error";
	error: string;
}

/** Union of messages the worker sends back to the main thread. */
export type WorkerOutboundMessage =
	| WorkerReadyMessage
	| WorkerResultMessage
	| WorkerErrorMessage;

// Convenience aliases used by segmentation-async.ts
export type WorkerInMessage = WorkerInboundMessage;
export type WorkerOutMessage = WorkerOutboundMessage;
