/**
 * Shared WebGL utility functions.
 * Generic helpers extracted from fog.ts, plus new utilities for the unified rendering pipeline.
 */

/** Compile a single shader stage and return it. Throws on error. */
export function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("Failed to create shader");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile error: ${info}`);
	}
	return shader;
}

/** Compile vertex + fragment sources and link into a program. Throws on error. */
export function createProgram(
	gl: WebGLRenderingContext,
	vertSrc: string,
	fragSrc: string,
): WebGLProgram {
	const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
	const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
	const prog = gl.createProgram();
	if (!prog) throw new Error("Failed to create program");
	gl.attachShader(prog, vert);
	gl.attachShader(prog, frag);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(prog);
		throw new Error(`Program link error: ${info}`);
	}
	return prog;
}

/** Create a texture with NEAREST filtering and CLAMP_TO_EDGE wrapping. */
export function createTexture(gl: WebGLRenderingContext): WebGLTexture {
	const tex = gl.createTexture();
	if (!tex) throw new Error("Failed to create texture");
	gl.bindTexture(gl.TEXTURE_2D, tex);
	// LINEAR filtering + CLAMP_TO_EDGE required for NPOT textures on some GPUs (Pi)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return tex;
}

/** Create a framebuffer with the given texture attached as COLOR_ATTACHMENT0. */
export function createFramebuffer(
	gl: WebGLRenderingContext,
	texture: WebGLTexture,
): WebGLFramebuffer {
	const fbo = gl.createFramebuffer();
	if (!fbo) throw new Error("Failed to create framebuffer");
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		texture,
		0,
	);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	return fbo;
}

/**
 * Upload a Float32Array as a texture.
 * Uses LUMINANCE + FLOAT if OES_texture_float is available, otherwise
 * falls back to packing floats into RGBA8 (each float encoded across 4 bytes).
 */
/**
 * Upload a Float32Array as a texture (value packed into RGBA).
 * Values should be 0-1. Uses RGBA+UNSIGNED_BYTE for maximum GPU compatibility.
 * The value is written to R channel; shader reads .r to get it.
 * NOTE: Texture stays bound after call for the caller to use.
 */
let uploadBuf: Uint8Array | null = null;
export function uploadFloatTexture(
	gl: WebGLRenderingContext,
	texture: WebGLTexture,
	data: Float32Array,
	width: number,
	height: number,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);

	// Pack into RGBA8: value in R, 0 in G/B, 255 in A
	const size = width * height * 4;
	if (!uploadBuf || uploadBuf.length !== size) {
		uploadBuf = new Uint8Array(size);
	}
	for (let i = 0; i < data.length; i++) {
		const v = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
		const j = i * 4;
		uploadBuf[j] = v;
		uploadBuf[j + 1] = v;
		uploadBuf[j + 2] = v;
		uploadBuf[j + 3] = 255;
	}
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		width,
		height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		uploadBuf,
	);
}

/**
 * Upload a video element as a texture via texImage2D.
 * NOTE: caller must bind the correct texture unit first. Texture stays bound after call.
 */
export function uploadVideoTexture(
	gl: WebGLRenderingContext,
	texture: WebGLTexture,
	video: HTMLVideoElement,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
	// Texture stays bound for the caller to use
}
