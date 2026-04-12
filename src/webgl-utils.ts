/**
 * Shared WebGL utility functions.
 * Generic helpers extracted from fog.ts, plus new utilities for the unified rendering pipeline.
 */

/** Compile a single shader stage and return it. Throws on error. */
export function compileShader(
	gl: WebGL2RenderingContext,
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
	gl: WebGL2RenderingContext,
	vertSrc: string,
	fragSrc: string,
): WebGLProgram {
	const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
	const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
	const prog = gl.createProgram();
	if (!prog) throw new Error("Failed to create program");
	gl.attachShader(prog, vert);
	gl.attachShader(prog, frag);
	gl.bindAttribLocation(prog, 0, "a_position");
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(prog);
		throw new Error(`Program link error: ${info}`);
	}
	return prog;
}

/** Create a texture with NEAREST filtering and CLAMP_TO_EDGE wrapping. */
export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
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
	gl: WebGL2RenderingContext,
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
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		console.error(`Framebuffer incomplete: 0x${status.toString(16)}`);
	}
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
	gl: WebGL2RenderingContext,
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
		const v = Math.round(Math.min(1, Math.max(0, data[i]!)) * 255);
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
 * Upload a 3-channel Float32Array as an RGBA texture.
 * Input data has 3 floats per pixel (R, G, B in [0,1]).
 * Packed into RGBA8 with A=255.
 */
let uploadBufRGB: Uint8Array | null = null;
export function uploadFloatRGBTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	data: Float32Array,
	width: number,
	height: number,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);

	const pixelCount = width * height;
	const size = pixelCount * 4;
	if (!uploadBufRGB || uploadBufRGB.length !== size) {
		uploadBufRGB = new Uint8Array(size);
	}
	for (let i = 0; i < pixelCount; i++) {
		const src = i * 3;
		const dst = i * 4;
		uploadBufRGB[dst] = Math.round(Math.min(1, Math.max(0, data[src]!)) * 255);
		uploadBufRGB[dst + 1] = Math.round(
			Math.min(1, Math.max(0, data[src + 1]!)) * 255,
		);
		uploadBufRGB[dst + 2] = Math.round(
			Math.min(1, Math.max(0, data[src + 2]!)) * 255,
		);
		uploadBufRGB[dst + 3] = 255;
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
		uploadBufRGB,
	);
}

/**
 * Upload a video element as a texture via texImage2D.
 * NOTE: caller must bind the correct texture unit first. Texture stays bound after call.
 */
export function uploadVideoTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	video: HTMLVideoElement,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
	// Texture stays bound for the caller to use
}

/**
 * Invalidate a framebuffer's color attachment after reading from it.
 * On tile-based mobile GPUs (Adreno, Mali, Apple), this tells the driver
 * it doesn't need to write the tile data back to main memory, saving bandwidth.
 */
export function invalidateFramebuffer(
	gl: WebGL2RenderingContext,
	fbo: WebGLFramebuffer,
): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/** Create a fullscreen quad VAO. Uses attribute location 0 (a_position). */
export function createQuadVAO(
	gl: WebGL2RenderingContext,
): WebGLVertexArrayObject {
	const buf = gl.createBuffer();
	if (!buf) throw new Error("Failed to create quad buffer");
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
		gl.STATIC_DRAW,
	);

	const vao = gl.createVertexArray();
	if (!vao) throw new Error("Failed to create VAO");
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	gl.bindVertexArray(null);

	return vao;
}

/**
 * Execute a fullscreen quad render pass with complete state management.
 * Binds program, VAO, FBO, and viewport; runs setup callback for
 * renderer-specific uniforms and textures; draws; then unbinds VAO and FBO.
 */
export function renderPass(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	vao: WebGLVertexArrayObject,
	target: WebGLFramebuffer | null,
	viewport: [number, number],
	setup: () => void,
): void {
	gl.useProgram(program);
	gl.bindVertexArray(vao);
	setup();
	gl.bindFramebuffer(gl.FRAMEBUFFER, target);
	gl.viewport(0, 0, viewport[0], viewport[1]);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	gl.bindVertexArray(null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
