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
	const video = currentVideo ?? document.createElement("video");
	video.playsInline = true;
	video.muted = true;

	// Stop existing tracks before re-acquiring
	if (video.srcObject instanceof MediaStream) {
		for (const track of video.srcObject.getTracks()) {
			track.stop();
		}
	}

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
	await video.play();

	currentVideo = video;
	return video;
}
