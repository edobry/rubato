/**
 * Admin overlay — press 'A' to toggle a compact info panel showing
 * the current preset name, server URL, and a QR code linking to the
 * mobile admin panel.
 */

import QRCode from "qrcode";
import { getLastPreset } from "./presets";

const STYLES = {
	overlay: `
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10001;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		color: #fff;
		-webkit-font-smoothing: antialiased;
		background: rgba(0, 0, 0, 0.6);
	`,
	panel: `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 40px 56px;
		background: #111;
		border-radius: 12px;
		border: 1px solid #333;
	`,
	presetLabel: `
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.08em;
		color: #999;
		margin: 0;
	`,
	presetName: `
		font-size: 24px;
		font-weight: 400;
		letter-spacing: 0.03em;
		margin: 4px 0 0 0;
		text-align: center;
		color: #fff;
	`,
	qrCanvas: `
		display: block;
	`,
	urlText: `
		font-size: 12px;
		color: #888;
		font-family: "SF Mono", Menlo, Consolas, monospace;
		letter-spacing: 0.02em;
		margin: 0;
	`,
	version: `
		font-size: 11px;
		color: #555;
		font-family: "SF Mono", Menlo, Consolas, monospace;
		letter-spacing: 0.02em;
		margin: 0;
	`,
	hint: `
		font-size: 12px;
		color: #777;
		letter-spacing: 0.05em;
		margin: 8px 0 0 0;
		padding: 8px 16px;
		border: 1px solid #333;
		border-radius: 6px;
	`,
} as const;

let overlayEl: HTMLElement | null = null;

function buildAdminUrl(): string {
	const tsHost: string | null = (globalThis as Record<string, unknown>)
		.__TAILSCALE_HOST__ as string | null;
	const origin = tsHost
		? `https://${tsHost}:${location.port}`
		: window.location.origin;
	return `${origin}/admin/`;
}

function formatPresetName(raw: string): string {
	// Strip the "* " prefix used for user presets in the dropdown
	return raw.startsWith("* ") ? raw.slice(2) : raw;
}

function createOverlay(): HTMLElement {
	const overlay = document.createElement("div");
	overlay.style.cssText = STYLES.overlay;

	const panel = document.createElement("div");
	panel.style.cssText = STYLES.panel;

	// Preset info
	const presetLabel = document.createElement("p");
	presetLabel.style.cssText = STYLES.presetLabel;
	presetLabel.textContent = "Active Preset";

	const presetName = document.createElement("p");
	presetName.style.cssText = STYLES.presetName;
	presetName.textContent = formatPresetName(getLastPreset());

	panel.appendChild(presetLabel);
	panel.appendChild(presetName);

	// QR code
	const adminUrl = buildAdminUrl();

	const canvas = document.createElement("canvas");
	canvas.style.cssText = STYLES.qrCanvas;

	QRCode.toCanvas(canvas, adminUrl, {
		width: 180,
		margin: 0,
		color: {
			dark: "#ffffff",
			light: "#111111",
		},
	});

	panel.appendChild(canvas);

	// URL text
	const urlText = document.createElement("p");
	urlText.style.cssText = STYLES.urlText;
	urlText.textContent = adminUrl;

	panel.appendChild(urlText);

	// Version
	const version = document.createElement("p");
	version.style.cssText = STYLES.version;
	version.textContent = `v: ${__GIT_HASH__}`;
	panel.appendChild(version);

	// Dismiss hint
	const hint = document.createElement("p");
	hint.style.cssText = STYLES.hint;
	hint.textContent = "press A or Escape to dismiss";

	panel.appendChild(hint);

	overlay.appendChild(panel);
	return overlay;
}

/** Toggle the admin overlay. Returns true if now visible. */
export function toggleAdminOverlay(): boolean {
	if (overlayEl) {
		overlayEl.remove();
		overlayEl = null;
		return false;
	}
	overlayEl = createOverlay();
	document.body.appendChild(overlayEl);
	return true;
}

/** Dismiss the admin overlay if it is currently showing. */
export function hideAdminOverlay(): void {
	if (overlayEl) {
		overlayEl.remove();
		overlayEl = null;
	}
}

/** Whether the admin overlay is currently visible. */
export function isAdminOverlayVisible(): boolean {
	return overlayEl !== null;
}
