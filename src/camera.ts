/**
 * Camera capture module.
 * Acquires video from getUserMedia and provides frames for downstream processing.
 * Resolution changes use applyConstraints to avoid tearing down the stream.
 */

export const CAMERA_RESOLUTIONS: Record<string, [number, number]> = {
	"720p": [1280, 720],
	"480p": [640, 480],
	"360p": [480, 360],
};

let currentVideo: HTMLVideoElement | null = null;
let currentFacingMode: "user" | "environment" = "user";

export async function initCamera(
	resolution = "720p",
): Promise<HTMLVideoElement> {
	const [width, height] = CAMERA_RESOLUTIONS[resolution] ?? [640, 480];

	// If we already have a stream, just change the resolution on the existing track
	if (currentVideo?.srcObject instanceof MediaStream) {
		const track = currentVideo.srcObject.getVideoTracks()[0];
		if (track) {
			await track.applyConstraints({
				width: { ideal: width },
				height: { ideal: height },
			});
			return currentVideo;
		}
	}

	// First-time setup
	const video = document.createElement("video");
	video.playsInline = true;
	video.muted = true;

	// getUserMedia can hang indefinitely on mobile when another tab holds
	// the camera. Race against a timeout to surface a helpful error.
	const CAMERA_TIMEOUT_MS = 5000;
	const stream = await Promise.race([
		navigator.mediaDevices.getUserMedia({
			video: {
				width: { ideal: width },
				height: { ideal: height },
				facingMode: currentFacingMode,
			},
			audio: false,
		}),
		new Promise<never>((_, reject) =>
			setTimeout(
				() =>
					reject(
						new Error(
							"Camera timed out — it may be in use by another tab or app",
						),
					),
				CAMERA_TIMEOUT_MS,
			),
		),
	]);

	video.srcObject = stream;
	await video.play();

	currentVideo = video;
	return video;
}

export async function flipCamera(
	resolution?: string,
): Promise<HTMLVideoElement> {
	// Stop all tracks on the current stream
	if (currentVideo?.srcObject instanceof MediaStream) {
		for (const track of currentVideo.srcObject.getTracks()) {
			track.stop();
		}
	}

	// Force initCamera to create a fresh stream
	currentVideo = null;

	// Toggle facing mode
	currentFacingMode = currentFacingMode === "user" ? "environment" : "user";

	return await initCamera(resolution);
}

export function getCurrentFacingMode(): "user" | "environment" {
	return currentFacingMode;
}

export async function hasMultipleCameras(): Promise<boolean> {
	const devices = await navigator.mediaDevices.enumerateDevices();
	const videoInputs = devices.filter((d) => d.kind === "videoinput");
	return videoInputs.length > 1;
}
