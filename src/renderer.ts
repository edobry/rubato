/**
 * Canvas renderer.
 * Draws camera frames to a full-screen canvas, cropping to match display aspect ratio.
 */

import { computeMaskCrop, maskToUV } from "./coords";
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
	const crop = computeMaskCrop(
		{ width: videoW, height: videoH },
		{ width: displayW, height: displayH },
		params.camera.fillAmount,
	);
	return maskToUV(crop, { width: videoW, height: videoH }, true);
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

	const crop = computeMaskCrop(
		{ width: video.videoWidth, height: video.videoHeight },
		{ width, height },
		params.camera.fillAmount,
	);

	// Mirror horizontally
	ctx.save();
	ctx.translate(width, 0);
	ctx.scale(-1, 1);
	ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
	ctx.restore();
}
