import { describe, it, expect } from "vitest";
import { encodePresetHash, decodePresetHash } from "../src/preset-url";
import type { CreativePreset } from "../src/presets";

/** Helper: build a minimal valid preset for URL encoding tests. */
function makeTestPreset(name: string): CreativePreset {
	return {
		name,
		overlay: {
			showOverlay: true,
			visualize: "trail",
			opacity: 0.75,
			color: "#ff4400",
			colorMode: "aura",
			blur: 1,
		},
		motion: {
			deposition: 10,
			decay: 0.99,
		},
		segmentation: {
			confidenceThreshold: 0.6,
			temporalSmoothing: 0.5,
			motionThreshold: 0.08,
		},
		camera: {
			showFeed: true,
			fillAmount: 1.0,
		},
		fog: {
			speed: 0.1,
			scale: 4.0,
			density: 1.5,
			brightness: 0.5,
			color: "#ff6633",
		},
	};
}

describe("preset URL encoding", () => {
	it("round-trip: encode then decode preserves all values", () => {
		const original = makeTestPreset("my-preset");
		const hash = encodePresetHash(original);
		const decoded = decodePresetHash(hash);

		expect(decoded).not.toBeNull();
		// Name is replaced with "shared" on decode
		expect(decoded!.overlay).toEqual(original.overlay);
		expect(decoded!.motion).toEqual(original.motion);
		expect(decoded!.segmentation).toEqual(original.segmentation);
		expect(decoded!.camera).toEqual(original.camera);
		expect(decoded!.fog).toEqual(original.fog);
	});

	it("decodePresetHash returns null for invalid input", () => {
		expect(decodePresetHash("")).toBeNull();
		expect(decodePresetHash("garbage")).toBeNull();
		expect(decodePresetHash("#notapreset")).toBeNull();
	});

	it("decodePresetHash returns null for wrong version prefix", () => {
		expect(decodePresetHash("p2:abc")).toBeNull();
	});

	it("strips leading # from hash", () => {
		const preset = makeTestPreset("hash-test");
		const hash = encodePresetHash(preset);

		// Prepend # and decode — should work
		const decoded = decodePresetHash(`#${hash}`);
		expect(decoded).not.toBeNull();
		expect(decoded!.overlay).toEqual(preset.overlay);
	});

	it("decoded preset has name 'shared'", () => {
		const preset = makeTestPreset("original-name");
		const hash = encodePresetHash(preset);
		const decoded = decodePresetHash(hash);

		expect(decoded).not.toBeNull();
		expect(decoded!.name).toBe("shared");
	});

	it("encodePresetHash strips the name field", () => {
		const preset = makeTestPreset("should-be-stripped");
		const hash = encodePresetHash(preset);

		// Decode the base64 portion and check name is not present
		const encoded = hash.slice(3); // strip "p1:"
		const json = atob(encoded);
		const parsed = JSON.parse(json);
		expect(parsed).not.toHaveProperty("name");
	});
});
