/**
 * Typed coordinate spaces.
 *
 * Prevents mixing pixels from different coordinate spaces at the type level.
 * Three spaces exist in the pipeline:
 *
 * - MaskSpace: camera/segmentation resolution (e.g. 1280×720)
 * - RenderSpace: downsampled overlay resolution (maskW/ds × maskH/ds)
 * - DisplaySpace: screen/canvas resolution (window.innerWidth × innerHeight)
 *
 * Each space has a Rect type for crop regions and conversion functions.
 */

/** A rectangle in a specific coordinate space. */
export interface Rect<_Space extends string> {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type MaskRect = Rect<"mask">;
export type RenderRect = Rect<"render">;
export type DisplayRect = Rect<"display">;

/** Dimensions of a coordinate space. */
export interface Dimensions {
	width: number;
	height: number;
}

/**
 * Compute the crop rect in mask space that fills the display
 * without letterboxing or stretching, respecting fillAmount.
 */
export function computeMaskCrop(
	mask: Dimensions,
	display: Dimensions,
	fillAmount: number,
): MaskRect {
	const displayAspect = display.width / display.height;
	const maskAspect = mask.width / mask.height;

	// "Fill": zoom in to eliminate black bars
	let fillW: number;
	let fillH: number;
	if (maskAspect > displayAspect) {
		fillH = mask.height;
		fillW = mask.height * displayAspect;
	} else {
		fillW = mask.width;
		fillH = mask.width / displayAspect;
	}

	// "Fit": show full frame (may have black bars)
	let fitW: number;
	let fitH: number;
	if (maskAspect > displayAspect) {
		fitW = mask.width;
		fitH = mask.width / displayAspect;
	} else {
		fitH = mask.height;
		fitW = mask.height * displayAspect;
	}

	// Blend between fit and fill
	const w = fitW + (fillW - fitW) * fillAmount;
	const h = fitH + (fillH - fitH) * fillAmount;
	const x = (mask.width - w) / 2;
	const y = (mask.height - h) / 2;

	return { x, y, w, h };
}

/**
 * Compute the display-space rectangle where the camera content actually appears.
 *
 * When fillAmount < 1 and the camera and display aspect ratios differ,
 * the mask-space crop can extend beyond the actual video frame. The browser's
 * drawImage clips the source to valid bounds, so the camera content occupies
 * only a portion of the display. This function returns that portion.
 *
 * Returns {x, y, w, h} in display pixels. When the camera fills the whole
 * display, this returns {x:0, y:0, w:displayW, h:displayH}.
 */
export function computeDisplayBounds(
	mask: Dimensions,
	display: Dimensions,
	fillAmount: number,
): DisplayRect {
	const crop = computeMaskCrop(mask, display, fillAmount);

	// Clamp the crop to the valid mask region
	const clampedX = Math.max(0, crop.x);
	const clampedY = Math.max(0, crop.y);
	const clampedRight = Math.min(mask.width, crop.x + crop.w);
	const clampedBottom = Math.min(mask.height, crop.y + crop.h);

	// Map clamped source bounds to display space
	// drawImage maps [crop.x .. crop.x+crop.w] -> [0 .. displayW]
	const scaleX = display.width / crop.w;
	const scaleY = display.height / crop.h;

	const dx = (clampedX - crop.x) * scaleX;
	const dy = (clampedY - crop.y) * scaleY;
	const dw = (clampedRight - clampedX) * scaleX;
	const dh = (clampedBottom - clampedY) * scaleY;

	return { x: dx, y: dy, w: dw, h: dh };
}

/**
 * Convert a mask-space rect to render-space (downsampled) rect.
 * Snaps to integer pixel boundaries to prevent sub-pixel jitter.
 */
export function maskToRender(
	rect: MaskRect,
	downsample: number,
	renderBounds: Dimensions,
): RenderRect {
	const x = Math.floor(rect.x / downsample);
	const y = Math.floor(rect.y / downsample);
	const w = Math.min(Math.ceil(rect.w / downsample), renderBounds.width - x);
	const h = Math.min(Math.ceil(rect.h / downsample), renderBounds.height - y);
	return { x, y, w, h };
}

/**
 * Convert a mask-space rect to UV-space (0-1) for shader uniforms.
 * Optionally mirrors horizontally.
 */
export function maskToUV(
	rect: MaskRect,
	mask: Dimensions,
	mirror: boolean,
): { uvOffset: [number, number]; uvScale: [number, number]; mirror: boolean } {
	const uvOffset: [number, number] = [
		rect.x / mask.width,
		rect.y / mask.height,
	];
	const uvScale: [number, number] = [rect.w / mask.width, rect.h / mask.height];
	return { uvOffset, uvScale, mirror };
}
