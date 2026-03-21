/**
 * Displacement field module.
 * Maintains a persistent displacement field driven by a velocity texture.
 * The field persists with momentum via self-advection, diffusion, and damping,
 * creating the effect of dancer movement pushing shadow fog around.
 *
 * Uses ping-pong FBOs (same pattern as motion.ts) to read the previous
 * frame's displacement while writing the new frame's output.
 */

import { params } from "./params";
import fragSrc from "./shaders/displacement.frag.glsl";
import vertSrc from "./shaders/fog.vert.glsl";
import { createFramebuffer, createProgram, createTexture } from "./webgl-utils";

// Module-level GL state
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let quadBuffer: WebGLBuffer | null = null;
let aPosLocation = -1;

// Ping-pong FBOs: write to one while reading the other, then swap
let fboTexA: WebGLTexture | null = null;
let fboTexB: WebGLTexture | null = null;
let fboA: WebGLFramebuffer | null = null;
let fboB: WebGLFramebuffer | null = null;
let fboWidth = 0;
let fboHeight = 0;
// Which FBO is the "current" output? true = A is output, false = B is output
let pingPongState = true;

// Cached uniform locations
let uPrevDisp: WebGLUniformLocation | null = null;
let uVelocity: WebGLUniformLocation | null = null;
let uDamping: WebGLUniformLocation | null = null;
let uForceScale: WebGLUniformLocation | null = null;
let uDiffusion: WebGLUniformLocation | null = null;
let uAdvection: WebGLUniformLocation | null = null;
let uCreepSpeed: WebGLUniformLocation | null = null;
let uTexelSize: WebGLUniformLocation | null = null;

/**
 * Initialize the displacement field on a shared WebGL context.
 * Call once during startup (unified pipeline only).
 */
export function initDisplacement(sharedGl: WebGLRenderingContext): void {
	gl = sharedGl;

	try {
		program = createProgram(gl, vertSrc, fragSrc);
	} catch (err) {
		console.error("Displacement shader compilation failed:", err);
		gl = null;
		return;
	}

	gl.useProgram(program);

	// Full-screen quad (shared geometry)
	const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
	quadBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	aPosLocation = gl.getAttribLocation(program, "a_position");

	// Cache uniform locations
	uPrevDisp = gl.getUniformLocation(program, "u_prevDisp");
	uVelocity = gl.getUniformLocation(program, "u_velocity");
	uDamping = gl.getUniformLocation(program, "u_damping");
	uForceScale = gl.getUniformLocation(program, "u_forceScale");
	uDiffusion = gl.getUniformLocation(program, "u_diffusion");
	uAdvection = gl.getUniformLocation(program, "u_advection");
	uCreepSpeed = gl.getUniformLocation(program, "u_creepSpeed");
	uTexelSize = gl.getUniformLocation(program, "u_texelSize");
}

/**
 * Ensure the ping-pong FBOs are allocated at the right size.
 * Reallocates if the resolution changes.
 */
function ensureFBOs(w: number, h: number): void {
	if (!gl) return;
	if (fboTexA && fboTexB && fboWidth === w && fboHeight === h) return;

	// Clean up old resources
	if (fboTexA) gl.deleteTexture(fboTexA);
	if (fboTexB) gl.deleteTexture(fboTexB);
	if (fboA) gl.deleteFramebuffer(fboA);
	if (fboB) gl.deleteFramebuffer(fboB);

	// Allocate two RGBA textures for ping-pong
	fboTexA = createTexture(gl);
	gl.bindTexture(gl.TEXTURE_2D, fboTexA);
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

	fboTexB = createTexture(gl);
	gl.bindTexture(gl.TEXTURE_2D, fboTexB);
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

	fboA = createFramebuffer(gl, fboTexA);
	fboB = createFramebuffer(gl, fboTexB);

	fboWidth = w;
	fboHeight = h;
	pingPongState = true;

	gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * Run one displacement field update step.
 * Reads the velocity texture, blends with the previous displacement via
 * self-advection/diffusion/damping, writes to the output FBO.
 * Returns the displacement texture for the shadow shader to sample.
 *
 * @param velocityTex - Velocity input texture (RG, 0.5-centered)
 * @param _w - Unused (resolution comes from params.shadow.resolution)
 * @param _h - Unused (resolution comes from params.shadow.resolution)
 */
export function updateDisplacement(
	velocityTex: WebGLTexture,
	_w: number,
	_h: number,
): WebGLTexture | null {
	if (!gl || !program || !quadBuffer) return null;

	const res = params.shadow.resolution;
	ensureFBOs(res, res);
	if (!fboA || !fboB || !fboTexA || !fboTexB) return null;

	// Determine which FBO to read from (previous) and write to (new)
	const readTex = pingPongState ? fboTexB : fboTexA;
	const writeFbo = pingPongState ? fboA : fboB;
	const outputTex = pingPongState ? fboTexA : fboTexB;

	gl.useProgram(program);

	// Bind vertex buffer
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.enableVertexAttribArray(aPosLocation);
	gl.vertexAttribPointer(aPosLocation, 2, gl.FLOAT, false, 0, 0);

	// Bind velocity texture to TEXTURE0
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, velocityTex);
	gl.uniform1i(uVelocity, 0);

	// Bind previous displacement FBO texture to TEXTURE1
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, readTex);
	gl.uniform1i(uPrevDisp, 1);

	// Set uniforms from params
	gl.uniform1f(uDamping, params.shadow.damping);
	gl.uniform1f(uForceScale, params.shadow.forceScale);
	gl.uniform1f(uDiffusion, params.shadow.diffusion);
	gl.uniform1f(uAdvection, params.shadow.advection);
	gl.uniform1f(uCreepSpeed, params.shadow.creepSpeed);
	gl.uniform2f(uTexelSize, res > 0 ? 1.0 / res : 0, res > 0 ? 1.0 / res : 0);

	// Render into the target FBO
	gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
	gl.viewport(0, 0, res, res);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	// Restore default framebuffer
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	// Swap ping-pong
	pingPongState = !pingPongState;

	return outputTex;
}

/** Get the current displacement texture without running an update. */
export function getDisplacementTexture(): WebGLTexture | null {
	if (!fboTexA || !fboTexB) return null;
	// After updateDisplacement, pingPongState has been flipped, so the
	// last written texture is at the opposite state.
	return pingPongState ? fboTexB : fboTexA;
}

/** Reset displacement state. Call when switching presets or modes. */
export function resetDisplacement(): void {
	if (gl) {
		if (fboTexA) gl.deleteTexture(fboTexA);
		if (fboTexB) gl.deleteTexture(fboTexB);
		if (fboA) gl.deleteFramebuffer(fboA);
		if (fboB) gl.deleteFramebuffer(fboB);
		fboTexA = null;
		fboTexB = null;
		fboA = null;
		fboB = null;
		fboWidth = 0;
		fboHeight = 0;
		pingPongState = true;
	}
}
