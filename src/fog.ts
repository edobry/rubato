/**
 * Fog field renderer.
 * Renders a procedural simplex noise fog on a separate WebGL canvas.
 * The fog is the idle-state visual — what viewers see before approaching.
 */

import { params } from "./params";
import fragSrc from "./shaders/fog.frag.glsl";
import vertSrc from "./shaders/fog.vert.glsl";
import { createFramebuffer, createProgram, createTexture } from "./webgl-utils";

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let canvas: HTMLCanvasElement | null = null;
let startTime = 0;

// Uniform locations
let uTime: WebGLUniformLocation | null = null;
let uSpeed: WebGLUniformLocation | null = null;
let uScale: WebGLUniformLocation | null = null;
let uDensity: WebGLUniformLocation | null = null;
let uBrightness: WebGLUniformLocation | null = null;
let uColor: WebGLUniformLocation | null = null;

// FBO path for renderFogToTexture
let fboTexture: WebGLTexture | null = null;
let fbo: WebGLFramebuffer | null = null;
let fboWidth = 0;
let fboHeight = 0;

/**
 * Initialize the fog renderer.
 *
 * When called without arguments (or with `undefined`), creates its own canvas
 * and WebGL context — the current dual-canvas behaviour.
 *
 * When called with an existing WebGLRenderingContext the fog program is built on
 * that shared context instead (for the future unified pipeline).
 *
 * Returns the canvas element to be inserted into the DOM.
 */
export function initFog(externalGl?: WebGLRenderingContext): HTMLCanvasElement {
	if (externalGl) {
		gl = externalGl;
		canvas = gl.canvas as HTMLCanvasElement;
	} else {
		canvas = document.createElement("canvas");
		canvas.style.cssText =
			"position:fixed;inset:0;width:100%;height:100%;z-index:-1";

		gl = canvas.getContext("webgl", { alpha: false });
		if (!gl) {
			console.error("WebGL not available for fog renderer");
			return canvas;
		}
	}

	try {
		program = createProgram(gl, vertSrc, fragSrc);
	} catch (err) {
		console.error("Fog shader compilation failed:", err);
		return canvas;
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

	// Get uniform locations
	uTime = gl.getUniformLocation(program, "u_time");
	uSpeed = gl.getUniformLocation(program, "u_speed");
	uScale = gl.getUniformLocation(program, "u_scale");
	uDensity = gl.getUniformLocation(program, "u_density");
	uBrightness = gl.getUniformLocation(program, "u_brightness");
	uColor = gl.getUniformLocation(program, "u_color");

	startTime = performance.now() / 1000;

	return canvas;
}

/** Resize the fog canvas to match the window. Call on window resize. */
export function resizeFog(): void {
	if (!canvas) return;
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	if (gl) {
		gl.viewport(0, 0, canvas.width, canvas.height);
	}
}

/** Set uniforms for the current frame. */
function hexToRgbNorm(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function setFogUniforms(): void {
	if (!gl || !program) return;
	const time = performance.now() / 1000 - startTime;
	gl.useProgram(program);
	gl.uniform1f(uTime, time);
	gl.uniform1f(uSpeed, params.fog.speed);
	gl.uniform1f(uScale, params.fog.scale);
	gl.uniform1f(uDensity, params.fog.density);
	gl.uniform1f(uBrightness, params.fog.brightness);
	const [r, g, b] = hexToRgbNorm(params.fog.color);
	gl.uniform3f(uColor, r, g, b);
}

/** Render one frame of the fog field directly to screen. */
export function drawFog(): void {
	if (!gl || !program) return;

	setFogUniforms();
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * Render the fog to a framebuffer texture and return the texture.
 * The returned texture can be fed into a compositing pass by the unified pipeline.
 * The texture is re-allocated whenever the canvas size changes.
 */
export function renderFogToTexture(): WebGLTexture | null {
	if (!gl || !program || !canvas) return null;

	const w = canvas.width;
	const h = canvas.height;

	// (Re-)allocate the FBO and its colour attachment when the size changes.
	if (!fboTexture || !fbo || w !== fboWidth || h !== fboHeight) {
		// Clean up previous resources
		if (fboTexture) gl.deleteTexture(fboTexture);
		if (fbo) gl.deleteFramebuffer(fbo);

		fboTexture = createTexture(gl);
		gl.bindTexture(gl.TEXTURE_2D, fboTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			w,
			h,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.bindTexture(gl.TEXTURE_2D, null);

		fbo = createFramebuffer(gl, fboTexture);
		fboWidth = w;
		fboHeight = h;
	}

	setFogUniforms();

	// Render into the FBO
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, w, h);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	// Restore default framebuffer and viewport
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, w, h);

	return fboTexture;
}
