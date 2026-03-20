/**
 * Status log — maintains a scrolling log of init/runtime messages.
 * Drawn by the perf overlay in the stats area rather than as transient toasts.
 */

const MAX_LOG = 8;
const log: { time: number; message: string }[] = [];

/**
 * Add a status message to the log.
 * @param message - text to display
 * @param _duration - ignored (kept for API compat)
 * @param _pulse - ignored (kept for API compat)
 */
export function showStatus(
	message: string,
	_duration = 0,
	_pulse = false,
): void {
	log.push({ time: performance.now(), message });
	if (log.length > MAX_LOG) log.shift();
	console.log(`[status] ${message}`);
}

/** No-op — log entries persist until scrolled out. */
export function hideStatus(): void {
	// intentionally empty
}

/** Get the status log for rendering in the stats overlay. */
export function getStatusLog(): string[] {
	const now = performance.now();
	// Fade entries older than 10 seconds
	return log.filter((e) => now - e.time < 10000).map((e) => e.message);
}
