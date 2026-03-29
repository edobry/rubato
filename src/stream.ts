import type { WsClient } from "./ws/client.js";

interface BufferChunk {
	blob: Blob;
	timestamp: number;
}

const CHUNK_DURATION_MS = 5_000;
const MAX_CHUNKS = 36; // 3 minutes at 5s per chunk

/** Public API returned by `initStreaming`. */
export interface StreamingApi {
	/** Extract the last `durationSec` seconds from the ring buffer as a single Blob. */
	extractClip(durationSec: number): Blob | null;
}

/**
 * Initialize WebRTC streaming from the piece canvas.
 * Call this once after the compositor canvas is created and appended to the DOM.
 */
export function initStreaming(
	ws: WsClient,
	canvas: HTMLCanvasElement,
): StreamingApi {
	// Map of adminId → RTCPeerConnection for active streams
	const peers = new Map<string, RTCPeerConnection>();

	// Lazy-init the MediaStream — only capture when someone's watching
	let stream: MediaStream | null = null;

	// Ring buffer state
	let recorder: MediaRecorder | null = null;
	let ringBuffer: BufferChunk[] = [];

	function getStream(): MediaStream {
		if (!stream) {
			// 15fps is enough for a monitoring preview, keeps CPU overhead low
			stream = canvas.captureStream(15);
		}
		return stream;
	}

	function startRecording(mediaStream: MediaStream): void {
		if (recorder) return;

		// Prefer VP9 for quality, fall back to VP8
		const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
			? "video/webm;codecs=vp9"
			: "video/webm;codecs=vp8";

		recorder = new MediaRecorder(mediaStream, {
			mimeType,
			videoBitsPerSecond: 2_500_000, // 2.5 Mbps — good quality for 720p@15fps
		});

		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				ringBuffer.push({ blob: event.data, timestamp: Date.now() });
				// Trim to max size
				while (ringBuffer.length > MAX_CHUNKS) {
					ringBuffer.shift();
				}
			}
		};

		recorder.start(CHUNK_DURATION_MS);
		console.log(`[stream] Ring buffer recording started (${mimeType})`);
	}

	function stopRecording(): void {
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
			recorder = null;
			console.log("[stream] Ring buffer recording stopped");
		}
	}

	/** Extract the last `durationSec` seconds from the ring buffer as a single Blob. */
	function extractClip(durationSec: number): Blob | null {
		if (ringBuffer.length === 0) return null;

		const cutoff = Date.now() - durationSec * 1000;
		const chunks = ringBuffer
			.filter((c) => c.timestamp >= cutoff)
			.map((c) => c.blob);

		if (chunks.length === 0) return null;

		// Use the same mime type as the recorder
		const mimeType = ringBuffer[0]!.blob.type || "video/webm";
		return new Blob(chunks, { type: mimeType });
	}

	function closePeer(adminId: string): void {
		const pc = peers.get(adminId);
		if (pc) {
			pc.close();
			peers.delete(adminId);
		}
		// Stop capturing if nobody's watching
		if (peers.size === 0 && stream) {
			stopRecording();
			ringBuffer = [];
			for (const track of stream.getTracks()) track.stop();
			stream = null;
		}
	}

	ws.onStreamRequest(async (msg) => {
		const { adminId } = msg;

		// Clean up any existing peer for this admin (reconnect case)
		closePeer(adminId);

		const pc = new RTCPeerConnection({
			// On a local network / Tailscale mesh, no STUN needed.
			// Add a public STUN server as fallback for non-local setups.
			iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
		});
		peers.set(adminId, pc);

		// Add canvas stream tracks to the peer connection
		const mediaStream = getStream();
		startRecording(mediaStream);
		for (const track of mediaStream.getTracks()) {
			pc.addTrack(track, mediaStream);
		}

		// Send ICE candidates to the admin as they're discovered
		pc.onicecandidate = (event) => {
			if (event.candidate) {
				ws.sendRtcIceCandidate(adminId, event.candidate.toJSON());
			}
		};

		// Log connection state changes
		pc.onconnectionstatechange = () => {
			console.log(
				`[stream] Peer ${adminId.slice(0, 8)}… connection: ${pc.connectionState}`,
			);
			if (
				pc.connectionState === "failed" ||
				pc.connectionState === "disconnected"
			) {
				closePeer(adminId);
			}
		};

		// Create and send offer
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);
		ws.sendRtcOffer(adminId, pc.localDescription!);
	});

	ws.onRtcAnswer((msg) => {
		const pc = peers.get(msg.adminId);
		if (pc) {
			void pc.setRemoteDescription(msg.answer);
		}
	});

	ws.onRtcIceCandidate((msg) => {
		const pc = peers.get(msg.adminId);
		if (pc) {
			void pc.addIceCandidate(msg.candidate);
		}
	});

	ws.onStreamStop((msg) => {
		closePeer(msg.adminId);
	});

	ws.onClipRequest(async (msg) => {
		const clip = extractClip(msg.duration);
		if (!clip) {
			ws.sendClipResponse(msg.adminId, "empty");
			return;
		}

		try {
			const response = await fetch("/clips", {
				method: "POST",
				body: clip,
				headers: { "Content-Type": "video/webm" },
			});
			const { url } = await response.json();
			ws.sendClipResponse(msg.adminId, "ready", url);
		} catch (err) {
			console.error("[stream] Failed to upload clip:", err);
			ws.sendClipResponse(msg.adminId, "error", undefined, String(err));
		}
	});

	return { extractClip };
}
