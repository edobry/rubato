/**
 * Unified WebGL compositor.
 * Blends fog, camera feed, segmentation mask, and trail buffer
 * in a single shader pass with per-pixel control.
 *
 * This is the sole rendering pipeline for the application.
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

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let canvas: HTMLCanvasElement | null = null;

// Textures (fog texture comes externally from renderFogToTexture)
let cameraTexture: WebGLTexture | null = null;
let quadBuffer: WebGLBuffer | null = null;
let aPosLocation = -1;
let maskTexture: WebGLTexture | null = null;
let trailTexture: WebGLTexture | null = null;

// Uniform locations
const uniforms: Record<string, WebGLUniformLocation | null> = {};

function hexToRgbNorm(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function getUniform(name: string): WebGLUniformLocation | null {
	if (!(name in uniforms)) {
		uniforms[name] = gl!.getUniformLocation(program!, name);
	}
	return uniforms[name] ?? null;
}

/**
 * Initialize the unified compositor.
 * Returns the canvas element to insert into the DOM.
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

export function resizeCompositor(): void {
	if (!canvas || !gl) return;
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	gl.viewport(0, 0, canvas.width, canvas.height);
}

/**
 * Render a composited frame.
 * Call this instead of the legacy Canvas 2D renderFrame().
 *
 * The `trail` parameter accepts either a Float32Array (uploaded as texture,
 * legacy path) or a WebGLTexture (bound directly, GPU trail path).
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

	// Set uniforms
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

	// Map color mode string to float for GLSL
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
	gl.uniform1f(
		getUniform("u_cameraFill"),
		params.camera.showFeed ? params.camera.fillAmount : 0,
	);
	gl.uniform1f(getUniform("u_fogMaskStrength"), params.fog.maskInteraction);
	gl.uniform1f(getUniform("u_fogTrailStrength"), params.fog.trailInteraction);
	gl.uniform1f(
		getUniform("u_fogMode"),
		params.fog.mode === "shadow" ? 1.0 : 0.0,
	);
	gl.uniform1f(
		getUniform("u_imprint"),
		params.overlay.visualize === "imprint" ? 1.0 : 0.0,
	);
	gl.uniform1f(getUniform("u_blur"), params.overlay.blur);
	gl.uniform2f(
		getUniform("u_maskTexelSize"),
		maskW > 0 ? 1.0 / maskW : 0,
		maskH > 0 ? 1.0 / maskH : 0,
	);

	// Draw
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
