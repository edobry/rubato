/**
 * Persistent "GPU delegate failed" flag with expiry.
 *
 * A GPU failure verdict (init failure or all-zero-mask probe) is only trusted
 * for 24 hours. The zero-mask probe can false-positive — ten empty masks can
 * simply mean nobody stood in frame during startup — so a stale verdict must
 * not lock a device onto the slow CPU delegate forever. If the GPU genuinely
 * fails, the init fallback / probe re-flags it within seconds of the retry.
 *
 * Stored under the pre-existing key as JSON `{"ts": <epoch ms>}`. The legacy
 * value "true" (written by builds before expiry existed) is treated as
 * expired, so previously-locked devices get one fresh GPU attempt.
 */

const GPU_FAILED_KEY = "rubato-gpu-failed";

/** How long a GPU-failed verdict is trusted before retrying the GPU. */
const GPU_FAILED_TTL_MS = 24 * 60 * 60 * 1000;

/** Record that the GPU delegate failed on this device (verdict expires). */
export function setGpuFailed(): void {
	try {
		localStorage.setItem(GPU_FAILED_KEY, JSON.stringify({ ts: Date.now() }));
	} catch {
		// localStorage unavailable (private mode, storage full) — the verdict
		// just won't persist across reloads.
	}
}

/**
 * Whether a still-fresh GPU-failed verdict exists for this device.
 * Legacy ("true") or malformed values return false.
 */
export function isGpuFailed(): boolean {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(GPU_FAILED_KEY);
	} catch {
		return false;
	}
	if (!raw || raw === "true") return false;

	try {
		const record: unknown = JSON.parse(raw);
		if (
			typeof record !== "object" ||
			record === null ||
			typeof (record as { ts?: unknown }).ts !== "number"
		) {
			return false;
		}
		return Date.now() - (record as { ts: number }).ts < GPU_FAILED_TTL_MS;
	} catch {
		return false;
	}
}
