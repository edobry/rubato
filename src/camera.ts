/**
 * Camera capture module.
 * Acquires video from getUserMedia and provides frames for downstream processing.
 * Supports re-acquiring the stream at a different resolution.
 */

export const CAMERA_RESOLUTIONS: Record<string, [number, number]> = {
	"720p": [1280, 720],
	"480p": [640, 480],
	"360p": [480, 360],
};

let currentVideo: HTMLVideoElement | null = null;

export async function initCamera(
	resolution = "720p",
): Promise<HTMLVideoElement> {
	// Fully tear down old video element — some browsers don't cleanly
	// re-acquire on the same element after stopping tracks
	if (currentVideo) {
		currentVideo.pause();
		if (currentVideo.srcObject instanceof MediaStream) {
			for (const track of currentVideo.srcObject.getTracks()) {
				track.stop();
			}
		}
		currentVideo.srcObject = null;
		currentVideo.load(); // Force reset
	}

	const video = currentVideo ?? document.createElement("video");
	video.playsInline = true;
	video.muted = true;

	const [width, height] = CAMERA_RESOLUTIONS[resolution] ?? [640, 480];

	const stream = await navigator.mediaDevices.getUserMedia({
		video: {
			width: { ideal: width },
			height: { ideal: height },
			facingMode: "user",
		},
		audio: false,
	});

	video.srcObject = stream;

	await new Promise<void>((resolve) => {
		video.onloadeddata = () => resolve();
	});
	await video.play();

	currentVideo = video;
	return video;
}
