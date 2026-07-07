/**
 * Motion detection and GPU trail accumulation module.
 *
 * This module is the bridge between CPU-side body segmentation and GPU-side
 * density accumulation. It sits at stage 3–5 of the rendering pipeline:
 *
 *   1. Camera captures video frames
 *   2. MediaPipe segments the body → per-pixel confidence mask (Float32Array)
 *   3. **detectMotionMap()** diffs consecutive masks → per-pixel motion magnitude
 *   4. **computeMotionVectors()** computes spatial gradients of the diff → motion
 *      direction (dx, dy) for anisotropic diffusion
 *   5. **updateGpuTrail()** uploads motion (+ optional mask) to GPU textures and
 *      runs the trail shader via FBO ping-pong → persistent trail texture
 *   6. trail.frag.glsl reads previous trail state + new motion → updated trail
 *   7. The compositor samples the trail texture for final rendering
 *
 * ## Motion texture format
 *
 * - **Isotropic / legacy mode**: single-channel LUMINANCE texture. Each pixel
 *   stores motion magnitude (0 = still, 1 = maximum change).
 * - **Anisotropic mode**: RGB texture packed as:
 *     - R = motion magnitude
 *     - G = dx (motion direction x), mapped from [-1, 1] → [0, 1]
 *     - B = dy (motion direction y), mapped from [-1, 1] → [0, 1]
 *   The shader unpacks back to [-1, 1] with `dir = texel.gb * 2.0 - 1.0`.
 *
 * ## FBO ping-pong
 *
 * Trail state persists across frames without CPU readback via two framebuffer
 * objects (FBOs) that alternate roles each frame. On frame N, the shader reads
 * the trail from FBO-A (previous state) and writes the updated trail to FBO-B.
 * On frame N+1 the roles swap: read from FBO-B, write to FBO-A. The `outputTex`
 * returned to the compositor always points to whichever FBO was just written.
 *
 * ## Two operating modes
 *
 * - **Legacy (CPU)**: `detectMotion()` computes motion + trail accumulation
 *   entirely on the CPU using a Float32Array buffer. Used when no shared WebGL
 *   context is available.
 * - **Unified (GPU)**: `initGpuTrail()` sets up the shader and FBOs on the
 *   shared WebGL context. Each frame, `detectMotionMap()` runs on the CPU to
 *   produce motion data, then `updateGpuTrail()` uploads it and runs the trail
 *   shader on the GPU. This is the primary path for the imprint density system.
 */

import { params } from "./params";
import trailFragSrc from "./shaders/trail.frag.glsl";
import trailVertSrc from "./shaders/trail.vert.glsl";
import {
	createFramebuffer,
	createProgram,
	createQuadVAO,
	createTexture,
	invalidateFramebuffer,
	renderPass,
	uploadFloatRGBTexture,
	uploadFloatTexture,
} from "./webgl-utils";

/**
 * Reference tick length for trail evolution, in milliseconds.
 *
 * All decay/cultivation/diffusion/drain parameters were hand-tuned when the
 * trail pass ran once per segmentation result on a healthy desktop. Measured
 * on the dev MacBook (M3 Max, prod build, quality model @720p, GPU delegate,
 * 2026-07-07): ~86 results/s → 11.6 ms per tick. u_dtTicks = elapsed_ms /
 * TRAIL_TICK_MS, so tuned per-tick rates keep their wall-clock feel on
 * devices with slower segmentation (phones) or different display rates.
 */
const TRAIL_TICK_MS = 11.6;

/** Clamp bounds for dtTicks: the lower bound guards 240Hz displays, the
 * upper bound prevents a tab-background resume from wiping the field. */
const MIN_DT_TICKS = 0.25;
const MAX_DT_TICKS = 8;

/** Wall-clock time of the last trail pass — anchors dtTicks. */
let lastTrailPassMs: number | null = null;

/** Previous frame's segmentation mask, retained for frame-to-frame diffing. */
let prevRawMask: Float32Array | null = null;

/** CPU trail buffer — used only in legacy (non-unified) mode. */
let trailBuffer: Float32Array | null = null;

// ── GPU trail state — populated by initGpuTrail() ──────────────────────────
let gl: WebGL2RenderingContext | null = null;
let trailProgram: WebGLProgram | null = null;
let trailVao: WebGLVertexArrayObject | null = null;

// ── Ping-pong FBOs ─────────────────────────────────────────────────────────
// Two FBOs alternate as read (previous trail) and write (new trail) targets.
// pingPongState=true → write to A, read from B; pingPongState=false → inverse.
let fboTexA: WebGLTexture | null = null;
let fboTexB: WebGLTexture | null = null;
let fboA: WebGLFramebuffer | null = null;
let fboB: WebGLFramebuffer | null = null;
let fboWidth = 0;
let fboHeight = 0;
let pingPongState = true;

// Motion map texture — uploaded each frame
let motionTexture: WebGLTexture | null = null;

// Mask texture — uploaded each frame for imprint mode
let maskTexture: WebGLTexture | null = null;

// ── Uniform locations (mapped to trail.frag.glsl) ──────────────────────────
let uPrevTrail: WebGLUniformLocation | null = null; // sampler: previous trail FBO
let uMotion: WebGLUniformLocation | null = null; // sampler: current motion map
let uMask: WebGLUniformLocation | null = null; // sampler: current segmentation mask
let uDeposition: WebGLUniformLocation | null = null; // how much motion adds to trail
let uDecay: WebGLUniformLocation | null = null; // per-tick multiplicative decay
let uDtTicks: WebGLUniformLocation | null = null; // elapsed reference ticks since last pass
let uDepositScale: WebGLUniformLocation | null = null; // 1 = deposit frame, 0 = evolve-only

// Imprint density mode uniforms — only used when visualize === "imprint"
let uMode: WebGLUniformLocation | null = null;
let uCultivationRate: WebGLUniformLocation | null = null;
let uChannelStrength: WebGLUniformLocation | null = null;
let uDrainRate: WebGLUniformLocation | null = null;
let uDiffusionRate: WebGLUniformLocation | null = null;
let uDecayVariance: WebGLUniformLocation | null = null;
let uDisintSpeed: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uTexelSize: WebGLUniformLocation | null = null;
let uDiffusionMode: WebGLUniformLocation | null = null;

/**
 * Initialize the GPU trail accumulator on a shared WebGL context.
 *
 * Compiles the trail shader (trail.vert.glsl + trail.frag.glsl), sets up the
 * full-screen quad geometry, resolves all uniform locations, and allocates
 * reusable textures for motion and mask uploads. The ping-pong FBOs are
 * allocated lazily in {@link ensureFBOs} on the first frame, since the mask
 * dimensions aren't known yet.
 *
 * Call this once during startup (unified pipeline only).
 *
 * @param sharedGl - The WebGL context shared with the compositor, so the trail
 *   texture can be sampled directly without copying.
 */
export function initGpuTrail(sharedGl: WebGL2RenderingContext): void {
	gl = sharedGl;

	try {
		trailProgram = createProgram(gl, trailVertSrc, trailFragSrc);
	} catch (err) {
		console.error("Trail shader compilation failed:", err);
		gl = null;
		return;
	}

	// Half-float trail FBOs: with per-frame decay multipliers close to 1.0
	// (high fps → small dtTicks), 8-bit values quantize back to themselves and
	// fades stall. RGBA16F needs EXT_color_buffer_float to be renderable in
	// WebGL2 (16F linear filtering is core), so probe renderability once here.
	trailFloat = checkHalfFloatRenderable(gl);
	if (!trailFloat) {
		console.warn(
			"EXT_color_buffer_float unavailable — trail FBOs fall back to 8-bit; slow fades may stall at high frame rates",
		);
	}

	gl.useProgram(trailProgram);

	// Full-screen quad VAO
	trailVao = createQuadVAO(gl);

	// Uniform locations
	uPrevTrail = gl.getUniformLocation(trailProgram, "u_prevTrail");
	uMotion = gl.getUniformLocation(trailProgram, "u_motion");
	uMask = gl.getUniformLocation(trailProgram, "u_mask");
	uDeposition = gl.getUniformLocation(trailProgram, "u_deposition");
	uDecay = gl.getUniformLocation(trailProgram, "u_decay");
	uDtTicks = gl.getUniformLocation(trailProgram, "u_dtTicks");
	uDepositScale = gl.getUniformLocation(trailProgram, "u_depositScale");

	// Imprint mode uniform locations
	uMode = gl.getUniformLocation(trailProgram, "u_mode");
	uCultivationRate = gl.getUniformLocation(trailProgram, "u_cultivationRate");
	uChannelStrength = gl.getUniformLocation(trailProgram, "u_channelStrength");
	uDrainRate = gl.getUniformLocation(trailProgram, "u_drainRate");
	uDiffusionRate = gl.getUniformLocation(trailProgram, "u_diffusionRate");
	uDecayVariance = gl.getUniformLocation(trailProgram, "u_decayVariance");
	uDisintSpeed = gl.getUniformLocation(trailProgram, "u_disintSpeed");
	uTime = gl.getUniformLocation(trailProgram, "u_time");
	uTexelSize = gl.getUniformLocation(trailProgram, "u_texelSize");
	uDiffusionMode = gl.getUniformLocation(trailProgram, "u_diffusionMode");

	// Motion map texture — allocated once, resized as needed
	motionTexture = createTexture(gl);

	// Mask texture — for imprint mode
	maskTexture = createTexture(gl);
}

/** Whether the GPU trail path is active. */
export function isGpuTrailActive(): boolean {
	return gl !== null && trailProgram !== null;
}

// Whether the trail FBOs are allocated as half-float (see ensureFBOs).
let trailFloat = false;

/** Whether the trail FBO textures use a float format (affects readback type). */
export function isGpuTrailFloat(): boolean {
	return trailFloat;
}

/**
 * Probe whether RGBA16F textures are renderable (color-attachable).
 * WebGL2 requires EXT_color_buffer_float for float color attachments; a tiny
 * FBO completeness check guards against drivers that advertise the extension
 * but fail attachment.
 */
function checkHalfFloatRenderable(ctx: WebGL2RenderingContext): boolean {
	if (!ctx.getExtension("EXT_color_buffer_float")) return false;

	const tex = ctx.createTexture();
	const fbo = ctx.createFramebuffer();
	if (!tex || !fbo) return false;
	ctx.bindTexture(ctx.TEXTURE_2D, tex);
	ctx.texImage2D(
		ctx.TEXTURE_2D,
		0,
		ctx.RGBA16F,
		1,
		1,
		0,
		ctx.RGBA,
		ctx.HALF_FLOAT,
		null,
	);
	ctx.bindFramebuffer(ctx.FRAMEBUFFER, fbo);
	ctx.framebufferTexture2D(
		ctx.FRAMEBUFFER,
		ctx.COLOR_ATTACHMENT0,
		ctx.TEXTURE_2D,
		tex,
		0,
	);
	const complete =
		ctx.checkFramebufferStatus(ctx.FRAMEBUFFER) === ctx.FRAMEBUFFER_COMPLETE;
	ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
	ctx.bindTexture(ctx.TEXTURE_2D, null);
	ctx.deleteFramebuffer(fbo);
	ctx.deleteTexture(tex);
	return complete;
}

/**
 * Ensure the ping-pong FBOs are allocated at the correct resolution.
 *
 * Called at the start of each {@link updateGpuTrail} invocation. If the mask
 * dimensions have changed (e.g. camera resolution switch), tears down the old
 * FBOs and allocates new RGBA textures + framebuffers. Resets `pingPongState`
 * so the first frame after resize writes to FBO-A.
 */
function ensureFBOs(w: number, h: number): void {
	if (!gl) return;
	if (fboTexA && fboTexB && fboWidth === w && fboHeight === h) return;

	// Clean up old resources
	if (fboTexA) gl.deleteTexture(fboTexA);
	if (fboTexB) gl.deleteTexture(fboTexB);
	if (fboA) gl.deleteFramebuffer(fboA);
	if (fboB) gl.deleteFramebuffer(fboB);

	// Allocate two RGBA textures for ping-pong. Half-float when renderable
	// (see initGpuTrail) so slow per-frame decay multipliers don't quantize
	// away in 8 bits; byte fallback otherwise.
	const allocTrailTexture = (): WebGLTexture => {
		const tex = createTexture(gl!);
		gl!.bindTexture(gl!.TEXTURE_2D, tex);
		if (trailFloat) {
			gl!.texImage2D(
				gl!.TEXTURE_2D,
				0,
				gl!.RGBA16F,
				w,
				h,
				0,
				gl!.RGBA,
				gl!.HALF_FLOAT,
				null,
			);
		} else {
			gl!.texImage2D(
				gl!.TEXTURE_2D,
				0,
				gl!.RGBA,
				w,
				h,
				0,
				gl!.RGBA,
				gl!.UNSIGNED_BYTE,
				null,
			);
		}
		return tex;
	};

	fboTexA = allocTrailTexture();
	fboTexB = allocTrailTexture();

	fboA = createFramebuffer(gl, fboTexA);
	fboB = createFramebuffer(gl, fboTexB);

	fboWidth = w;
	fboHeight = h;
	pingPongState = true;

	gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * Run one GPU trail pass (the core of the FBO ping-pong).
 *
 * The same shader pass serves two roles:
 * - **Deposit pass** (`deposit === true`, fresh segmentation result): uploads
 *   the new motion map (+ mask in imprint mode) and adds motion deposition.
 * - **Evolve pass** (`deposit === false`, every other rendered frame): reuses
 *   the previously uploaded motion/mask textures with u_depositScale = 0, so
 *   only decay/cultivation/diffusion advance.
 *
 * Evolution is dt-normalized: u_dtTicks = elapsed ms since the previous pass
 * divided by TRAIL_TICK_MS, clamped to [0.25, 8]. Motion deposition is
 * per-event (already rate-invariant in total) and is never dt-scaled.
 *
 * Each invocation:
 * 1. Ensures FBOs are allocated at the correct resolution
 * 2. Selects the read FBO (previous trail state) and write FBO (output)
 * 3. On deposit passes, uploads the motion map — LUMINANCE for isotropic
 *    mode, RGB (magnitude + direction) for anisotropic diffusion — and the
 *    segmentation mask for imprint density mode
 * 4. Sets all trail/density uniforms from the live params
 * 5. Draws a full-screen quad to run trail.frag.glsl into the write FBO
 * 6. Swaps the ping-pong state so next frame reads from what we just wrote
 *
 * Returns the trail texture (the FBO attachment we just rendered into) so the
 * compositor can bind it directly — no CPU readback needed.
 */
function runTrailPass(
	motionMap: Float32Array | null,
	w: number,
	h: number,
	mask: Float32Array | null,
	deposit: boolean,
): WebGLTexture | null {
	if (!gl || !trailProgram || !trailVao || !motionTexture) return null;

	ensureFBOs(w, h);
	if (!fboA || !fboB || !fboTexA || !fboTexB) return null;

	const isImprint = params.overlay.visualize === "imprint";

	// dt-normalization: how many reference ticks elapsed since the last pass.
	const now = performance.now();
	const dtTicks =
		lastTrailPassMs === null
			? 1
			: Math.min(
					MAX_DT_TICKS,
					Math.max(MIN_DT_TICKS, (now - lastTrailPassMs) / TRAIL_TICK_MS),
				);
	lastTrailPassMs = now;

	// Determine which FBO to read from (previous trail) and write to (new trail)
	const readTex = pingPongState ? fboTexB : fboTexA;
	const writeFbo = pingPongState ? fboA : fboB;
	const outputTex = pingPongState ? fboTexA : fboTexB;

	renderPass(gl, trailProgram, trailVao, writeFbo, [w, h], () => {
		// Motion map on texture unit 0. Deposit passes upload fresh data;
		// evolve passes rebind the last-uploaded map (its direction channels
		// still steer anisotropic diffusion; deposition is zeroed by
		// u_depositScale so stale magnitudes are inert).
		gl!.activeTexture(gl!.TEXTURE0);
		if (deposit && motionMap) {
			// Anisotropic mode packs magnitude + direction into RGB; isotropic uses LUMINANCE.
			if (isImprint && params.density.diffusionMode === "anisotropic") {
				const vectors = computeMotionVectors(motionMap, w, h);
				uploadFloatRGBTexture(gl!, motionTexture!, vectors, w, h);
			} else {
				uploadFloatTexture(gl!, motionTexture!, motionMap, w, h);
			}
		} else {
			gl!.bindTexture(gl!.TEXTURE_2D, motionTexture);
		}
		gl!.uniform1i(uMotion, 0);

		// Bind previous trail as input
		gl!.activeTexture(gl!.TEXTURE1);
		gl!.bindTexture(gl!.TEXTURE_2D, readTex);
		gl!.uniform1i(uPrevTrail, 1);

		// Mask texture for imprint mode. Evolve passes hold the most recent
		// mask so cultivation keeps charging between segmentation results.
		if (isImprint && maskTexture) {
			gl!.activeTexture(gl!.TEXTURE2);
			if (deposit && mask) {
				uploadFloatTexture(gl!, maskTexture, mask, w, h);
			} else {
				gl!.bindTexture(gl!.TEXTURE_2D, maskTexture);
			}
			gl!.uniform1i(uMask, 2);
		}

		// Set common uniforms
		gl!.uniform1f(uDeposition, params.motion.deposition);
		gl!.uniform1f(uDecay, params.motion.decay);
		gl!.uniform1f(uDtTicks, dtTicks);
		gl!.uniform1f(uDepositScale, deposit ? 1.0 : 0.0);

		// Set imprint mode uniforms
		gl!.uniform1f(uMode, isImprint ? 1.0 : 0.0);
		if (isImprint) {
			gl!.uniform1f(uCultivationRate, params.density.cultivationRate);
			gl!.uniform1f(uChannelStrength, params.density.channelStrength);
			gl!.uniform1f(uDrainRate, params.density.drainRate);
			gl!.uniform1f(uDiffusionRate, params.density.diffusionRate);
			gl!.uniform1f(uDecayVariance, params.density.decayVariance);
			gl!.uniform1f(uDisintSpeed, params.density.disintegrationSpeed);
			gl!.uniform1f(uTime, performance.now() / 1000);
			gl!.uniform2f(uTexelSize, w > 0 ? 1.0 / w : 0, h > 0 ? 1.0 / h : 0);
			gl!.uniform1f(
				uDiffusionMode,
				params.density.diffusionMode === "anisotropic" ? 1.0 : 0.0,
			);
		}
	});

	// Swap ping-pong so next frame reads from the FBO we just wrote to
	pingPongState = !pingPongState;
	// Invalidate the source FBO we just read from (TBDR optimization)
	invalidateFramebuffer(gl!, pingPongState ? fboA! : fboB!);

	return outputTex;
}

/**
 * Run a deposit trail pass with a fresh motion map (call once per new
 * segmentation result).
 *
 * @param motionMap - Per-pixel motion magnitude from {@link detectMotionMap}
 * @param w - Width of the motion map (matches segmentation mask resolution)
 * @param h - Height of the motion map
 * @param mask - Optional segmentation mask for imprint density mode. When
 *   provided and visualize === "imprint", enables the cultivation/channeling/
 *   disintegration pipeline in the shader.
 * @returns The trail texture to sample, or null if GPU trail is not initialized.
 */
export function updateGpuTrail(
	motionMap: Float32Array,
	w: number,
	h: number,
	mask?: Float32Array | null,
): WebGLTexture | null {
	return runTrailPass(motionMap, w, h, mask ?? null, true);
}

/**
 * Run an evolve-only trail pass (call every rendered frame without a fresh
 * segmentation result). Decay, cultivation, and diffusion advance by the
 * elapsed wall-clock time; no new motion is deposited.
 *
 * @param w - Trail buffer width (must match the last deposit pass)
 * @param h - Trail buffer height
 * @returns The trail texture to sample, or null if GPU trail is not initialized.
 */
export function evolveGpuTrail(w: number, h: number): WebGLTexture | null {
	return runTrailPass(null, w, h, null, false);
}

/** Get the current trail texture without running an update (for frames where motion isn't recomputed). */
export function getGpuTrailTexture(): WebGLTexture | null {
	// The last written texture is the current output
	if (!fboTexA || !fboTexB) return null;
	// After updateGpuTrail, pingPongState has been flipped, so the *previous*
	// outputTex is at the opposite state.
	return pingPongState ? fboTexB : fboTexA;
}

/**
 * Reset all motion detection and trail state.
 *
 * Clears the previous-frame mask, CPU trail buffer, and GPU FBOs. Call when
 * switching presets or visualization modes to prevent stale trail data from
 * the previous mode bleeding through. FBOs are lazily reallocated on the
 * next frame via {@link ensureFBOs}.
 */
export function resetMotion(): void {
	prevRawMask = null;
	trailBuffer = null;
	lastTrailPassMs = null;

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
 * Compute motion direction vectors from a magnitude map using spatial gradients.
 *
 * For each pixel with nonzero motion, computes the gradient of the motion
 * magnitude using central differences (right - left, below - above). The
 * gradient of the signed diff points from where the body arrived to where it
 * left, giving the direction of motion. The resulting (dx, dy) vector is
 * normalized to unit length, then mapped from [-1, 1] to [0, 1] for GPU
 * texture encoding (the shader reverses this with `dir = texel.gb * 2.0 - 1.0`).
 *
 * Pixels with near-zero gradient length (< 0.001) get zero direction to avoid
 * amplifying noise.
 *
 * @param motionMap - Per-pixel motion magnitude (single-channel, w*h)
 * @param w - Width in pixels
 * @param h - Height in pixels
 * @returns Float32Array of w*h*3, packed as [R=magnitude, G=dx, B=dy] per pixel
 */
function computeMotionVectors(
	motionMap: Float32Array,
	w: number,
	h: number,
): Float32Array {
	const pixelCount = w * h;
	const result = new Float32Array(pixelCount * 3);

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const mag = motionMap[idx]!;

			let dx = 0;
			let dy = 0;
			if (mag > 0) {
				if (x > 0 && x < w - 1) {
					dx = motionMap[idx + 1]! - motionMap[idx - 1]!;
				}
				if (y > 0 && y < h - 1) {
					dy = motionMap[idx + w]! - motionMap[idx - w]!;
				}

				const len = Math.sqrt(dx * dx + dy * dy);
				if (len > 0.001) {
					dx /= len;
					dy /= len;
				} else {
					dx = 0;
					dy = 0;
				}
			}

			const out = idx * 3;
			result[out] = mag;
			result[out + 1] = dx * 0.5 + 0.5;
			result[out + 2] = dy * 0.5 + 0.5;
		}
	}

	return result;
}

/**
 * Detect per-pixel motion by diffing the current segmentation mask against the
 * previous frame's mask.
 *
 * For each pixel, computes `|current - previous|`. Values below the configured
 * motion threshold ({@link params.segmentation.motionThreshold}) are zeroed to
 * suppress sensor noise. The result is a Float32Array where each value is either
 * 0 (no significant change) or the magnitude of the confidence change (0..1).
 *
 * On the first frame (no previous mask), returns all zeros.
 *
 * This is the CPU-side motion computation used by both the legacy and unified
 * pipelines. In the unified pipeline, the output feeds into
 * {@link updateGpuTrail}; in the legacy pipeline, it feeds into
 * {@link detectMotion} which also accumulates the CPU trail buffer.
 *
 * @param currentRaw - Current frame's segmentation mask (per-pixel confidence 0..1)
 * @param width - Mask width in pixels
 * @param height - Mask height in pixels
 * @returns Per-pixel motion magnitude map (Float32Array, same dimensions)
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
 * Legacy CPU-side motion detection with trail accumulation.
 *
 * Combines {@link detectMotionMap} with a simple CPU trail buffer: each frame,
 * motion magnitude is multiplied by `deposition` and added to the trail, then
 * the entire trail is multiplied by `decay` (< 1.0) so it fades over time.
 * Values below 0.005 are clamped to zero to prevent ghost trails.
 *
 * Used only by the legacy (non-unified) pipeline. The unified pipeline uses
 * {@link detectMotionMap} + {@link updateGpuTrail} instead, which runs the
 * equivalent logic on the GPU via trail.frag.glsl.
 *
 * @param currentRaw - Current frame's segmentation mask
 * @param width - Mask width in pixels
 * @param height - Mask height in pixels
 * @returns Object with `motion` (raw motion map) and `trail` (accumulated trail)
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
