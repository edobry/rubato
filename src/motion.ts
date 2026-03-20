/**
 * Motion detection module.
 * Compares consecutive raw segmentation masks to identify which pixels
 * of the silhouette are moving vs still.
 *
 * Trail accumulation runs on the GPU via a ping-pong FBO when a shared
 * WebGL context is provided (unified pipeline). Falls back to CPU
 * Float32Array accumulation for the legacy pipeline.
 */

import { params } from "./params";
import trailFragSrc from "./shaders/trail.frag.glsl";
import trailVertSrc from "./shaders/trail.vert.glsl";
import {
	createFramebuffer,
	createProgram,
	createTexture,
	uploadFloatTexture,
} from "./webgl-utils";

let prevRawMask: Float32Array | null = null;

// CPU trail buffer — used only in legacy (non-unified) mode
let trailBuffer: Float32Array | null = null;

// GPU trail state — used when initGpuTrail() has been called
let gl: WebGLRenderingContext | null = null;
let trailProgram: WebGLProgram | null = null;
let quadBuffer: WebGLBuffer | null = null;
let aPosLocation = -1;

// Ping-pong FBOs: write to fboA while reading fboTexB, then swap
let fboTexA: WebGLTexture | null = null;
let fboTexB: WebGLTexture | null = null;
let fboA: WebGLFramebuffer | null = null;
let fboB: WebGLFramebuffer | null = null;
let fboWidth = 0;
let fboHeight = 0;
// Which FBO is the "current" output? true = A is output, false = B is output
let pingPongState = true;

// Motion map texture — uploaded each frame
let motionTexture: WebGLTexture | null = null;

// Uniform locations
let uPrevTrail: WebGLUniformLocation | null = null;
let uMotion: WebGLUniformLocation | null = null;
let uDeposition: WebGLUniformLocation | null = null;
let uDecay: WebGLUniformLocation | null = null;

/**
 * Initialize the GPU trail accumulator on a shared WebGL context.
 * Call this once during startup (unified pipeline only).
 */
export function initGpuTrail(sharedGl: WebGLRenderingContext): void {
	gl = sharedGl;

	try {
		trailProgram = createProgram(gl, trailVertSrc, trailFragSrc);
	} catch (err) {
		console.error("Trail shader compilation failed:", err);
		gl = null;
		return;
	}

	gl.useProgram(trailProgram);

	// Full-screen quad (shared geometry)
	const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
	quadBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	aPosLocation = gl.getAttribLocation(trailProgram, "a_position");

	// Uniform locations
	uPrevTrail = gl.getUniformLocation(trailProgram, "u_prevTrail");
	uMotion = gl.getUniformLocation(trailProgram, "u_motion");
	uDeposition = gl.getUniformLocation(trailProgram, "u_deposition");
	uDecay = gl.getUniformLocation(trailProgram, "u_decay");

	// Motion map texture — allocated once, resized as needed
	motionTexture = createTexture(gl);
}

/** Whether the GPU trail path is active. */
export function isGpuTrailActive(): boolean {
	return gl !== null && trailProgram !== null;
}

/**
 * Ensure the ping-pong FBOs are allocated at the right size.
 * Reallocates if the mask dimensions change (e.g. camera resolution switch).
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
 * Run one GPU trail accumulation step.
 * Reads the motion map, blends with the previous trail, writes to the output FBO.
 * Returns the trail texture for the compositor to sample directly.
 */
export function updateGpuTrail(
	motionMap: Float32Array,
	w: number,
	h: number,
): WebGLTexture | null {
	if (!gl || !trailProgram || !quadBuffer || !motionTexture) return null;

	ensureFBOs(w, h);
	if (!fboA || !fboB || !fboTexA || !fboTexB) return null;

	// Determine which FBO to read from (previous trail) and write to (new trail)
	const readTex = pingPongState ? fboTexB : fboTexA;
	const writeFbo = pingPongState ? fboA : fboB;
	const outputTex = pingPongState ? fboTexA : fboTexB;

	// Save current GL state we'll modify
	gl.useProgram(trailProgram);

	// Bind our vertex buffer
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.enableVertexAttribArray(aPosLocation);
	gl.vertexAttribPointer(aPosLocation, 2, gl.FLOAT, false, 0, 0);

	// Upload motion map to texture
	gl.activeTexture(gl.TEXTURE0);
	uploadFloatTexture(gl, motionTexture, motionMap, w, h);
	gl.uniform1i(uMotion, 0);

	// Bind previous trail as input
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, readTex);
	gl.uniform1i(uPrevTrail, 1);

	// Set uniforms
	gl.uniform1f(uDeposition, params.motion.deposition);
	gl.uniform1f(uDecay, params.motion.decay);

	// Render into the target FBO
	gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
	gl.viewport(0, 0, w, h);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

	// Restore default framebuffer
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	// Swap ping-pong
	pingPongState = !pingPongState;

	return outputTex;
}

/** Get the current trail texture without running an update (for frames where motion isn't recomputed). */
export function getGpuTrailTexture(): WebGLTexture | null {
	// The last written texture is the current output
	if (!fboTexA || !fboTexB) return null;
	// After updateGpuTrail, pingPongState has been flipped, so the *previous*
	// outputTex is at the opposite state.
	return pingPongState ? fboTexB : fboTexA;
}

/** Reset motion detection state. Call when switching presets or visualization modes. */
export function resetMotion(): void {
	prevRawMask = null;
	trailBuffer = null;

	// Clear GPU trail FBOs by deleting them — they'll be reallocated on next frame
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

/**
 * Detect motion (frame diff only).
 * Returns the raw motion map as a Float32Array.
 */
export function detectMotionMap(
	currentRaw: Float32Array,
	width: number,
	height: number,
): Float32Array {
	const pixelCount = width * height;

	if (currentRaw.length !== pixelCount) {
		return new Float32Array(pixelCount);
	}

	const motionMap = new Float32Array(pixelCount);
	const threshold = params.segmentation.motionThreshold;

	if (prevRawMask && prevRawMask.length === pixelCount) {
		for (let i = 0; i < pixelCount; i++) {
			const diff = Math.abs(currentRaw[i]! - prevRawMask[i]!);
			motionMap[i] = diff > threshold ? diff : 0;
		}
	}

	// Store current frame for next diff
	if (!prevRawMask || prevRawMask.length !== pixelCount) {
		prevRawMask = new Float32Array(pixelCount);
	}
	prevRawMask.set(currentRaw);

	return motionMap;
}

/**
 * Legacy CPU-side detect motion + trail accumulation.
 * Used by the legacy (non-unified) pipeline.
 */
export function detectMotion(
	currentRaw: Float32Array,
	width: number,
	height: number,
): { motion: Float32Array; trail: Float32Array } {
	const pixelCount = width * height;

	if (currentRaw.length !== pixelCount) {
		if (trailBuffer && trailBuffer.length === pixelCount) {
			return { motion: new Float32Array(pixelCount), trail: trailBuffer };
		}
		return {
			motion: new Float32Array(pixelCount),
			trail: new Float32Array(pixelCount),
		};
	}

	const motionMap = detectMotionMap(currentRaw, width, height);
	const deposition = params.motion.deposition;
	const decay = params.motion.decay;

	// Initialize trail buffer if needed
	if (!trailBuffer || trailBuffer.length !== pixelCount) {
		trailBuffer = new Float32Array(pixelCount);
	}

	// Accumulate motion into trail buffer + apply decay
	for (let i = 0; i < pixelCount; i++) {
		trailBuffer[i] = Math.min(1, trailBuffer[i]! + motionMap[i]! * deposition);
		trailBuffer[i] = trailBuffer[i]! * decay;
		if (trailBuffer[i]! < 0.005) trailBuffer[i] = 0;
	}

	return { motion: motionMap, trail: trailBuffer };
}
