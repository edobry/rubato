/**
 * Status overlay — shows initialization progress and runtime notifications.
 * Positioned bottom-center, semi-transparent dark background, white text.
 */

let overlay: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let pulseAnimation: Animation | null = null;

function ensureOverlay(): HTMLDivElement {
	if (overlay) return overlay;

	overlay = document.createElement("div");
	overlay.style.cssText = [
		"position: fixed",
		"bottom: 32px",
		"left: 50%",
		"transform: translateX(-50%)",
		"z-index: 10001",
		"font: 14px/1.4 monospace",
		"color: #fff",
		"background: rgba(0, 0, 0, 0.7)",
		"padding: 8px 20px",
		"border-radius: 6px",
		"pointer-events: none",
		"transition: opacity 0.4s ease",
		"opacity: 0",
		"white-space: nowrap",
	].join(";");
	document.body.appendChild(overlay);

	return overlay;
}

/**
 * Show a status message in the bottom-center overlay.
 * @param message - text to display
 * @param duration - ms before auto-hide (0 = persistent until next call or hideStatus)
 * @param pulse - if true, apply a subtle pulsing animation
 */
export function showStatus(message: string, duration = 0, pulse = false): void {
	const el = ensureOverlay();

	if (hideTimer) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}
	if (pulseAnimation) {
		pulseAnimation.cancel();
		pulseAnimation = null;
	}

	el.textContent = message;
	el.style.opacity = "1";

	if (pulse) {
		pulseAnimation = el.animate(
			[{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }],
			{ duration: 1500, iterations: Infinity },
		);
	}

	if (duration > 0) {
		hideTimer = setTimeout(() => hideStatus(), duration);
	}
}

/** Hide the status overlay with a fade-out. */
export function hideStatus(): void {
	if (!overlay) return;

	if (hideTimer) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}
	if (pulseAnimation) {
		pulseAnimation.cancel();
		pulseAnimation = null;
	}

	overlay.style.opacity = "0";
}
