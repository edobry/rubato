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
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
export function uploadFloatTexture(
	gl: WebGLRenderingContext,
	texture: WebGLTexture,
	data: Float32Array,
	width: number,
	height: number,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);

	const floatExt = gl.getExtension("OES_texture_float");
	if (floatExt) {
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.LUMINANCE,
			width,
			height,
			0,
			gl.LUMINANCE,
			gl.FLOAT,
			data,
		);
	} else {
		// Fallback: pack each float into an RGBA8 pixel (IEEE 754 bytes).
		const packed = new Uint8Array(data.length * 4);
		const view = new DataView(packed.buffer);
		for (let i = 0; i < data.length; i++) {
			view.setFloat32(i * 4, data[i], true);
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
			packed,
		);
	}

	gl.bindTexture(gl.TEXTURE_2D, null);
}

/** Upload a video element as a texture via texImage2D. */
export function uploadVideoTexture(
	gl: WebGLRenderingContext,
	texture: WebGLTexture,
	video: HTMLVideoElement,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
	gl.bindTexture(gl.TEXTURE_2D, null);
}
