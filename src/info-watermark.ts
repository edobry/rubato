/**
 * Info watermark — a subtle "時痕" element in the bottom-left corner that
 * fades in on mouse movement and opens an about panel on click or `I` key.
 */

const ABOUT_PARAGRAPHS = [
	"時痕 Rubato is an interactive installation by Sarah Lin. A camera watches the space. When it finds you, your body becomes a presence in a fog-like field — a shadow that moves as you move, inscribing traces into the surface of the image.",
	"Move and you leave residue. Stand still and the accumulation stops. Step away and what remains is a machine still following the shape of someone no longer there. Traces dissolve slowly, like heat leaving a room.",
	"The piece asks a simple question about time — whether it is something measured and external, or something we deposit into spaces and into each other. The shadow recalls the sundial, the oldest temporal instrument. The body recalls butoh, the dance of darkness. Both turn presence into mark.",
];

const FADE_TIMEOUT = 5000;

let watermarkEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function createWatermark(): HTMLElement {
	const el = document.createElement("div");
	el.style.cssText = `
		position: fixed;
		bottom: 16px;
		left: 16px;
		z-index: 10000;
		pointer-events: auto;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		font-size: 14px;
		font-weight: 300;
		color: rgba(255, 255, 255, 0.2);
		cursor: pointer;
		transition: opacity 0.5s ease, color 0.5s ease;
		-webkit-font-smoothing: antialiased;
		user-select: none;
	`;
	el.textContent = "時痕";

	el.addEventListener("mouseenter", () => {
		el.style.color = "rgba(255, 255, 255, 0.5)";
	});
	el.addEventListener("mouseleave", () => {
		el.style.color = "rgba(255, 255, 255, 0.2)";
	});
	el.addEventListener("click", (e) => {
		e.stopPropagation();
		toggleInfoPanel();
	});

	return el;
}

function createPanel(): HTMLElement {
	const overlay = document.createElement("div");
	overlay.style.cssText = `
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10003;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		color: #fff;
		-webkit-font-smoothing: antialiased;
		background: rgba(0, 0, 0, 0.6);
	`;

	// Click outside panel to dismiss
	overlay.addEventListener("click", () => {
		hideInfoPanel();
	});

	const panel = document.createElement("div");
	panel.style.cssText = `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 40px 48px;
		max-width: 600px;
		background: #111;
		border-radius: 12px;
		border: 1px solid #333;
	`;
	panel.addEventListener("click", (e) => e.stopPropagation());

	// Title
	const title = document.createElement("p");
	title.style.cssText = `
		font-size: 14px;
		font-weight: 400;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #999;
		margin: 0;
	`;
	title.textContent = "About";
	panel.appendChild(title);

	// Separator
	const sep = document.createElement("hr");
	sep.style.cssText = `
		width: 40px;
		height: 1px;
		background: #333;
		border: none;
		margin: 0;
	`;
	panel.appendChild(sep);

	// Paragraphs
	for (const text of ABOUT_PARAGRAPHS) {
		const p = document.createElement("p");
		p.style.cssText = `
			font-size: 15px;
			font-weight: 300;
			line-height: 1.7;
			color: #999;
			margin: 0;
		`;
		p.textContent = text;
		panel.appendChild(p);
	}

	// Camera note
	const note = document.createElement("p");
	note.style.cssText = `
		font-size: 12px;
		font-weight: 300;
		line-height: 1.6;
		color: #555;
		margin: 8px 0 0 0;
		font-style: italic;
	`;
	note.textContent =
		"This piece requires camera access to detect your presence.";
	panel.appendChild(note);

	// Dismiss hint
	const hint = document.createElement("p");
	hint.style.cssText = `
		font-size: 12px;
		color: #777;
		letter-spacing: 0.05em;
		margin: 8px 0 0 0;
		padding: 8px 16px;
		border: 1px solid #333;
		border-radius: 6px;
	`;
	hint.textContent = "press I, Enter, or Escape to dismiss";
	panel.appendChild(hint);

	overlay.appendChild(panel);
	return overlay;
}

// --- Mouse movement: show/hide watermark ---

function resetFadeTimer(): void {
	if (fadeTimer) clearTimeout(fadeTimer);
	fadeTimer = setTimeout(() => {
		if (watermarkEl && !panelEl) {
			watermarkEl.style.opacity = "0";
		}
	}, FADE_TIMEOUT);
}

function onMouseMove(): void {
	if (!watermarkEl) return;
	watermarkEl.style.opacity = "1";
	resetFadeTimer();
}

// --- Public API ---

export function toggleInfoPanel(): boolean {
	if (panelEl) {
		hideInfoPanel();
		return false;
	}
	showInfoPanel();
	return true;
}

export function showInfoPanel(): void {
	if (panelEl) return;
	panelEl = createPanel();
	document.body.appendChild(panelEl);
}

export function hideInfoPanel(): void {
	if (!panelEl) return;
	panelEl.remove();
	panelEl = null;
}

export function isInfoPanelVisible(): boolean {
	return panelEl !== null;
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
	if (panelEl) {
		panelEl.remove();
		panelEl = null;
	}
}
