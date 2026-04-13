/**
 * Shadow fog renderer.
 * Renders a dark ichor shadow field driven by the fluid density + velocity textures.
 * Mirrors the fog.ts pattern — init, crop, render-to-texture — but for
 * the shadow mode's dark fluid aesthetic.
 */

import { params } from "./params";
import vertSrc from "./shaders/fog.vert.glsl";
import fragSrc from "./shaders/shadow.frag.glsl";
import {
	createFramebuffer,
	createProgram,
	createQuadVAO,
	createTexture,
	renderPass,
} from "./webgl-utils";

let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let canvas: HTMLCanvasElement | null = null;
let startTime = 0;
let frameCounter = 0;
let vao: WebGLVertexArrayObject | null = null;

// Uniform locations
let uDensity: WebGLUniformLocation | null = null;
let uVelocity: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uNoiseScale: WebGLUniformLocation | null = null;
let uNoiseSpeed: WebGLUniformLocation | null = null;
let uNoiseAmount: WebGLUniformLocation | null = null;
let uBaseColor: WebGLUniformLocation | null = null;
let uHighlightColor: WebGLUniformLocation | null = null;
let uBaseDensity: WebGLUniformLocation | null = null;
let uCropOffset: WebGLUniformLocation | null = null;
let uCropScale: WebGLUniformLocation | null = null;

// FBO for render-to-texture
let fboTexture: WebGLTexture | null = null;
let fbo: WebGLFramebuffer | null = null;
let fboWidth = 0;
let fboHeight = 0;

// Crop bounds (same as fog)
let cropOffset: [number, number] = [0, 0];
let cropScale: [number, number] = [0, 0];

function hexToRgbNorm(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Initialize the shadow renderer on a shared WebGL context.
 * Call once during startup.
 */
export function initShadow(externalGl: WebGL2RenderingContext): void {
	gl = externalGl;
	canvas = gl.canvas as HTMLCanvasElement;

	try {
		program = createProgram(gl, vertSrc, fragSrc);
	} catch (err) {
		console.error("Shadow shader compilation failed:", err);
		return;
	}

	gl.useProgram(program);

	// Full-screen quad VAO
	vao = createQuadVAO(gl);

	// Cache uniform locations
	uDensity = gl.getUniformLocation(program, "u_density");
	uVelocity = gl.getUniformLocation(program, "u_velocity");
	uTime = gl.getUniformLocation(program, "u_time");
	uNoiseScale = gl.getUniformLocation(program, "u_noiseScale");
	uNoiseSpeed = gl.getUniformLocation(program, "u_noiseSpeed");
	uNoiseAmount = gl.getUniformLocation(program, "u_noiseAmount");
	uBaseColor = gl.getUniformLocation(program, "u_baseColor");
	uHighlightColor = gl.getUniformLocation(program, "u_highlightColor");
	uBaseDensity = gl.getUniformLocation(program, "u_baseDensity");
	uCropOffset = gl.getUniformLocation(program, "u_cropOffset");
	uCropScale = gl.getUniformLocation(program, "u_cropScale");

	startTime = performance.now() / 1000;
}

/**
 * Set the crop region for the shadow field, matching the camera's visible area.
 * offset and scale are in normalized 0-1 UV space.
 * When scale is (0,0), cropping is disabled (shadow fills the full screen).
 */
export function setShadowCrop(
	offset: [number, number],
	scale: [number, number],
): void {
	cropOffset = offset;
	cropScale = scale;
}

/**
 * Render the shadow fog to a framebuffer texture and return it.
 * The fluid density + velocity textures drive the shadow's appearance.
 * Supports fog.frameSkip for performance (reuses the FBO texture when skipping).
 */
export function renderShadowToTexture(
	densityTex: WebGLTexture | null,
	velocityTex: WebGLTexture | null,
): WebGLTexture | null {
	if (!gl || !program || !canvas) return null;

	frameCounter++;

	const scale = params.fog.renderScale;
	const w = Math.round(window.innerWidth * scale);
	const h = Math.round(window.innerHeight * scale);

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

	// Skip the actual render if frame skip is active — reuse existing FBO texture
	if (
		params.fog.frameSkip > 1 &&
		frameCounter % params.fog.frameSkip !== 0 &&
		fboTexture
	) {
		return fboTexture;
	}

	if (!vao) return fboTexture;

	renderPass(gl, program, vao, fbo, [w, h], () => {
		const time = performance.now() / 1000 - startTime;
		gl!.uniform1f(uTime, time);
		gl!.uniform1f(uNoiseScale, params.shadow.noiseScale);
		gl!.uniform1f(uNoiseSpeed, params.shadow.noiseSpeed);
		gl!.uniform1f(uNoiseAmount, params.shadow.noiseAmount);

		const [br, bg, bb] = hexToRgbNorm(params.shadow.baseColor);
		gl!.uniform3f(uBaseColor, br, bg, bb);

		const [hr, hg, hb] = hexToRgbNorm(params.shadow.highlightColor);
		gl!.uniform3f(uHighlightColor, hr, hg, hb);
		gl!.uniform1f(uBaseDensity, params.shadow.baseDensity);

		gl!.uniform2f(uCropOffset, cropOffset[0], cropOffset[1]);
		gl!.uniform2f(uCropScale, cropScale[0], cropScale[1]);

		// Bind density texture to TEXTURE0
		gl!.activeTexture(gl!.TEXTURE0);
		if (densityTex) {
			gl!.bindTexture(gl!.TEXTURE_2D, densityTex);
		}
		gl!.uniform1i(uDensity, 0);

		// Bind velocity texture to TEXTURE1
		gl!.activeTexture(gl!.TEXTURE1);
		if (velocityTex) {
			gl!.bindTexture(gl!.TEXTURE_2D, velocityTex);
		}
		gl!.uniform1i(uVelocity, 1);
	});

	return fboTexture;
}
