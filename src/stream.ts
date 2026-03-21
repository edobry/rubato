import type { WsClient } from "./ws/client.js";

/**
 * Initialize WebRTC streaming from the piece canvas.
 * Call this once after the compositor canvas is created and appended to the DOM.
 */
export function initStreaming(ws: WsClient, canvas: HTMLCanvasElement): void {
	// Map of adminId → RTCPeerConnection for active streams
	const peers = new Map<string, RTCPeerConnection>();

	// Lazy-init the MediaStream — only capture when someone's watching
	let stream: MediaStream | null = null;

	function getStream(): MediaStream {
		if (!stream) {
			// 15fps is enough for a monitoring preview, keeps CPU overhead low
			stream = canvas.captureStream(15);
		}
		return stream;
	}

	function closePeer(adminId: string): void {
		const pc = peers.get(adminId);
		if (pc) {
			pc.close();
			peers.delete(adminId);
		}
		// Stop capturing if nobody's watching
		if (peers.size === 0 && stream) {
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
}
