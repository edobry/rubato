/**
 * Watermark — a subtle "時痕" in the bottom-left corner of the running piece.
 * Hovering reveals "return to lobby". Clicking returns to the lobby.
 * Auto-hides after 5 seconds of no mouse movement.
 */

const FADE_TIMEOUT = 5000;
const PIECE_STATE_KEY = "rubato-piece-state";

let watermarkEl: HTMLElement | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function returnToLobby(): void {
	localStorage.removeItem(PIECE_STATE_KEY);
	location.reload();
}

function createWatermark(): HTMLElement {
	const el = document.createElement("div");
	el.style.cssText = `
		position: fixed;
		bottom: 20px;
		left: 20px;
		z-index: 10000;
		pointer-events: auto;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		cursor: pointer;
		transition: opacity 0.5s ease;
		-webkit-font-smoothing: antialiased;
		user-select: none;
		display: flex;
		align-items: baseline;
		gap: 10px;
	`;

	const title = document.createElement("span");
	title.style.cssText = `
		font-size: 16px;
		font-weight: 300;
		color: rgba(255, 255, 255, 0.25);
		transition: color 0.3s ease;
	`;
	title.textContent = "時痕";

	const hint = document.createElement("span");
	hint.style.cssText = `
		font-size: 11px;
		font-weight: 300;
		letter-spacing: 0.05em;
		color: rgba(255, 255, 255, 0);
		transition: color 0.3s ease;
	`;
	hint.textContent = "return to lobby";

	el.appendChild(title);
	el.appendChild(hint);

	el.addEventListener("mouseenter", () => {
		title.style.color = "rgba(255, 255, 255, 0.6)";
		hint.style.color = "rgba(255, 255, 255, 0.4)";
	});
	el.addEventListener("mouseleave", () => {
		title.style.color = "rgba(255, 255, 255, 0.25)";
		hint.style.color = "rgba(255, 255, 255, 0)";
	});
	el.addEventListener("click", (e) => {
		e.stopPropagation();
		returnToLobby();
	});

	return el;
}

function resetFadeTimer(): void {
	if (fadeTimer) clearTimeout(fadeTimer);
	fadeTimer = setTimeout(() => {
		if (watermarkEl) {
			watermarkEl.style.opacity = "0";
		}
	}, FADE_TIMEOUT);
}

function onMouseMove(): void {
	if (!watermarkEl) return;
	watermarkEl.style.opacity = "1";
	resetFadeTimer();
}

export function initInfoWatermark(): void {
	if (watermarkEl) return;
	watermarkEl = createWatermark();
	document.body.appendChild(watermarkEl);
	document.addEventListener("mousemove", onMouseMove);
	resetFadeTimer();
}

export function destroyInfoWatermark(): void {
	document.removeEventListener("mousemove", onMouseMove);
	if (fadeTimer) {
		clearTimeout(fadeTimer);
		fadeTimer = null;
	}
	if (watermarkEl) {
		watermarkEl.remove();
		watermarkEl = null;
	}
}
