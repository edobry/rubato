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
