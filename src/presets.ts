/**
 * Creative presets system.
 * Save and load parameter configurations for creative params only.
 * Built-in presets ship with the app; user presets persist in localStorage.
 */

import defaults from "../params.json";
import customPresets from "./custom-presets.json";
import { params } from "./params";

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
	};
	motion: {
		deposition: number;
		decay: number;
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
		speed: number;
		scale: number;
		density: number;
		brightness: number;
	};
}

/** Snapshot the current creative params into a preset. */
export function extractPreset(name: string): CreativePreset {
	return {
		name,
		overlay: {
			showOverlay: params.overlay.showOverlay,
			visualize: params.overlay.visualize,
			opacity: params.overlay.opacity,
			color: params.overlay.color,
			colorMode: params.overlay.colorMode,
		},
		motion: {
			deposition: params.motion.deposition,
			decay: params.motion.decay,
		},
		segmentation: {
			confidenceThreshold: params.segmentation.confidenceThreshold,
			temporalSmoothing: params.segmentation.temporalSmoothing,
			motionThreshold: params.segmentation.motionThreshold,
		},
		camera: {
			showFeed: params.camera.showFeed,
			fillAmount: params.camera.fillAmount,
		},
		fog: {
			speed: params.fog.speed,
			scale: params.fog.scale,
			density: params.fog.density,
			brightness: params.fog.brightness,
		},
	};
}

/** Apply a preset by writing its values back into the reactive params. */
export function applyPreset(preset: CreativePreset): void {
	// Overlay
	params.overlay.showOverlay = preset.overlay.showOverlay;
	params.overlay.visualize = preset.overlay
		.visualize as typeof params.overlay.visualize;
	params.overlay.opacity = preset.overlay.opacity;
	params.overlay.color = preset.overlay.color;
	params.overlay.colorMode = preset.overlay
		.colorMode as typeof params.overlay.colorMode;

	// Motion
	params.motion.deposition = preset.motion.deposition;
	params.motion.decay = preset.motion.decay;

	// Segmentation
	params.segmentation.confidenceThreshold =
		preset.segmentation.confidenceThreshold;
	params.segmentation.temporalSmoothing = preset.segmentation.temporalSmoothing;
	params.segmentation.motionThreshold = preset.segmentation.motionThreshold;

	// Camera
	params.camera.showFeed = preset.camera.showFeed;
	params.camera.fillAmount = preset.camera.fillAmount;

	// Fog
	params.fog.speed = preset.fog.speed;
	params.fog.scale = preset.fog.scale;
	params.fog.density = preset.fog.density;
	params.fog.brightness = preset.fog.brightness;
}

const d = defaults;

/** Ship a handful of built-in presets. */
export function getBuiltInPresets(): Record<string, CreativePreset> {
	return {
		default: {
			name: "default",
			overlay: {
				showOverlay: d.overlay.showOverlay,
				visualize: d.overlay.visualize,
				opacity: d.overlay.opacity,
				color: d.overlay.color,
				colorMode: d.overlay.colorMode,
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
			},
		},
		dramatic: {
			name: "dramatic",
			overlay: {
				showOverlay: true,
				visualize: "trail",
				opacity: 0.9,
				color: "#ff4400",
				colorMode: "aura",
			},
			motion: {
				deposition: 12,
				decay: 0.995,
			},
			segmentation: {
				confidenceThreshold: 0.6,
				temporalSmoothing: 0.7,
				motionThreshold: 0.05,
			},
			camera: {
				showFeed: true,
				fillAmount: 1.0,
			},
			fog: {
				speed: 0.08,
				scale: 5.0,
				density: 2.0,
				brightness: 0.6,
			},
		},
		subtle: {
			name: "subtle",
			overlay: {
				showOverlay: true,
				visualize: "mask",
				opacity: 0.25,
				color: "#88ccff",
				colorMode: "solid",
			},
			motion: {
				deposition: 0.8,
				decay: 0.93,
			},
			segmentation: {
				confidenceThreshold: 0.5,
				temporalSmoothing: 0.4,
				motionThreshold: 0.15,
			},
			camera: {
				showFeed: true,
				fillAmount: 1.0,
			},
			fog: {
				speed: 0.2,
				scale: 4.0,
				density: 0.8,
				brightness: 0.3,
			},
		},
		silhouette: {
			name: "silhouette",
			overlay: {
				showOverlay: true,
				visualize: "trail",
				opacity: 0.85,
				color: "#ffffff",
				colorMode: "invert",
			},
			motion: {
				deposition: 6,
				decay: 0.98,
			},
			segmentation: {
				confidenceThreshold: 0.7,
				temporalSmoothing: 0.6,
				motionThreshold: 0.08,
			},
			camera: {
				showFeed: false,
				fillAmount: 1.0,
			},
			fog: {
				speed: 0.05,
				scale: 6.0,
				density: 1.5,
				brightness: 0.2,
			},
		},
		rainbow: {
			name: "rainbow",
			overlay: {
				showOverlay: true,
				visualize: "both",
				opacity: 0.75,
				color: "#ffffff",
				colorMode: "rainbow",
			},
			motion: {
				deposition: 4,
				decay: 0.96,
			},
			segmentation: {
				confidenceThreshold: 0.5,
				temporalSmoothing: 0.5,
				motionThreshold: 0.1,
			},
			camera: {
				showFeed: true,
				fillAmount: 1.0,
			},
			fog: {
				speed: 0.15,
				scale: 3.0,
				density: 1.2,
				brightness: 0.5,
			},
		},
	};
}

/** Load user-saved presets from localStorage, merged with custom-presets.json.
 *  localStorage entries take priority over custom-presets.json entries. */
export function getSavedPresets(): Record<string, CreativePreset> {
	const custom = (customPresets ?? {}) as Record<string, CreativePreset>;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const local = raw
			? (JSON.parse(raw) as Record<string, CreativePreset>)
			: {};
		return { ...custom, ...local };
	} catch {
		return { ...custom };
	}
}

/** Export all saved presets (localStorage + custom-presets.json merged) as a JSON string. */
export function exportAllPresets(): string {
	return JSON.stringify(getSavedPresets(), null, "\t");
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

/** Save a preset to localStorage. */
export function savePreset(name: string, preset: CreativePreset): void {
	const saved = getSavedPresets();
	saved[name] = preset;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
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
	const saved = getSavedPresets();
	delete saved[name];
	localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}
