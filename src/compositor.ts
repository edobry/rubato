/**
 * compositor.ts — Unified WebGL rendering pipeline for 時痕 Rubato.
 *
 * This module is the final stage of the visual pipeline and determines
 * everything the viewer sees on screen. It composites four input layers
 * into a single full-screen output using a fragment shader:
 *
 *   Layer 0 (TEXTURE0) — **Fog**: A procedural noise field rendered to an
 *     offscreen FBO by fog.ts on the same WebGL context. Always visible;
 *     this is the ambient idle-state visual.
 *
 *   Layer 1 (TEXTURE1) — **Camera**: The live webcam feed, uploaded each
 *     frame from an HTMLVideoElement. Only shown when `params.camera.showFeed`
 *     is true (debug/alignment use).
 *
 *   Layer 2 (TEXTURE2) — **Mask**: Body-segmentation confidence values
 *     (one float per pixel from the BodyPix/TFLite model). Uploaded as a
 *     luminance texture (R channel = confidence 0–1).
 *
 *   Layer 3 (TEXTURE3) — **Trail / Density**: Accumulated movement history.
 *     Can arrive as either:
 *       - `Float32Array` (CPU path): uploaded to a managed WebGLTexture each frame.
 *       - `WebGLTexture` (GPU FBO path): bound directly, no upload needed.
 *     In default mode, the R channel modulates fog brightness. In imprint mode,
 *     the G channel (density) illuminates the fog from within.
 *
 * Coordinate system:
 *   The compositor renders a full-screen quad in clip space (−1 to +1).
 *   Camera/mask/trail textures use a shared crop transform (`u_cropOffset`,
 *   `u_cropScale`) computed by `computeCropUV()` in renderer.ts, which maps
 *   the camera's native resolution to the display aspect ratio with optional
 *   mirroring. The fog texture is sampled without cropping since it is
 *   rendered at display resolution.
 *
 * Lifecycle:
 *   1. `initCompositor()` — creates the canvas, compiles the shader, allocates
 *      textures with 1×1 placeholders, binds texture units, and wires up
 *      WebGL context-loss recovery for unattended gallery operation.
 *   2. `resizeCompositor()` — called on window resize to sync canvas/viewport.
 *   3. `compositeFrame()` — called once per animation frame to upload textures,
 *      set uniforms from the live `params` object, and draw the quad.
 *
 * This module owns no rendering logic itself — all blending decisions live
 * in the fragment shader (composite.frag.glsl). This file is purely
 * responsible for texture management and uniform plumbing.
 */

import { params } from "./params";
import { computeCropUV } from "./renderer";
import compFragSrc from "./shaders/composite.frag.glsl";
import compVertSrc from "./shaders/composite.vert.glsl";
import {
	createProgram,
	createTexture,
	uploadFloatTexture,
	uploadVideoTexture,
} from "./webgl-utils";

// --- Module state ---
// The compositor owns the primary WebGL context. Fog rendering shares this
// context via getCompositorGl(), writing to an offscreen FBO whose texture
// is passed back into compositeFrame() as `fogTex`.
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let canvas: HTMLCanvasElement | null = null;

// Managed textures — fog texture is external (rendered by fog.ts into an FBO
// on this same GL context), so it is received as a parameter, not stored here.
let cameraTexture: WebGLTexture | null = null;
let quadBuffer: WebGLBuffer | null = null;
let aPosLocation = -1;
let maskTexture: WebGLTexture | null = null;
let trailTexture: WebGLTexture | null = null;

// Lazily-cached uniform locations, keyed by GLSL uniform name.
const uniforms: Record<string, WebGLUniformLocation | null> = {};

/** Convert a CSS hex color (e.g. "#ff8800") to normalized [0–1] RGB triple for GLSL. */
function hexToRgbNorm(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Look up (and cache) a uniform location by name. Safe to call every frame. */
function getUniform(name: string): WebGLUniformLocation | null {
	if (!(name in uniforms)) {
		uniforms[name] = gl!.getUniformLocation(program!, name);
	}
	return uniforms[name] ?? null;
}

/**
 * Initialize the unified WebGL compositor.
 *
 * Creates a full-screen canvas, compiles the composite shader, allocates
 * a full-screen quad VBO, and creates three managed textures (camera, mask,
 * trail) with 1×1 placeholder data so they are valid before the first real
 * upload. Texture unit assignments are fixed:
 *   - Unit 0: fog   (bound externally each frame)
 *   - Unit 1: camera
 *   - Unit 2: mask
 *   - Unit 3: trail
 *
 * Also registers WebGL context-loss/restore handlers so the installation
 * can recover automatically during unattended gallery operation.
 *
 * @returns The canvas element to insert into the DOM, or `null` on failure.
 */
export function initCompositor(): HTMLCanvasElement | null {
	canvas = document.createElement("canvas");
	canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%";

	gl = canvas.getContext("webgl", { alpha: false, premultipliedAlpha: false });
	if (!gl) {
		console.error("WebGL not available for compositor");
		return null;
	}

	try {
		program = createProgram(gl, compVertSrc, compFragSrc);
	} catch (err) {
		console.error("Compositor shader compilation failed:", err);
		return null;
	}

	gl.useProgram(program);

	// Full-screen quad
	const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
	quadBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	aPosLocation = gl.getAttribLocation(program, "a_position");

	// Create textures with 1x1 placeholder data so they're renderable
	// before the first real upload (avoids NPOT warnings on Pi)
	const placeholder = new Uint8Array([0, 0, 0, 255]);
	cameraTexture = createTexture(gl);
	gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		1,
		1,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		placeholder,
	);

	maskTexture = createTexture(gl);
	gl.bindTexture(gl.TEXTURE_2D, maskTexture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		1,
		1,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		placeholder,
	);

	trailTexture = createTexture(gl);
	gl.bindTexture(gl.TEXTURE_2D, trailTexture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		1,
		1,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		placeholder,
	);

	// Bind texture units
	gl.uniform1i(getUniform("u_fog"), 0);
	gl.uniform1i(getUniform("u_camera"), 1);
	gl.uniform1i(getUniform("u_mask"), 2);
	gl.uniform1i(getUniform("u_trail"), 3);

	// WebGL context loss recovery for unattended gallery operation
	canvas.addEventListener("webglcontextlost", (e) => {
		e.preventDefault();
		console.warn("[compositor] WebGL context lost, awaiting restore...");
	});
	canvas.addEventListener("webglcontextrestored", () => {
		console.log("[compositor] WebGL context restored, reinitializing...");
		// Re-run init to rebuild shaders, buffers, and textures
		const restored = initCompositor();
		if (restored) {
			resizeCompositor();
			console.log("[compositor] Reinitialized after context restore");
		} else {
			console.error(
				"[compositor] Failed to reinitialize after context restore",
			);
		}
	});

	return canvas;
}

/** Get the compositor's WebGL context for shared use (e.g. fog rendering). */
export function getCompositorGl(): WebGLRenderingContext | null {
	return gl;
}

/** Sync the compositor canvas and GL viewport to the current window size. */
export function resizeCompositor(): void {
	if (!canvas || !gl) return;
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	gl.viewport(0, 0, canvas.width, canvas.height);
}

/**
 * Render a single composited frame to the screen.
 *
 * This is called once per animation frame by the main loop. It:
 *   1. Unbinds any FBO left from prior render passes (fog/trail) so we draw
 *      to the default framebuffer (the screen).
 *   2. Re-binds the compositor's own vertex buffer and shader program (other
 *      passes may have switched these).
 *   3. Binds/uploads all four input textures to their fixed texture units.
 *   4. Sets all shader uniforms from the live `params` object.
 *   5. Draws a full-screen quad (TRIANGLE_STRIP, 4 vertices).
 *
 * @param video     - The live camera feed. Its current frame is uploaded to
 *                    TEXTURE1 each call via `texImage2D`.
 * @param fogTex    - The fog layer texture, rendered by fog.ts into an FBO on
 *                    this same GL context. Bound to TEXTURE0.
 * @param mask      - Body-segmentation confidence map (one float per pixel,
 *                    0 = background, 1 = person). Uploaded as a luminance
 *                    texture to TEXTURE2. May be null before segmentation starts.
 * @param trail     - Accumulated movement trace. Accepts two forms:
 *                      - `Float32Array`: CPU-computed trail, uploaded each frame.
 *                      - `WebGLTexture`: GPU trail FBO, bound directly (no upload).
 *                    Bound to TEXTURE3. May be null if trail is disabled.
 * @param maskW     - Width of the mask/trail data in pixels.
 * @param maskH     - Height of the mask/trail data in pixels.
 */
export function compositeFrame(
	video: HTMLVideoElement,
	fogTex: WebGLTexture | null,
	mask: Float32Array | null,
	trail: Float32Array | WebGLTexture | null,
	maskW: number,
	maskH: number,
): void {
	if (!gl || !program || !canvas || !quadBuffer) return;

	// Unbind any FBO left from fog/trail render pass — render to screen
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, canvas.width, canvas.height);

	gl.useProgram(program);

	// Rebind our vertex buffer (fog/trail render passes use their own)
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.enableVertexAttribArray(aPosLocation);
	gl.vertexAttribPointer(aPosLocation, 2, gl.FLOAT, false, 0, 0);

	// Bind fog texture (rendered by fog pass into FBO on same GL context)
	gl.activeTexture(gl.TEXTURE0);
	if (fogTex) {
		gl.bindTexture(gl.TEXTURE_2D, fogTex);
	}

	// Upload camera frame as texture
	gl.activeTexture(gl.TEXTURE1);
	uploadVideoTexture(gl, cameraTexture!, video);

	// Upload mask as luminance texture
	gl.activeTexture(gl.TEXTURE2);
	if (mask && maskW > 0 && maskH > 0) {
		uploadFloatTexture(gl, maskTexture!, mask, maskW, maskH);
	} else {
		gl.bindTexture(gl.TEXTURE_2D, maskTexture!);
	}

	// Bind trail: either a GPU texture (WebGLTexture) or CPU data (Float32Array)
	gl.activeTexture(gl.TEXTURE3);
	if (trail instanceof WebGLTexture) {
		// GPU trail — already on the same GL context, just bind it
		gl.bindTexture(gl.TEXTURE_2D, trail);
	} else if (trail && maskW > 0 && maskH > 0) {
		uploadFloatTexture(gl, trailTexture!, trail, maskW, maskH);
	} else {
		gl.bindTexture(gl.TEXTURE_2D, trailTexture!);
	}

	// --- Set uniforms ---
	// Crop transform: maps the camera's native aspect ratio to the display,
	// producing UV offset/scale values that the shader uses to sample
	// camera, mask, and trail textures in the correct region.
	const { width: displayW, height: displayH } = canvas;
	const crop = computeCropUV(
		video.videoWidth,
		video.videoHeight,
		displayW,
		displayH,
	);

	gl.uniform2f(getUniform("u_cropOffset"), crop.uvOffset[0], crop.uvOffset[1]);
	gl.uniform2f(getUniform("u_cropScale"), crop.uvScale[0], crop.uvScale[1]);
	gl.uniform1f(getUniform("u_mirror"), crop.mirror ? 1.0 : 0.0);
	gl.uniform1f(getUniform("u_showFeed"), params.camera.showFeed ? 1.0 : 0.0);
	gl.uniform1f(
		getUniform("u_showOverlay"),
		params.overlay.showOverlay ? 1.0 : 0.0,
	);
	gl.uniform1f(getUniform("u_opacity"), params.overlay.opacity);
	const [r, g, b] = hexToRgbNorm(params.overlay.color);
	gl.uniform3f(getUniform("u_overlayColor"), r, g, b);
	gl.uniform1f(getUniform("u_time"), performance.now() / 1000);

	// Map the color mode name to an integer code for the shader's
	// computeOverlayColor() switch. Must stay in sync with composite.frag.glsl.
	const colorModeMap: Record<string, number> = {
		solid: 0,
		rainbow: 1,
		gradient: 2,
		contour: 3,
		invert: 4,
		aura: 5,
	};
	gl.uniform1f(
		getUniform("u_colorMode"),
		colorModeMap[params.overlay.colorMode] ?? 0,
	);
	// u_cameraFill: 0 = camera visible only where mask detects a person,
	// 1 = camera fills the entire frame (debug). Forced to 0 when feed is off.
	gl.uniform1f(
		getUniform("u_cameraFill"),
		params.camera.showFeed ? params.camera.fillAmount : 0,
	);
	// Fog interaction uniforms:
	// - u_fogMaskStrength: how much the body silhouette parts/clears the fog (0–1)
	// - u_fogTrailStrength: how much accumulated trails modulate fog brightness (0–1)
	// - u_fogMode: 0 = classic (bright fog, silhouette darkens), 1 = shadow (dark fog, silhouette lightens)
	gl.uniform1f(getUniform("u_fogMaskStrength"), params.fog.maskInteraction);
	gl.uniform1f(getUniform("u_fogTrailStrength"), params.fog.trailInteraction);
	gl.uniform1f(
		getUniform("u_fogMode"),
		params.fog.mode === "shadow" ? 1.0 : 0.0,
	);
	// u_imprint: switches the shader to imprint mode, where the trail's G channel
	// (density) illuminates the fog instead of the R channel modulating brightness.
	// The body silhouette is never shown in this mode.
	gl.uniform1f(
		getUniform("u_imprint"),
		params.overlay.visualize === "imprint" ? 1.0 : 0.0,
	);
	// u_blur: Gaussian blur radius applied to mask/trail in the shader (0 = off).
	// u_maskTexelSize: reciprocal mask dimensions, used by the shader's blur kernel
	// and the contour color mode's edge-detection gradient sampling.
	gl.uniform1f(getUniform("u_blur"), params.overlay.blur);
	gl.uniform2f(
		getUniform("u_maskTexelSize"),
		maskW > 0 ? 1.0 / maskW : 0,
		maskH > 0 ? 1.0 / maskH : 0,
	);

	// Draw
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
