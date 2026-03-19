/**
 * Camera capture module.
 * Acquires video from getUserMedia and provides frames for downstream processing.
 */

const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 480;

export async function initCamera(): Promise<HTMLVideoElement> {
	const video = document.createElement("video");
	video.playsInline = true;
	video.muted = true;

	const stream = await navigator.mediaDevices.getUserMedia({
		video: {
			width: { ideal: CAMERA_WIDTH },
			height: { ideal: CAMERA_HEIGHT },
			facingMode: "user",
		},
		audio: false,
	});

	video.srcObject = stream;
	await video.play();

	return video;
}
