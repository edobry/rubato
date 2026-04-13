/**
 * Fog field renderer.
 * Renders a procedural simplex noise fog on a separate WebGL canvas.
 * The fog is the idle-state visual — what viewers see before approaching.
 */

import { isMobile } from "./device";
import { params } from "./params";
import fragSrc from "./shaders/fog.frag.glsl";
import vertSrc from "./shaders/fog.vert.glsl";
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
let sharedContext = false;
let startTime = 0;
let frameCounter = 0;
let vao: WebGLVertexArrayObject | null = null;

// Uniform locations
let uTime: WebGLUniformLocation | null = null;
let uSpeed: WebGLUniformLocation | null = null;
let uScale: WebGLUniformLocation | null = null;
let uDensity: WebGLUniformLocation | null = null;
let uBrightness: WebGLUniformLocation | null = null;
let uColor: WebGLUniformLocation | null = null;
let uOctaves: WebGLUniformLocation | null = null;
let uCropOffset: WebGLUniformLocation | null = null;
let uCropScale: WebGLUniformLocation | null = null;

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
export function initFog(
	externalGl?: WebGL2RenderingContext,
): HTMLCanvasElement {
	if (externalGl) {
		gl = externalGl;
		canvas = gl.canvas as HTMLCanvasElement;
		sharedContext = true;
	} else {
		canvas = document.createElement("canvas");
		canvas.style.cssText =
			"position:fixed;inset:0;width:100%;height:100%;z-index:-1";

		sharedContext = false;
		gl = canvas.getContext("webgl2", {
			alpha: false,
		}) as WebGL2RenderingContext | null;
		if (!gl) {
			console.error("WebGL2 not available for fog renderer");
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

	// Full-screen quad VAO
	vao = createQuadVAO(gl);

	// Get uniform locations
	uTime = gl.getUniformLocation(program, "u_time");
	uSpeed = gl.getUniformLocation(program, "u_speed");
	uScale = gl.getUniformLocation(program, "u_scale");
	uDensity = gl.getUniformLocation(program, "u_density");
	uBrightness = gl.getUniformLocation(program, "u_brightness");
	uColor = gl.getUniformLocation(program, "u_color");
	uOctaves = gl.getUniformLocation(program, "u_octaves");
	uCropOffset = gl.getUniformLocation(program, "u_cropOffset");
	uCropScale = gl.getUniformLocation(program, "u_cropScale");

	startTime = performance.now() / 1000;

	// WebGL context loss recovery (only for own canvas; shared GL is handled by compositor)
	if (!externalGl) {
		canvas.addEventListener("webglcontextlost", (e) => {
			e.preventDefault();
			console.warn("[fog] WebGL context lost, awaiting restore...");
		});
		canvas.addEventListener("webglcontextrestored", () => {
			console.log("[fog] WebGL context restored, reinitializing...");
			initFog();
			resizeFog();
			console.log("[fog] Reinitialized after context restore");
		});
	}

	return canvas;
}

/** Resize the fog canvas to match the window. Call on window resize. */
export function resizeFog(): void {
	if (!canvas || !gl || sharedContext) return;
	const scale = params.fog.renderScale;
	canvas.width = Math.round(window.innerWidth * scale);
	canvas.height = Math.round(window.innerHeight * scale);
	gl.viewport(0, 0, canvas.width, canvas.height);
}

/** Set uniforms for the current frame. */
function hexToRgbNorm(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Cached crop bounds for the fog shader (set externally via setFogCrop)
let cropOffset: [number, number] = [0, 0];
let cropScale: [number, number] = [0, 0]; // 0,0 = no cropping (identity)

/**
 * Set the crop region for the fog field, matching the camera's visible area.
 * offset and scale are in normalized 0-1 UV space.
 * When scale is (0,0), cropping is disabled (fog fills the full screen).
 */
export function setFogCrop(
	offset: [number, number],
	scale: [number, number],
): void {
	cropOffset = offset;
	cropScale = scale;
}

function setFogUniforms(): void {
	if (!gl || !program) return;
	const time = performance.now() / 1000 - startTime;
	gl.useProgram(program);
	gl.uniform1f(uTime, time);
	gl.uniform1f(uSpeed, params.fog.speed);
	gl.uniform1f(uScale, params.fog.scale);
	gl.uniform1f(uDensity, params.fog.density);
	const brightness = isMobile()
		? Math.max(params.fog.brightness, 0.35)
		: params.fog.brightness;
	gl.uniform1f(uBrightness, brightness);
	const [r, g, b] = hexToRgbNorm(params.fog.color);
	gl.uniform3f(uColor, r, g, b);
	gl.uniform1f(uOctaves, params.fog.octaves);
	gl.uniform2f(uCropOffset, cropOffset[0], cropOffset[1]);
	gl.uniform2f(uCropScale, cropScale[0], cropScale[1]);
}

/** Render one frame of the fog field directly to screen. */
export function drawFog(): void {
	if (!gl || !program || !vao) return;

	frameCounter++;
	if (params.fog.frameSkip > 1 && frameCounter % params.fog.frameSkip !== 0)
		return;

	renderPass(
		gl,
		program,
		vao,
		null,
		[gl.canvas.width, gl.canvas.height],
		() => {
			setFogUniforms();
		},
	);
}

/**
 * Render the fog to a framebuffer texture and return the texture.
 * The returned texture can be fed into a compositing pass by the unified pipeline.
 * The texture is re-allocated whenever the canvas size changes.
 */
export function renderFogToTexture(): WebGLTexture | null {
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
		setFogUniforms();
	});

	return fboTexture;
}
