/**
 * Fog field renderer.
 * Renders a procedural simplex noise fog on a separate WebGL canvas.
 * The fog is the idle-state visual — what viewers see before approaching.
 */

import { params } from "./params";
import fragSrc from "./shaders/fog.frag.glsl";
import vertSrc from "./shaders/fog.vert.glsl";

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

function compileShader(
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

function createProgram(
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

/** Initialize the fog renderer. Returns the canvas element to be inserted into the DOM. */
export function initFog(): HTMLCanvasElement {
	canvas = document.createElement("canvas");
	canvas.style.cssText =
		"position:fixed;inset:0;width:100%;height:100%;z-index:-1";

	gl = canvas.getContext("webgl", { alpha: false });
	if (!gl) {
		console.error("WebGL not available for fog renderer");
		return canvas;
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

/** Render one frame of the fog field. */
export function drawFog(): void {
	if (!gl || !program) return;

	const time = performance.now() / 1000 - startTime;

	gl.uniform1f(uTime, time);
	gl.uniform1f(uSpeed, params.fog.speed);
	gl.uniform1f(uScale, params.fog.scale);
	gl.uniform1f(uDensity, params.fog.density);
	gl.uniform1f(uBrightness, params.fog.brightness);

	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
