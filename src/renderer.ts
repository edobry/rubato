/**
 * Canvas renderer utilities.
 * Provides UV crop computation for WebGL shaders.
 */

import { computeMaskCrop, maskToUV } from "./coords";
import { params } from "./params";

/**
 * Compute crop in UV space (0-1 range) for WebGL shader use.
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
