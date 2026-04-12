/**
 * Shared toast notification — a brief, non-intrusive message overlay.
 * Used for preset names, mobile feedback, camera flip, etc.
 * Single instance: new toasts replace the current one.
 */

let toastEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, durationMs = 2000): void {
	if (!toastEl) {
		toastEl = document.createElement("div");
		toastEl.style.cssText = [
			"position: fixed",
			"bottom: calc(48px + env(safe-area-inset-bottom, 0px))",
			"left: 50%",
			"transform: translateX(-50%)",
			"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
			"font-size: 20px",
			"font-weight: 300",
			"letter-spacing: 0.12em",
			"color: #fff",
			"text-shadow: 0 0 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7)",
			"background: rgba(0,0,0,0.4)",
			"padding: 8px 20px",
			"border-radius: 8px",
			"z-index: 10000",
			"pointer-events: none",
			"opacity: 0",
			"transition: opacity 0.3s ease",
			"-webkit-font-smoothing: antialiased",
		].join(";");
		document.body.appendChild(toastEl);
	}

	toastEl.textContent = message;
	toastEl.style.opacity = "1";

	if (hideTimer) clearTimeout(hideTimer);
	hideTimer = setTimeout(() => {
		if (toastEl) toastEl.style.opacity = "0";
		hideTimer = null;
	}, durationMs);
}
