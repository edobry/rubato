/**
 * Creative presets system.
 * Save and load parameter configurations for creative params only.
 * Bundled presets ship with the app (read-only); user presets persist in localStorage (read-write).
 */

import bundledPresets from "../bundled-presets.json";
import defaults from "../params.json";
import { CREATIVE_PARAMS } from "./param-schema.js";
import { batchParamUpdate, params } from "./params";

const STORAGE_KEY = "rubato-presets";
const LAST_PRESET_KEY = "rubato-last-preset";

/** The subset of params that a creative preset captures. */
export interface CreativePreset {
	name: string;
	overlay: {
		showOverlay: boolean;
		visualize: string;
		opacity: number;
		color: string;
		colorMode: string;
		blur: number;
	};
	motion: {
		deposition: number;
		decay: number;
	};
	density?: {
		cultivationRate: number;
		channelStrength: number;
		drainRate: number;
		diffusionRate: number;
		decayVariance: number;
		disintegrationSpeed: number;
	};
	segmentation: {
		confidenceThreshold: number;
		temporalSmoothing: number;
		motionThreshold: number;
	};
	camera: {
		showFeed: boolean;
		fillAmount: number;
	};
	fog: {
		mode?: string;
		speed: number;
		scale: number;
		density: number;
		brightness: number;
		color: string;
	};
	shadow?: {
		forceScale: number;
		damping: number;
		diffusion: number;
		advection: number;
		noiseScale: number;
		noiseSpeed: number;
		noiseAmount: number;
		baseColor: string;
		highlightColor: string;
		baseDensity: number;
		creepSpeed: number;
	};
}

/** Snapshot the current creative params into a preset. */
export function extractPreset(name: string): CreativePreset {
	const result: Record<string, Record<string, unknown>> = {};
	for (const section of CREATIVE_PARAMS) {
		for (const control of section.controls) {
			const paramSection = params[control.section as keyof typeof params];
			if (paramSection && control.key in paramSection) {
				if (!result[control.section]) result[control.section] = {};
				result[control.section]![control.key] =
					paramSection[control.key as keyof typeof paramSection];
			}
		}
	}
	return { name, ...result } as CreativePreset;
}

/** Apply a preset by writing its values back into the reactive params.
 *  All writes are batched so listeners fire once after all changes,
 *  preventing intermediate-state bugs. */
export function applyPreset(preset: CreativePreset): void {
	batchParamUpdate(() => {
		for (const section of CREATIVE_PARAMS) {
			for (const control of section.controls) {
				const presetSection = (
					preset as unknown as Record<string, Record<string, unknown>>
				)[control.section];
				if (!presetSection || !(control.key in presetSection)) continue;

				const paramSection = params[control.section as keyof typeof params];
				if (!paramSection || !(control.key in paramSection)) continue;

				const value = presetSection[control.key];
				if (value !== undefined) {
					(paramSection as Record<string, unknown>)[control.key] = value;
				}
			}
		}
	});
}

/** Ship a handful of bundled presets. */
export function getBundledPresets(): Record<string, CreativePreset> {
	const d = defaults;
	return {
		default: {
			name: "default",
			overlay: {
				showOverlay: d.overlay.showOverlay,
				visualize: d.overlay.visualize,
				opacity: d.overlay.opacity,
				color: d.overlay.color,
				colorMode: d.overlay.colorMode,
				blur: d.overlay.blur,
			},
			motion: {
				deposition: d.motion.deposition,
				decay: d.motion.decay,
			},
			segmentation: {
				confidenceThreshold: d.segmentation.confidenceThreshold,
				temporalSmoothing: d.segmentation.temporalSmoothing,
				motionThreshold: d.segmentation.motionThreshold,
			},
			camera: {
				showFeed: d.camera.showFeed,
				fillAmount: d.camera.fillAmount,
			},
			fog: {
				speed: d.fog.speed,
				scale: d.fog.scale,
				density: d.fog.density,
				brightness: d.fog.brightness,
				color: d.fog.color,
			},
		},
		...(bundledPresets as Record<string, CreativePreset>),
	};
}

/** Load user-saved presets from localStorage. */
export function getUserPresets(): Record<string, CreativePreset> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Record<string, CreativePreset>) : {};
	} catch {
		return {};
	}
}

/** Get all presets: bundled (read-only) + user (read-write).
 *  User presets with the same name as bundled presets shadow them. */
export function getAllPresets(): Record<string, CreativePreset> {
	return { ...getBundledPresets(), ...getUserPresets() };
}

/** Export all user presets as a JSON string. */
export function exportAllPresets(): string {
	return JSON.stringify(getUserPresets(), null, "\t");
}

/** Import presets from a JSON string into localStorage. Returns the count of presets imported. */
export function importPresets(json: string): number {
	const incoming = JSON.parse(json) as Record<string, CreativePreset>;
	const entries = Object.entries(incoming);
	for (const [name, preset] of entries) {
		savePreset(name, { ...preset, name });
	}
	return entries.length;
}

/** Save a preset to localStorage (user presets only). */
export function savePreset(name: string, preset: CreativePreset): void {
	const userPresets = getUserPresets();
	userPresets[name] = preset;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(userPresets));
}

/** Get the last-used preset name from localStorage. */
export function getLastPreset(): string {
	return localStorage.getItem(LAST_PRESET_KEY) ?? "default";
}

/** Save the last-used preset name to localStorage. */
export function setLastPreset(name: string): void {
	localStorage.setItem(LAST_PRESET_KEY, name);
}

/** Delete a user-saved preset from localStorage. */
export function deletePreset(name: string): void {
	const userPresets = getUserPresets();
	delete userPresets[name];
	localStorage.setItem(STORAGE_KEY, JSON.stringify(userPresets));
}
