/**
 * Canvas renderer.
 * Draws camera frames to a full-screen canvas, cropping to match display aspect ratio.
 */

import { computeDisplayBounds, computeMaskCrop, maskToUV } from "./coords";
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

/**
 * Apply a soft feathered edge where the camera content meets the fog.
 *
 * When fillAmount < 1 and aspect ratios differ, the camera occupies a subset
 * of the display. Without feathering there is a hard edge between the camera/
 * overlay content and the fog behind it. This draws gradient "erasers" on
 * each exposed edge using destination-out compositing, so the 2D canvas
 * content fades to transparent and the underlying fog shows through smoothly.
 *
 * Call this AFTER all camera + overlay drawing on the 2D canvas.
 */
export function applyEdgeFeather(
	ctx: CanvasRenderingContext2D,
	videoW: number,
	videoH: number,
): void {
	const feather = params.camera.edgeFeather;
	if (feather <= 0) return;

	const { width, height } = ctx.canvas;

	const bounds = computeDisplayBounds(
		{ width: videoW, height: videoH },
		{ width, height },
		params.camera.fillAmount,
	);

	// Tolerance: if bounds nearly fill the display, skip feathering
	const eps = 1;
	const hasTopBar = bounds.y > eps;
	const hasBottomBar = bounds.y + bounds.h < height - eps;
	const hasLeftBar = bounds.x > eps;
	const hasRightBar = bounds.x + bounds.w < width - eps;

	if (!hasTopBar && !hasBottomBar && !hasLeftBar && !hasRightBar) return;

	ctx.save();
	ctx.globalCompositeOperation = "destination-out";

	// Top edge fade
	if (hasTopBar) {
		const grad = ctx.createLinearGradient(0, bounds.y, 0, bounds.y + feather);
		grad.addColorStop(0, "rgba(0,0,0,1)");
		grad.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, width, bounds.y + feather);
	}

	// Bottom edge fade
	if (hasBottomBar) {
		const bottomEdge = bounds.y + bounds.h;
		const grad = ctx.createLinearGradient(
			0,
			bottomEdge - feather,
			0,
			bottomEdge,
		);
		grad.addColorStop(0, "rgba(0,0,0,0)");
		grad.addColorStop(1, "rgba(0,0,0,1)");
		ctx.fillStyle = grad;
		ctx.fillRect(
			0,
			bottomEdge - feather,
			width,
			feather + (height - bottomEdge),
		);
	}

	// Left edge fade
	if (hasLeftBar) {
		const grad = ctx.createLinearGradient(bounds.x, 0, bounds.x + feather, 0);
		grad.addColorStop(0, "rgba(0,0,0,1)");
		grad.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, bounds.x + feather, height);
	}

	// Right edge fade
	if (hasRightBar) {
		const rightEdge = bounds.x + bounds.w;
		const grad = ctx.createLinearGradient(rightEdge - feather, 0, rightEdge, 0);
		grad.addColorStop(0, "rgba(0,0,0,0)");
		grad.addColorStop(1, "rgba(0,0,0,1)");
		ctx.fillStyle = grad;
		ctx.fillRect(rightEdge - feather, 0, feather + (width - rightEdge), height);
	}

	ctx.restore();
}
