/**
 * GPU 2D fluid simulation (Stable Fluids / Jos Stam).
 *
 * Implements a full Navier-Stokes solver on the GPU using WebGL1:
 *   1. Advect velocity by itself (semi-Lagrangian)
 *   2. Inject forces from dancer mask boundary + motion
 *   3. Compute divergence of velocity field
 *   4. Pressure solve via Jacobi iteration
 *   5. Subtract pressure gradient to make velocity divergence-free
 *   6. Advect density by velocity
 *
 * All fields are stored in RGBA8 textures with 0.5-centered signed encoding
 * for velocity/pressure (R=x, G=y, 0.5=zero) and direct [0,1] for density.
 *
 * Uses ping-pong FBOs (same pattern as motion.ts / displacement.ts) and
 * shares the compositor's WebGL context.
 */

import { params } from "./params";
import advectFrag from "./shaders/fluid-advect.frag.glsl";
import divergenceFrag from "./shaders/fluid-divergence.frag.glsl";
import forceFrag from "./shaders/fluid-force.frag.glsl";
import gradientFrag from "./shaders/fluid-gradient.frag.glsl";
import pressureFrag from "./shaders/fluid-pressure.frag.glsl";
import vertSrc from "./shaders/fog.vert.glsl";
import {
	createFramebuffer,
	createProgram,
	createTexture,
	uploadFloatTexture,
} from "./webgl-utils";

// ── Module-level GL state ───────────────────────────────────────────────────
let gl: WebGLRenderingContext | null = null;

// Shader programs (one per pass)
let advectProgram: WebGLProgram | null = null;
let forceProgram: WebGLProgram | null = null;
let divergenceProgram: WebGLProgram | null = null;
let pressureProgram: WebGLProgram | null = null;
let gradientProgram: WebGLProgram | null = null;

// Shared fullscreen quad
let quadBuffer: WebGLBuffer | null = null;

// ── Ping-pong FBO pairs ────────────────────────────────────────────────────

// Velocity (RG channels, 0.5-centered)
let velTexA: WebGLTexture | null = null;
let velTexB: WebGLTexture | null = null;
let velFboA: WebGLFramebuffer | null = null;
let velFboB: WebGLFramebuffer | null = null;
let velPing = true;

// Density (R channel, 0-1)
let denTexA: WebGLTexture | null = null;
let denTexB: WebGLTexture | null = null;
let denFboA: WebGLFramebuffer | null = null;
let denFboB: WebGLFramebuffer | null = null;
let denPing = true;

// Pressure (R channel, 0.5-centered)
let presTexA: WebGLTexture | null = null;
let presTexB: WebGLTexture | null = null;
let presFboA: WebGLFramebuffer | null = null;
let presFboB: WebGLFramebuffer | null = null;
let presPing = true;

// Divergence (R channel, single FBO — only written once per frame)
let divTex: WebGLTexture | null = null;
let divFbo: WebGLFramebuffer | null = null;

// Textures for mask/motion input
let maskTexture: WebGLTexture | null = null;
let motionTexture: WebGLTexture | null = null;

let fboSize = 0;

// ── Uniform location cache ─────────────────────────────────────────────────
const uniformCache = new Map<
	WebGLProgram,
	Map<string, WebGLUniformLocation | null>
>();

function getUniformLoc(
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation | null {
	let cache = uniformCache.get(program);
	if (!cache) {
		cache = new Map();
		uniformCache.set(program, cache);
	}
	if (!cache.has(name)) {
		cache.set(name, gl!.getUniformLocation(program, name));
	}
	return cache.get(name)!;
}

// ── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the fluid simulation on a shared WebGL context.
 * Call once during startup (unified pipeline only).
 */
export function initFluid(sharedGl: WebGLRenderingContext): void {
	gl = sharedGl;

	try {
		advectProgram = createProgram(gl, vertSrc, advectFrag);
		forceProgram = createProgram(gl, vertSrc, forceFrag);
		divergenceProgram = createProgram(gl, vertSrc, divergenceFrag);
		pressureProgram = createProgram(gl, vertSrc, pressureFrag);
		gradientProgram = createProgram(gl, vertSrc, gradientFrag);
	} catch (err) {
		console.error("Fluid shader compilation failed:", err);
		gl = null;
		return;
	}

	// Shared fullscreen quad geometry
	const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
	quadBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

	// Create mask and motion upload textures
	maskTexture = createTexture(gl);
	motionTexture = createTexture(gl);
}

// ── FBO management ─────────────────────────────────────────────────────────

/** Allocate a texture+FBO pair at the given resolution with initial data. */
function allocTexFbo(
	res: number,
	initData: Uint8Array | null,
): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
	const tex = createTexture(gl!);
	gl!.bindTexture(gl!.TEXTURE_2D, tex);
	gl!.texImage2D(
		gl!.TEXTURE_2D,
		0,
		gl!.RGBA,
		res,
		res,
		0,
		gl!.RGBA,
		gl!.UNSIGNED_BYTE,
		initData,
	);
	const fbo = createFramebuffer(gl!, tex);
	return { tex, fbo };
}

/** Delete a texture if non-null. */
function deleteTex(tex: WebGLTexture | null): void {
	if (tex) gl!.deleteTexture(tex);
}

/** Delete a framebuffer if non-null. */
function deleteFbo(fbo: WebGLFramebuffer | null): void {
	if (fbo) gl!.deleteFramebuffer(fbo);
}

/**
 * Ensure all ping-pong FBOs are allocated at the correct resolution.
 * Reallocates if the resolution changes.
 */
function ensureFBOs(res: number): void {
	if (!gl) return;
	if (fboSize === res && velTexA) return;

	// Clean up old resources
	deleteTex(velTexA);
	deleteTex(velTexB);
	deleteFbo(velFboA);
	deleteFbo(velFboB);
	deleteTex(denTexA);
	deleteTex(denTexB);
	deleteFbo(denFboA);
	deleteFbo(denFboB);
	deleteTex(presTexA);
	deleteTex(presTexB);
	deleteFbo(presFboA);
	deleteFbo(presFboB);
	deleteTex(divTex);
	deleteFbo(divFbo);

	const pixelCount = res * res;

	// Initialize velocity to 0.5, 0.5 (zero velocity)
	const initVel = new Uint8Array(pixelCount * 4);
	for (let i = 0; i < pixelCount; i++) {
		const j = i * 4;
		initVel[j] = 128; // R = 0 velocity X
		initVel[j + 1] = 128; // G = 0 velocity Y
		initVel[j + 2] = 0;
		initVel[j + 3] = 255;
	}

	const velA = allocTexFbo(res, initVel);
	const velB = allocTexFbo(res, initVel);
	velTexA = velA.tex;
	velFboA = velA.fbo;
	velTexB = velB.tex;
	velFboB = velB.fbo;

	// Initialize density to baseDensity
	const initDen = new Uint8Array(pixelCount * 4);
	const densityByte = Math.round(params.shadow.baseDensity * 255);
	for (let i = 0; i < pixelCount; i++) {
		const j = i * 4;
		initDen[j] = densityByte;
		initDen[j + 1] = 0;
		initDen[j + 2] = 0;
		initDen[j + 3] = 255;
	}

	const denA = allocTexFbo(res, initDen);
	const denB = allocTexFbo(res, initDen);
	denTexA = denA.tex;
	denFboA = denA.fbo;
	denTexB = denB.tex;
	denFboB = denB.fbo;

	// Initialize pressure to 0.5 (zero pressure)
	const initPres = new Uint8Array(pixelCount * 4);
	for (let i = 0; i < pixelCount; i++) {
		const j = i * 4;
		initPres[j] = 128;
		initPres[j + 1] = 0;
		initPres[j + 2] = 0;
		initPres[j + 3] = 255;
	}

	const presA = allocTexFbo(res, initPres);
	const presB = allocTexFbo(res, initPres);
	presTexA = presA.tex;
	presFboA = presA.fbo;
	presTexB = presB.tex;
	presFboB = presB.fbo;

	// Divergence — single FBO, no ping-pong needed
	const divPair = allocTexFbo(res, null);
	divTex = divPair.tex;
	divFbo = divPair.fbo;

	fboSize = res;
	velPing = true;
	denPing = true;
	presPing = true;

	gl.bindTexture(gl.TEXTURE_2D, null);
}

// ── Shader pass helper ─────────────────────────────────────────────────────

/**
 * Run a fullscreen shader pass into a target FBO.
 * Sets up the quad, calls setupUniforms for program-specific bindings,
 * then draws and unbinds.
 */
function runPass(
	program: WebGLProgram,
	targetFbo: WebGLFramebuffer,
	res: number,
	setupUniforms: () => void,
): void {
	gl!.useProgram(program);
	gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuffer);

	const aPos = gl!.getAttribLocation(program, "a_position");
	gl!.enableVertexAttribArray(aPos);
	gl!.vertexAttribPointer(aPos, 2, gl!.FLOAT, false, 0, 0);

	setupUniforms();

	gl!.bindFramebuffer(gl!.FRAMEBUFFER, targetFbo);
	gl!.viewport(0, 0, res, res);
	gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
	gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
}

// ── Main update ────────────────────────────────────────────────────────────

/**
 * Run one full fluid simulation step.
 *
 * @param mask - Segmentation mask (Float32Array, per-pixel confidence 0-1)
 * @param motion - Motion map (Float32Array, per-pixel magnitude 0-1)
 * @param maskW - Width of the mask/motion textures
 * @param maskH - Height of the mask/motion textures
 */
export function updateFluid(
	mask: Float32Array | null,
	motion: Float32Array | null,
	maskW: number,
	maskH: number,
): void {
	if (
		!gl ||
		!advectProgram ||
		!forceProgram ||
		!divergenceProgram ||
		!pressureProgram ||
		!gradientProgram
	)
		return;

	const res = params.shadow.resolution as number;
	ensureFBOs(res);

	const texelSize = 1.0 / res;
	const dt = 0.016; // ~60fps timestep

	// Upload mask and motion textures
	if (mask && maskW > 0 && maskH > 0) {
		gl.activeTexture(gl.TEXTURE4);
		uploadFloatTexture(gl, maskTexture!, mask, maskW, maskH);
	}
	if (motion && maskW > 0 && maskH > 0) {
		gl.activeTexture(gl.TEXTURE5);
		uploadFloatTexture(gl, motionTexture!, motion, maskW, maskH);
	}

	// --- Step 1: Advect velocity by itself ---
	{
		const readVel = velPing ? velTexB : velTexA;
		const writeFbo = velPing ? velFboA : velFboB;

		runPass(advectProgram, writeFbo!, res, () => {
			gl!.activeTexture(gl!.TEXTURE0);
			gl!.bindTexture(gl!.TEXTURE_2D, readVel);
			gl!.uniform1i(getUniformLoc(advectProgram!, "u_field"), 0);

			gl!.activeTexture(gl!.TEXTURE1);
			gl!.bindTexture(gl!.TEXTURE_2D, readVel);
			gl!.uniform1i(getUniformLoc(advectProgram!, "u_velocity"), 1);

			gl!.uniform1f(getUniformLoc(advectProgram!, "u_dt"), dt);
			gl!.uniform1f(
				getUniformLoc(advectProgram!, "u_dissipation"),
				params.shadow.damping,
			);
			// Velocity decays toward zero (0.5 encoded)
			gl!.uniform1f(getUniformLoc(advectProgram!, "u_source"), 0.5);
		});
		velPing = !velPing;
	}

	// --- Step 2: Inject forces from mask ---
	{
		const readVel = velPing ? velTexB : velTexA;
		const writeFbo = velPing ? velFboA : velFboB;

		runPass(forceProgram!, writeFbo!, res, () => {
			gl!.activeTexture(gl!.TEXTURE0);
			gl!.bindTexture(gl!.TEXTURE_2D, readVel);
			gl!.uniform1i(getUniformLoc(forceProgram!, "u_velocity"), 0);

			gl!.activeTexture(gl!.TEXTURE1);
			gl!.bindTexture(gl!.TEXTURE_2D, maskTexture);
			gl!.uniform1i(getUniformLoc(forceProgram!, "u_mask"), 1);

			gl!.activeTexture(gl!.TEXTURE2);
			gl!.bindTexture(gl!.TEXTURE_2D, motionTexture);
			gl!.uniform1i(getUniformLoc(forceProgram!, "u_motion"), 2);

			gl!.uniform1f(
				getUniformLoc(forceProgram!, "u_forceScale"),
				params.shadow.forceScale,
			);
			gl!.uniform1f(getUniformLoc(forceProgram!, "u_dt"), dt);
			gl!.uniform2f(
				getUniformLoc(forceProgram!, "u_maskTexelSize"),
				maskW > 0 ? 1.0 / maskW : 0,
				maskH > 0 ? 1.0 / maskH : 0,
			);
		});
		velPing = !velPing;
	}

	// --- Step 3: Compute divergence ---
	{
		const readVel = velPing ? velTexB : velTexA;

		runPass(divergenceProgram!, divFbo!, res, () => {
			gl!.activeTexture(gl!.TEXTURE0);
			gl!.bindTexture(gl!.TEXTURE_2D, readVel);
			gl!.uniform1i(getUniformLoc(divergenceProgram!, "u_velocity"), 0);
			gl!.uniform2f(
				getUniformLoc(divergenceProgram!, "u_texelSize"),
				texelSize,
				texelSize,
			);
		});
	}

	// --- Step 4: Pressure solve (Jacobi iterations) ---
	const iterations = (params.shadow.pressureIterations as number) || 20;
	for (let i = 0; i < iterations; i++) {
		const readPres = presPing ? presTexB : presTexA;
		const writeFbo = presPing ? presFboA : presFboB;

		runPass(pressureProgram!, writeFbo!, res, () => {
			gl!.activeTexture(gl!.TEXTURE0);
			gl!.bindTexture(gl!.TEXTURE_2D, readPres);
			gl!.uniform1i(getUniformLoc(pressureProgram!, "u_pressure"), 0);

			gl!.activeTexture(gl!.TEXTURE1);
			gl!.bindTexture(gl!.TEXTURE_2D, divTex);
			gl!.uniform1i(getUniformLoc(pressureProgram!, "u_divergence"), 1);

			gl!.uniform2f(
				getUniformLoc(pressureProgram!, "u_texelSize"),
				texelSize,
				texelSize,
			);
		});
		presPing = !presPing;
	}

	// --- Step 5: Subtract pressure gradient from velocity ---
	{
		const readVel = velPing ? velTexB : velTexA;
		const readPres = presPing ? presTexB : presTexA;
		const writeFbo = velPing ? velFboA : velFboB;

		runPass(gradientProgram!, writeFbo!, res, () => {
			gl!.activeTexture(gl!.TEXTURE0);
			gl!.bindTexture(gl!.TEXTURE_2D, readVel);
			gl!.uniform1i(getUniformLoc(gradientProgram!, "u_velocity"), 0);

			gl!.activeTexture(gl!.TEXTURE1);
			gl!.bindTexture(gl!.TEXTURE_2D, readPres);
			gl!.uniform1i(getUniformLoc(gradientProgram!, "u_pressure"), 1);

			gl!.uniform2f(
				getUniformLoc(gradientProgram!, "u_texelSize"),
				texelSize,
				texelSize,
			);
		});
		velPing = !velPing;
	}

	// --- Step 6: Advect density by velocity ---
	{
		const readDen = denPing ? denTexB : denTexA;
		const readVel = velPing ? velTexB : velTexA;
		const writeFbo = denPing ? denFboA : denFboB;

		runPass(advectProgram!, writeFbo!, res, () => {
			gl!.activeTexture(gl!.TEXTURE0);
			gl!.bindTexture(gl!.TEXTURE_2D, readDen);
			gl!.uniform1i(getUniformLoc(advectProgram!, "u_field"), 0);

			gl!.activeTexture(gl!.TEXTURE1);
			gl!.bindTexture(gl!.TEXTURE_2D, readVel);
			gl!.uniform1i(getUniformLoc(advectProgram!, "u_velocity"), 1);

			gl!.uniform1f(getUniformLoc(advectProgram!, "u_dt"), dt);
			// Density creeps back toward baseDensity via dissipation blend
			const creep = params.shadow.creepSpeed;
			gl!.uniform1f(
				getUniformLoc(advectProgram!, "u_dissipation"),
				1.0 - creep,
			);
			gl!.uniform1f(
				getUniformLoc(advectProgram!, "u_source"),
				params.shadow.baseDensity,
			);
		});
		denPing = !denPing;
	}
}

// ── Public accessors ───────────────────────────────────────────────────────

/** Get the current density texture (last written). */
export function getDensityTexture(): WebGLTexture | null {
	if (!denTexA || !denTexB) return null;
	// After the last denPing flip, the "read" side holds the latest output
	return denPing ? denTexB : denTexA;
}

/** Get the current velocity texture (last written). */
export function getFluidVelocityTexture(): WebGLTexture | null {
	if (!velTexA || !velTexB) return null;
	return velPing ? velTexB : velTexA;
}

/** Reset all fluid state. Call when switching presets or modes. */
export function resetFluid(): void {
	if (gl) {
		deleteTex(velTexA);
		deleteTex(velTexB);
		deleteFbo(velFboA);
		deleteFbo(velFboB);
		deleteTex(denTexA);
		deleteTex(denTexB);
		deleteFbo(denFboA);
		deleteFbo(denFboB);
		deleteTex(presTexA);
		deleteTex(presTexB);
		deleteFbo(presFboA);
		deleteFbo(presFboB);
		deleteTex(divTex);
		deleteFbo(divFbo);
	}

	velTexA = null;
	velTexB = null;
	velFboA = null;
	velFboB = null;
	denTexA = null;
	denTexB = null;
	denFboA = null;
	denFboB = null;
	presTexA = null;
	presTexB = null;
	presFboA = null;
	presFboB = null;
	divTex = null;
	divFbo = null;

	fboSize = 0;
	velPing = true;
	denPing = true;
	presPing = true;

	uniformCache.clear();
}
