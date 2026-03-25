import type { CreativePreset } from "./presets.js";

/**
 * Encode a preset into a URL hash string.
 * Uses base64-encoded JSON. The hash includes a version prefix
 * for forward compatibility.
 */
export function encodePresetHash(preset: CreativePreset): string {
	// Strip the "name" field — it's metadata, not params
	const { name, ...params } = preset;
	const json = JSON.stringify(params);
	// Use btoa for base64 encoding (browser-safe)
	const encoded = btoa(json);
	return `p1:${encoded}`; // "p1" = preset format version 1
}

/**
 * Decode a preset from a URL hash string.
 * Returns null if the hash is invalid or not a preset.
 */
export function decodePresetHash(hash: string): CreativePreset | null {
	try {
		// Strip leading # if present
		const raw = hash.startsWith("#") ? hash.slice(1) : hash;

		// Check version prefix
		if (!raw.startsWith("p1:")) return null;

		const encoded = raw.slice(3);
		const json = atob(encoded);
		const params = JSON.parse(json);

		// Basic validation — must have at least overlay and camera sections
		if (!params.overlay || !params.camera) return null;

		return { name: "shared", ...params } as CreativePreset;
	} catch {
		return null;
	}
}

/**
 * Build a full shareable URL for a preset.
 * Uses the current page origin with the preset encoded in the hash.
 */
export function buildPresetUrl(preset: CreativePreset): string {
	const hash = encodePresetHash(preset);
	return `${window.location.origin}/#${hash}`;
}

/**
 * Check the current page URL for a preset hash and return it if found.
 * Returns null if no preset is in the URL.
 */
export function getPresetFromUrl(): CreativePreset | null {
	if (!window.location.hash) return null;
	return decodePresetHash(window.location.hash);
}
