/**
 * Hardware/environment detection.
 * Detects constrained devices (Raspberry Pi, ARM SBCs) at init time
 * so other modules can adapt behavior accordingly.
 */

export interface DeviceInfo {
	isConstrained: boolean;
	platform: string;
	cores: number;
	gpu: string;
	memory?: number;
}

let cached: DeviceInfo | null = null;

/** Detect the current device capabilities. Result is cached after first call. */
export function detectDevice(): DeviceInfo {
	if (cached) return cached;

	const ua = navigator.userAgent;
	const cores = navigator.hardwareConcurrency || 0;
	const memory = (navigator as { deviceMemory?: number }).deviceMemory;

	// Read GPU renderer string from WebGL (need it for detection)
	const gpu = getGpuRenderer();

	// Detect ARM platforms via user agent
	const isAarch64 = ua.includes("Linux aarch64");
	const isArmv7 = ua.includes("Linux armv7l");
	const isArm = isAarch64 || isArmv7;

	// Detect Raspberry Pi via GPU renderer (most reliable)
	const isBroadcom =
		gpu.toLowerCase().includes("broadcom") || gpu.includes("V3D");
	const isPi = isBroadcom || (isArm && cores <= 4);

	// Constrained = Pi, ARM SBCs, or any device with Broadcom GPU
	const isConstrained = isPi || cores <= 2;

	let platform = "Desktop";
	if (isPi)
		platform = `Pi (${isBroadcom ? (gpu.match(/V3D\s*[\d.]+/)?.[0] ?? "Broadcom") : "ARM"})`;
	else if (isArm) platform = "ARM SBC";

	cached = { isConstrained, platform, cores, gpu };
	if (memory !== undefined) cached.memory = memory;

	return cached;
}

/** Create a throwaway WebGL context to read the GPU renderer string. */
function getGpuRenderer(): string {
	try {
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
		if (!gl) return "unknown (no WebGL)";

		const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
		if (!debugInfo) return "unknown (no debug info)";

		const renderer =
			gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "unknown";

		// Clean up the context
		const ext = gl.getExtension("WEBGL_lose_context");
		if (ext) ext.loseContext();

		return renderer;
	} catch {
		return "unknown (error)";
	}
}
