/**
 * Creative presets system.
 * Save and load parameter configurations for creative params only.
 * Bundled presets ship with the app (read-only); user presets persist in localStorage (read-write).
 */

import bundledPresets from "../bundled-presets.json";
import defaults from "../params.json";
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
	return {
		name,
		overlay: {
			showOverlay: params.overlay.showOverlay,
			visualize: params.overlay.visualize,
			opacity: params.overlay.opacity,
			color: params.overlay.color,
			colorMode: params.overlay.colorMode,
			blur: params.overlay.blur,
		},
		motion: {
			deposition: params.motion.deposition,
			decay: params.motion.decay,
		},
		density: {
			cultivationRate: params.density.cultivationRate,
			channelStrength: params.density.channelStrength,
			drainRate: params.density.drainRate,
			diffusionRate: params.density.diffusionRate,
			decayVariance: params.density.decayVariance,
			disintegrationSpeed: params.density.disintegrationSpeed,
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
			mode: params.fog.mode,
			speed: params.fog.speed,
			scale: params.fog.scale,
			density: params.fog.density,
			brightness: params.fog.brightness,
			color: params.fog.color,
		},
		shadow: {
			forceScale: params.shadow.forceScale,
			damping: params.shadow.damping,
			diffusion: params.shadow.diffusion,
			advection: params.shadow.advection,
			noiseScale: params.shadow.noiseScale,
			noiseSpeed: params.shadow.noiseSpeed,
			noiseAmount: params.shadow.noiseAmount,
			baseColor: params.shadow.baseColor,
			highlightColor: params.shadow.highlightColor,
			baseDensity: params.shadow.baseDensity,
			creepSpeed: params.shadow.creepSpeed,
		},
	};
}

/** Apply a preset by writing its values back into the reactive params.
 *  All writes are batched so listeners fire once after all changes,
 *  preventing intermediate-state bugs. */
export function applyPreset(preset: CreativePreset): void {
	batchParamUpdate(() => {
		// Overlay
		params.overlay.showOverlay = preset.overlay.showOverlay;
		params.overlay.visualize = preset.overlay
			.visualize as typeof params.overlay.visualize;
		params.overlay.opacity = preset.overlay.opacity;
		params.overlay.color = preset.overlay.color;
		params.overlay.colorMode = preset.overlay
			.colorMode as typeof params.overlay.colorMode;
		params.overlay.blur = preset.overlay.blur ?? 0;

		// Motion
		params.motion.deposition = preset.motion.deposition;
		params.motion.decay = preset.motion.decay;

		// Density (optional — older presets may not have this section)
		if (preset.density) {
			params.density.cultivationRate = preset.density.cultivationRate;
			params.density.channelStrength = preset.density.channelStrength;
			params.density.drainRate = preset.density.drainRate;
			params.density.diffusionRate = preset.density.diffusionRate;
			params.density.decayVariance = preset.density.decayVariance;
			params.density.disintegrationSpeed = preset.density.disintegrationSpeed;
		}

		// Segmentation
		params.segmentation.confidenceThreshold =
			preset.segmentation.confidenceThreshold;
		params.segmentation.temporalSmoothing =
			preset.segmentation.temporalSmoothing;
		params.segmentation.motionThreshold = preset.segmentation.motionThreshold;

		// Camera
		params.camera.showFeed = preset.camera.showFeed;
		params.camera.fillAmount = preset.camera.fillAmount;

		// Fog
		if (preset.fog.mode) {
			params.fog.mode = preset.fog.mode as typeof params.fog.mode;
		}
		params.fog.speed = preset.fog.speed;
		params.fog.scale = preset.fog.scale;
		params.fog.density = preset.fog.density;
		params.fog.brightness = preset.fog.brightness;
		params.fog.color = preset.fog.color ?? "#ffffff";

		// Shadow (optional — older presets won't have this)
		if (preset.shadow) {
			params.shadow.forceScale = preset.shadow.forceScale;
			params.shadow.damping = preset.shadow.damping;
			params.shadow.diffusion = preset.shadow.diffusion;
			params.shadow.advection = preset.shadow.advection;
			params.shadow.noiseScale = preset.shadow.noiseScale;
			params.shadow.noiseSpeed = preset.shadow.noiseSpeed;
			params.shadow.noiseAmount = preset.shadow.noiseAmount;
			params.shadow.baseColor = preset.shadow.baseColor;
			params.shadow.highlightColor = preset.shadow.highlightColor;
			params.shadow.baseDensity = preset.shadow.baseDensity;
			params.shadow.creepSpeed = preset.shadow.creepSpeed;
		}
	}); // end batchParamUpdate
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
