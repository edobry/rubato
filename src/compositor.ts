/**
 * Unified WebGL compositor.
 * Blends fog, camera feed, segmentation mask, and trail buffer
 * in a single shader pass with per-pixel control.
 *
 * This module is opt-in via params.rendering.pipeline = "unified".
 * The legacy Canvas 2D path remains the default until this is proven.
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
	return uniforms[name];
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
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(program, "a_position");
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	// Create textures (fog texture managed externally)
	cameraTexture = createTexture(gl);
	maskTexture = createTexture(gl);
	trailTexture = createTexture(gl);

	// Bind texture units
	gl.uniform1i(getUniform("u_fog"), 0);
	gl.uniform1i(getUniform("u_camera"), 1);
	gl.uniform1i(getUniform("u_mask"), 2);
	gl.uniform1i(getUniform("u_trail"), 3);

	return canvas;
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
 */
export function compositeFrame(
	video: HTMLVideoElement,
	fogTex: WebGLTexture | null,
	mask: Float32Array | null,
	trail: Float32Array | null,
	maskW: number,
	maskH: number,
): void {
	if (!gl || !program || !canvas) return;

	gl.useProgram(program);

	// Upload fog texture (from fog render pass)
	if (fogTex) {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, fogTex);
	}

	// Upload camera frame
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, cameraTexture!);
	uploadVideoTexture(gl, cameraTexture!, video);

	// Upload mask
	if (mask && maskW > 0 && maskH > 0) {
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, maskTexture!);
		uploadFloatTexture(gl, maskTexture!, mask, maskW, maskH);
	}

	// Upload trail
	if (trail && maskW > 0 && maskH > 0) {
		gl.activeTexture(gl.TEXTURE3);
		gl.bindTexture(gl.TEXTURE_2D, trailTexture!);
		uploadFloatTexture(gl, trailTexture!, trail, maskW, maskH);
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
	gl.uniform1f(getUniform("u_fogMaskStrength"), 0.8); // TODO: make tunable
	gl.uniform1f(getUniform("u_fogTrailStrength"), 1.5); // TODO: make tunable

	// Draw
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
