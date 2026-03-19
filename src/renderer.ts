/**
 * Canvas renderer.
 * Draws camera frames to a full-screen canvas, cropping to match display aspect ratio.
 */

import { params } from "./params";

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
 * Compute source crop rectangle.
 * fillAmount=1.0: fill display (crop excess), fillAmount=0.0: fit display (letterbox).
 * Values in between blend the two behaviors.
 */
export function computeCrop(
	videoW: number,
	videoH: number,
	displayW: number,
	displayH: number,
): { sx: number; sy: number; sw: number; sh: number } {
	const displayAspect = displayW / displayH;
	const videoAspect = videoW / videoH;
	const fill = params.camera.fillAmount;

	// "Fill" crop: zoom in to eliminate black bars
	let fillSw: number;
	let fillSh: number;
	if (videoAspect > displayAspect) {
		fillSh = videoH;
		fillSw = videoH * displayAspect;
	} else {
		fillSw = videoW;
		fillSh = videoW / displayAspect;
	}

	// "Fit" crop: show full frame (may have black bars)
	let fitSw: number;
	let fitSh: number;
	if (videoAspect > displayAspect) {
		fitSw = videoW;
		fitSh = videoW / displayAspect;
	} else {
		fitSh = videoH;
		fitSw = videoH * displayAspect;
	}

	// Blend between fit and fill
	const sw = fitSw + (fillSw - fitSw) * fill;
	const sh = fitSh + (fillSh - fitSh) * fill;

	const sx = (videoW - sw) / 2;
	const sy = (videoH - sh) / 2;

	return { sx, sy, sw, sh };
}

/**
 * Compute crop in UV space (0–1 range) for WebGL shader use.
 * Returns uvOffset (top-left corner) and uvScale (size) of the crop region,
 * plus a mirror flag for horizontal flipping.
 *
 * In a GLSL fragment shader, sample the camera texture with:
 *   vec2 cameraUV = uvOffset + uv * uvScale;
 *   cameraUV.x = mirror ? (1.0 - cameraUV.x) : cameraUV.x;
 */
export function computeCropUV(
	videoW: number,
	videoH: number,
	displayW: number,
	displayH: number,
): { uvOffset: [number, number]; uvScale: [number, number]; mirror: boolean } {
	const { sx, sy, sw, sh } = computeCrop(videoW, videoH, displayW, displayH);
	return {
		uvOffset: [sx / videoW, sy / videoH],
		uvScale: [sw / videoW, sh / videoH],
		mirror: true,
	};
}

/**
 * Draw a single camera frame to the canvas, cropped/fitted per fillAmount.
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
