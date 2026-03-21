/**
 * Creative presets system.
 * Save and load parameter configurations for creative params only.
 * Built-in presets ship with the app; user presets persist in localStorage.
 * When running under the Vite dev server, presets are also synced to a
 * shared JSON file so they are automatically available across all devices.
 */

import defaults from "../params.json";
import customPresets from "./custom-presets.json";
import { batchParamUpdate, params } from "./params";

const STORAGE_KEY = "rubato-presets";
const LAST_PRESET_KEY = "rubato-last-preset";

/** Cache of presets fetched from the dev server at startup. */
let serverPresets: Record<string, CreativePreset> = {};

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
		dramatic: {
			name: "dramatic",
			overlay: {
				showOverlay: true,
				visualize: "trail",
				opacity: 0.9,
				color: "#ff4400",
				colorMode: "aura",
				blur: 0,
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
				color: "#ff6633",
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
				blur: 0,
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
				color: "#aaccff",
			},
		},
		silhouette: {
			name: "silhouette",
			overlay: {
				showOverlay: true,
				visualize: "both",
				opacity: 0.85,
				color: "#ffffff",
				colorMode: "solid",
				blur: 0,
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
				color: "#ffffff",
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
				blur: 0,
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
				color: "#ff88ff",
			},
		},
	};
}

/** Load user-saved presets from localStorage, merged with custom-presets.json
 *  and server presets. Server presets take priority over the static import,
 *  and localStorage entries take priority over both. */
export function getSavedPresets(): Record<string, CreativePreset> {
	const custom = (customPresets ?? {}) as Record<string, CreativePreset>;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const local = raw
			? (JSON.parse(raw) as Record<string, CreativePreset>)
			: {};
		return { ...custom, ...serverPresets, ...local };
	} catch {
		return { ...custom, ...serverPresets };
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

// ── Dev-server preset sync ───────────────────────────────────────────

/** Fetch presets from the dev server. Falls back silently in production. */
export async function fetchServerPresets(): Promise<
	Record<string, CreativePreset>
> {
	try {
		const res = await fetch("/api/presets");
		if (!res.ok) return {};
		return (await res.json()) as Record<string, CreativePreset>;
	} catch {
		// No dev server (production build) — silently fall back.
		return {};
	}
}

/** POST a preset to the dev server so it is persisted in custom-presets.json. */
export async function syncPresetToServer(
	name: string,
	preset: CreativePreset,
): Promise<void> {
	try {
		await fetch("/api/presets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, preset }),
		});
	} catch {
		// Silently ignore — server may not be available.
	}
}

/** DELETE a preset from the dev server's custom-presets.json. */
export async function deletePresetFromServer(name: string): Promise<void> {
	try {
		await fetch(`/api/presets/${encodeURIComponent(name)}`, {
			method: "DELETE",
		});
	} catch {
		// Silently ignore — server may not be available.
	}
}

/** Load server presets into the local cache. Call once at startup. */
export async function initServerPresets(): Promise<void> {
	serverPresets = await fetchServerPresets();
}
