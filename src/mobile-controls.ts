import { hasMultipleCameras } from "./camera";
import { isMobile } from "./device";

const CAMERA_FLIP_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>
  <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/>
  <circle cx="12" cy="12" r="3"/>
  <path d="M18 2l2 2-2 2"/>
  <path d="M6 22l-2-2 2-2"/>
</svg>`;

const FULLSCREEN_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="15 3 21 3 21 9"/>
  <polyline points="9 21 3 21 3 15"/>
  <line x1="21" y1="3" x2="14" y2="10"/>
  <line x1="3" y1="21" x2="10" y2="14"/>
</svg>`;

const BUTTON_STYLE = [
	"width: 48px",
	"height: 48px",
	"border-radius: 50%",
	"background: rgba(255,255,255,0.15)",
	"backdrop-filter: blur(8px)",
	"border: 1px solid rgba(255,255,255,0.2)",
	"color: #fff",
	"display: flex",
	"align-items: center",
	"justify-content: center",
	"cursor: pointer",
	"-webkit-tap-highlight-color: transparent",
	"transition: background 0.15s ease",
	"padding: 0",
].join(";");

function createButton(icon: string, label: string): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.innerHTML = icon;
	btn.setAttribute("aria-label", label);
	btn.style.cssText = BUTTON_STYLE;

	btn.addEventListener("touchstart", () => {
		btn.style.background = "rgba(255,255,255,0.3)";
	});
	btn.addEventListener("touchend", () => {
		btn.style.background = "rgba(255,255,255,0.15)";
	});
	btn.addEventListener("touchcancel", () => {
		btn.style.background = "rgba(255,255,255,0.15)";
	});

	return btn;
}

function supportsFullscreen(): boolean {
	const el = document.documentElement as HTMLElement & {
		webkitRequestFullscreen?: () => Promise<void>;
	};
	return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

function toggleFullscreen(): void {
	const doc = document as Document & {
		webkitFullscreenElement?: Element | null;
		webkitExitFullscreen?: () => Promise<void>;
	};
	const el = document.documentElement as HTMLElement & {
		webkitRequestFullscreen?: () => Promise<void>;
	};

	const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);

	if (isFullscreen) {
		if (doc.exitFullscreen) {
			doc.exitFullscreen();
		} else if (doc.webkitExitFullscreen) {
			doc.webkitExitFullscreen();
		}
	} else {
		if (el.requestFullscreen) {
			el.requestFullscreen();
		} else if (el.webkitRequestFullscreen) {
			el.webkitRequestFullscreen();
		}
	}
}

export async function initMobileControls(options: {
	onFlipCamera: () => void;
}): Promise<void> {
	if (!isMobile()) return;

	const container = document.createElement("div");
	container.style.cssText = [
		"position: fixed",
		"bottom: calc(24px + env(safe-area-inset-bottom, 0px))",
		"right: 24px",
		"display: flex",
		"flex-direction: column",
		"gap: 12px",
		"z-index: 9998",
		"pointer-events: auto",
	].join(";");

	// Camera flip button — only if multiple cameras available
	const multiCam = await hasMultipleCameras();
	if (multiCam) {
		const flipBtn = createButton(CAMERA_FLIP_ICON, "Flip camera");
		flipBtn.addEventListener("click", options.onFlipCamera);
		container.appendChild(flipBtn);
	}

	// Fullscreen button — only if API is available
	if (supportsFullscreen()) {
		const fsBtn = createButton(FULLSCREEN_ICON, "Toggle fullscreen");
		fsBtn.addEventListener("click", toggleFullscreen);
		container.appendChild(fsBtn);
	}

	// Only add container if it has at least one button
	if (container.children.length > 0) {
		document.body.appendChild(container);
	}
}
