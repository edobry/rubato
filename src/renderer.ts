/**
 * Canvas renderer.
 * Draws camera frames to a full-screen canvas, cropping to match display aspect ratio.
 */

export function initCanvas(): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%";
	document.body.appendChild(canvas);
	return canvas;
}

export function resizeCanvas(canvas: HTMLCanvasElement): void {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
}

/**
 * Compute source crop rectangle so camera feed fills the display
 * without letterboxing or stretching.
 */
export function computeCrop(
	videoW: number,
	videoH: number,
	displayW: number,
	displayH: number,
): { sx: number; sy: number; sw: number; sh: number } {
	const displayAspect = displayW / displayH;
	const videoAspect = videoW / videoH;

	let sw: number;
	let sh: number;

	if (videoAspect > displayAspect) {
		// Video is wider than display — crop sides
		sh = videoH;
		sw = videoH * displayAspect;
	} else {
		// Video is taller than display — crop top/bottom
		sw = videoW;
		sh = videoW / displayAspect;
	}

	const sx = (videoW - sw) / 2;
	const sy = (videoH - sh) / 2;

	return { sx, sy, sw, sh };
}

/**
 * Draw a single camera frame to the canvas, cropped to fill.
 * The image is mirrored horizontally so it feels like a mirror to the viewer.
 */
export function drawFrame(
	ctx: CanvasRenderingContext2D,
	video: HTMLVideoElement,
): void {
	const { width, height } = ctx.canvas;
	if (video.videoWidth === 0 || video.videoHeight === 0) return;

	const crop = computeCrop(video.videoWidth, video.videoHeight, width, height);

	// Mirror horizontally
	ctx.save();
	ctx.translate(width, 0);
	ctx.scale(-1, 1);
	ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
	ctx.restore();
}
