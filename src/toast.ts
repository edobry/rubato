/**
 * Minimal toast notification — a brief, non-intrusive message pill.
 * Used for user-facing feedback on mobile (camera flip, optimization, etc.).
 */

let currentToast: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, durationMs = 2000): void {
	// Remove any existing toast
	if (currentToast) {
		currentToast.remove();
		if (hideTimer) clearTimeout(hideTimer);
	}

	const el = document.createElement("div");
	el.textContent = message;
	el.style.cssText = [
		"position: fixed",
		"bottom: calc(80px + env(safe-area-inset-bottom, 0px))",
		"left: 50%",
		"transform: translateX(-50%)",
		"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
		"font-size: 13px",
		"font-weight: 400",
		"letter-spacing: 0.03em",
		"color: rgba(255,255,255,0.85)",
		"background: rgba(255,255,255,0.12)",
		"backdrop-filter: blur(12px)",
		"-webkit-backdrop-filter: blur(12px)",
		"padding: 8px 18px",
		"border-radius: 20px",
		"z-index: 10000",
		"pointer-events: none",
		"opacity: 0",
		"transition: opacity 0.3s ease",
		"-webkit-font-smoothing: antialiased",
	].join(";");

	document.body.appendChild(el);
	currentToast = el;

	// Fade in
	requestAnimationFrame(() => {
		el.style.opacity = "1";
	});

	// Fade out and remove
	hideTimer = setTimeout(() => {
		el.style.opacity = "0";
		setTimeout(() => {
			if (currentToast === el) {
				el.remove();
				currentToast = null;
			}
		}, 300);
	}, durationMs);
}
