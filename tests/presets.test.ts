import { describe, it, expect, beforeEach } from "vitest";
import {
	getBundledPresets,
	getUserPresets,
	getAllPresets,
	savePreset,
	deletePreset,
	extractPreset,
	applyPreset,
	exportAllPresets,
	importPresets,
	type CreativePreset,
} from "../src/presets";
import { CREATIVE_PARAMS } from "../src/param-schema";
import { params } from "../src/params";

/** Helper: build a minimal valid preset for testing. */
function makeTestPreset(name: string): CreativePreset {
	return {
		name,
		overlay: {
			showOverlay: true,
			visualize: "mask",
			opacity: 0.42,
			color: "#112233",
			colorMode: "solid",
			blur: 2,
		},
		motion: {
			deposition: 7,
			decay: 0.97,
		},
		segmentation: {
			confidenceThreshold: 0.55,
			temporalSmoothing: 0.35,
			motionThreshold: 0.12,
		},
		fog: {
			speed: 0.1,
			scale: 4.0,
			density: 1.5,
			brightness: 0.3,
			color: "#aabbcc",
		},
	};
}

describe("preset storage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("getBundledPresets returns default + bundled presets", () => {
		const bundled = getBundledPresets();
		expect(bundled).toHaveProperty("default");
		expect(bundled).toHaveProperty("taichi");
		expect(bundled).toHaveProperty("shadow realm");
		expect(bundled).toHaveProperty("silhouette");
		expect(bundled).toHaveProperty("sarahdance");
	});

	it("getUserPresets returns empty when no presets saved", () => {
		const user = getUserPresets();
		expect(user).toEqual({});
	});

	it("savePreset writes to localStorage", () => {
		const preset = makeTestPreset("mypreset");
		savePreset("mypreset", preset);

		const user = getUserPresets();
		expect(user).toHaveProperty("mypreset");
		expect(user.mypreset!.overlay.opacity).toBe(0.42);
	});

	it("savePreset does not contaminate localStorage with bundled presets", () => {
		// Save one user preset
		savePreset("mypreset", makeTestPreset("mypreset"));

		// Read localStorage directly
		const raw = localStorage.getItem("rubato-presets");
		expect(raw).not.toBeNull();
		const stored = JSON.parse(raw!);

		// Only the user preset should be in localStorage
		expect(Object.keys(stored)).toEqual(["mypreset"]);
		expect(stored).not.toHaveProperty("taichi");
		expect(stored).not.toHaveProperty("shadow realm");
		expect(stored).not.toHaveProperty("silhouette");
		expect(stored).not.toHaveProperty("sarahdance");
		expect(stored).not.toHaveProperty("default");
	});

	it("deletePreset removes from localStorage", () => {
		savePreset("mypreset", makeTestPreset("mypreset"));
		expect(getUserPresets()).toHaveProperty("mypreset");

		deletePreset("mypreset");
		expect(getUserPresets()).not.toHaveProperty("mypreset");
	});

	it("deletePreset does not affect bundled presets", () => {
		// Try to delete a bundled preset name
		deletePreset("taichi");

		// It should still appear in bundled presets
		const bundled = getBundledPresets();
		expect(bundled).toHaveProperty("taichi");
	});

	it("getAllPresets merges bundled and user", () => {
		savePreset("mypreset", makeTestPreset("mypreset"));

		const all = getAllPresets();
		// Has bundled
		expect(all).toHaveProperty("default");
		expect(all).toHaveProperty("taichi");
		// Has user
		expect(all).toHaveProperty("mypreset");
	});

	it("user preset shadows bundled preset with same name", () => {
		const custom = makeTestPreset("taichi");
		custom.overlay.opacity = 0.11;
		savePreset("taichi", custom);

		const all = getAllPresets();
		// User version should win
		expect(all.taichi!.overlay.opacity).toBe(0.11);
	});

	it("exportAllPresets returns only user presets", () => {
		savePreset("mypreset", makeTestPreset("mypreset"));

		const json = exportAllPresets();
		const parsed = JSON.parse(json);

		expect(parsed).toHaveProperty("mypreset");
		expect(parsed).not.toHaveProperty("default");
		expect(parsed).not.toHaveProperty("taichi");
	});

	it("importPresets adds to user presets", () => {
		const toImport = {
			imported1: makeTestPreset("imported1"),
			imported2: makeTestPreset("imported2"),
		};

		const count = importPresets(JSON.stringify(toImport));
		expect(count).toBe(2);

		const user = getUserPresets();
		expect(user).toHaveProperty("imported1");
		expect(user).toHaveProperty("imported2");

		// Bundled presets should NOT be in localStorage
		const raw = localStorage.getItem("rubato-presets");
		const stored = JSON.parse(raw!);
		expect(stored).not.toHaveProperty("default");
		expect(stored).not.toHaveProperty("taichi");
	});
});

describe("extractPreset", () => {
	it("captures all params in CREATIVE_PARAMS schema", () => {
		const preset = extractPreset("test-extract");
		expect(preset.name).toBe("test-extract");

		// Every control in the schema should be present in the preset
		for (const section of CREATIVE_PARAMS) {
			for (const control of section.controls) {
				const presetSection = (preset as Record<string, unknown>)[
					control.section
				] as Record<string, unknown> | undefined;
				// The section must exist if the param exists on the reactive object
				const paramSection = params[
					control.section as keyof typeof params
				] as Record<string, unknown> | undefined;
				if (paramSection && control.key in paramSection) {
					expect(
						presetSection,
						`missing section "${control.section}" for ${control.section}.${control.key}`,
					).toBeDefined();
					expect(
						presetSection![control.key],
						`missing key "${control.section}.${control.key}"`,
					).toBeDefined();
				}
			}
		}
	});
});

describe("applyPreset", () => {
	it("writes all values to params", () => {
		const preset = makeTestPreset("apply-test");
		applyPreset(preset);

		expect(params.overlay.opacity).toBe(0.42);
		expect(params.overlay.color).toBe("#112233");
		expect(params.motion.deposition).toBe(7);
		expect(params.motion.decay).toBe(0.97);
		expect(params.segmentation.confidenceThreshold).toBe(0.55);
		expect(params.fog.speed).toBe(0.1);
	});

	it("handles missing optional sections gracefully", () => {
		// Preset without density or shadow sections
		const preset: CreativePreset = {
			name: "minimal",
			overlay: {
				showOverlay: true,
				visualize: "mask",
				opacity: 0.5,
				color: "#ffffff",
				colorMode: "solid",
				blur: 0,
			},
			motion: {
				deposition: 5,
				decay: 0.95,
			},
			segmentation: {
				confidenceThreshold: 0.5,
				temporalSmoothing: 0.4,
				motionThreshold: 0.1,
			},
			fog: {
				speed: 0.15,
				scale: 3.0,
				density: 1.2,
				brightness: 0.4,
				color: "#ffffff",
			},
		};

		// Should not throw
		expect(() => applyPreset(preset)).not.toThrow();
	});
});
