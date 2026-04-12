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
import { showToast } from "./toast";

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
		onSwitchCallback?.();

		// Show friendly name (strip "* " prefix for user presets)
		const display = name.startsWith("* ") ? name.slice(2) : name;
		showToast(display);
	}
}

let onSwitchCallback: (() => void) | null = null;

// ── Init ─────────────────────────────────────────────────────────────

/** Initialize the preset switcher. Optional callback fires after each switch. */
export function initPresetSwitcher(onSwitch?: () => void): void {
	onSwitchCallback = onSwitch ?? null;
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
