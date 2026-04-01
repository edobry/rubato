/**
 * Preset switcher — cycle through presets with arrow keys or swipe gestures
 * when the params panel is closed.
 *
 * Left arrow / swipe-left  → previous preset
 * Right arrow / swipe-right → next preset
 *
 * A toast notification shows the preset name briefly on each switch.
 */

import { isGuiVisible } from "./gui";
import {
	applyPreset,
	type CreativePreset,
	getBundledPresets,
	getLastPreset,
	getUserPresets,
	setLastPreset,
} from "./presets";

/** Build the ordered list of preset names (bundled + user). */
function getPresetNames(): string[] {
	const bundled = Object.keys(getBundledPresets());
	const user = Object.keys(getUserPresets()).map((n) => `* ${n}`);
	return [...bundled, ...user];
}

/** Resolve a display name to its preset object. */
function resolvePreset(displayName: string): CreativePreset | null {
	const bundled = getBundledPresets();
	if (displayName in bundled) return bundled[displayName]!;
	if (displayName.startsWith("* ")) {
		const name = displayName.slice(2);
		const user = getUserPresets();
		if (name in user) return user[name]!;
	}
	return null;
}

// ── Toast ────────────────────────────────────────────────────────────

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(text: string): void {
	if (!toastEl) {
		toastEl = document.createElement("div");
		toastEl.style.cssText = `
			position: fixed;
			bottom: 48px;
			left: 50%;
			transform: translateX(-50%);
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
			font-size: 20px;
			font-weight: 300;
			letter-spacing: 0.12em;
			color: #fff;
			text-shadow: 0 0 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7);
			background: rgba(0,0,0,0.4);
			padding: 8px 20px;
			border-radius: 8px;
			z-index: 9000;
			pointer-events: none;
			opacity: 0;
			transition: opacity 0.3s ease;
			-webkit-font-smoothing: antialiased;
		`;
		document.body.appendChild(toastEl);
	}

	toastEl.textContent = text;
	toastEl.style.opacity = "1";

	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		if (toastEl) toastEl.style.opacity = "0";
		toastTimer = null;
	}, 2000);
}

// ── Cycling ──────────────────────────────────────────────────────────

function cyclePreset(direction: 1 | -1): void {
	const names = getPresetNames();
	if (names.length === 0) return;

	const current = getLastPreset();
	let idx = names.indexOf(current);
	if (idx === -1) idx = 0;
	idx = (idx + direction + names.length) % names.length;

	const name = names[idx]!;
	const preset = resolvePreset(name);
	if (preset) {
		applyPreset(preset);
		setLastPreset(name);

		// Show friendly name (strip "* " prefix for user presets)
		const display = name.startsWith("* ") ? name.slice(2) : name;
		showToast(display);
	}
}

// ── Init ─────────────────────────────────────────────────────────────

export function initPresetSwitcher(): void {
	// Keyboard: left/right arrows when GUI is hidden
	window.addEventListener("keydown", (e) => {
		if (isGuiVisible()) return;
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;

		if (e.key === "ArrowLeft") {
			e.preventDefault();
			cyclePreset(-1);
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			cyclePreset(1);
		}
	});

	// Touch: swipe left/right
	let touchStartX = 0;
	let touchStartY = 0;

	window.addEventListener(
		"touchstart",
		(e) => {
			if (e.touches.length === 1) {
				touchStartX = e.touches[0]!.clientX;
				touchStartY = e.touches[0]!.clientY;
			}
		},
		{ passive: true },
	);

	window.addEventListener(
		"touchend",
		(e) => {
			if (isGuiVisible()) return;
			if (e.changedTouches.length !== 1) return;

			const dx = e.changedTouches[0]!.clientX - touchStartX;
			const dy = e.changedTouches[0]!.clientY - touchStartY;

			// Only trigger if horizontal movement > 50px and dominates vertical
			if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				cyclePreset(dx > 0 ? -1 : 1);
			}
		},
		{ passive: true },
	);
}
