/** Control types for param UI */
export type ParamControlType = "slider" | "toggle" | "dropdown" | "color";

/** Definition of a single parameter control */
export interface ParamControlDef {
	section: string;
	key: string;
	label: string;
	type: ParamControlType;
	min?: number;
	max?: number;
	step?: number;
	options?: string[];
}

/** A group of related parameter controls */
export interface ParamSectionDef {
	name: string;
	controls: ParamControlDef[];
	defaultOpen?: boolean; // defaults to true if not specified
}

/**
 * Creative parameter schema — matches the "Creative" folder in gui.ts exactly.
 * These are the params exposed in the remote admin panel.
 *
 * IMPORTANT: If you change param ranges in gui.ts, update them here too.
 * Eventually gui.ts should also import from this schema.
 */
export const CREATIVE_PARAMS: ParamSectionDef[] = [
	{
		name: "Display",
		controls: [
			{
				section: "overlay",
				key: "showOverlay",
				label: "Show Overlay",
				type: "toggle",
			},
			{
				section: "overlay",
				key: "visualize",
				label: "Visualize",
				type: "dropdown",
				options: ["mask", "motion", "trail", "both", "imprint"],
			},
		],
	},
	{
		name: "Overlay Style",
		controls: [
			{
				section: "overlay",
				key: "opacity",
				label: "Opacity",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
			{ section: "overlay", key: "color", label: "Color", type: "color" },
			{
				section: "overlay",
				key: "colorMode",
				label: "Color Mode",
				type: "dropdown",
				options: ["solid", "rainbow", "gradient", "contour", "invert", "aura"],
			},
			{
				section: "overlay",
				key: "blur",
				label: "Blur",
				type: "slider",
				min: 0,
				max: 5,
				step: 1,
			},
		],
	},
	{
		name: "Trails",
		controls: [
			{
				section: "motion",
				key: "deposition",
				label: "Deposition",
				type: "slider",
				min: 0,
				max: 100,
				step: 1,
			},
			{
				section: "motion",
				key: "decay",
				label: "Decay",
				type: "slider",
				min: 0.9,
				max: 0.999,
				step: 0.001,
			},
		],
	},
	{
		name: "Density (Imprint)",
		defaultOpen: false,
		controls: [
			{
				section: "density",
				key: "cultivationRate",
				label: "Cultivation Rate",
				type: "slider",
				min: 0.001,
				max: 5.0,
				step: 0.01,
			},
			{
				section: "density",
				key: "channelStrength",
				label: "Channel Strength",
				type: "slider",
				min: 0,
				max: 500.0,
				step: 1.0,
			},
			{
				section: "density",
				key: "drainRate",
				label: "Drain Rate",
				type: "slider",
				min: 0,
				max: 0.99,
				step: 0.01,
			},
			{
				section: "density",
				key: "diffusionRate",
				label: "Diffusion Rate",
				type: "slider",
				min: 0,
				max: 1.0,
				step: 0.01,
			},
			{
				section: "density",
				key: "diffusionMode",
				label: "Diffusion Mode",
				type: "dropdown",
				options: ["isotropic", "anisotropic"],
			},
			{
				section: "density",
				key: "decayVariance",
				label: "Decay Variance",
				type: "slider",
				min: 0,
				max: 0.5,
				step: 0.01,
			},
			{
				section: "density",
				key: "disintegrationSpeed",
				label: "Disintegration Speed",
				type: "slider",
				min: 0.01,
				max: 0.5,
				step: 0.01,
			},
		],
	},
	{
		name: "Backdrop",
		controls: [
			{
				section: "fog",
				key: "mode",
				label: "Mode",
				type: "dropdown",
				options: ["classic", "shadow"],
			},
		],
	},
	{
		name: "Fog",
		controls: [
			{
				section: "fog",
				key: "speed",
				label: "Speed",
				type: "slider",
				min: 0,
				max: 0.5,
				step: 0.01,
			},
			{
				section: "fog",
				key: "scale",
				label: "Scale",
				type: "slider",
				min: 0.5,
				max: 10,
				step: 0.25,
			},
			{
				section: "fog",
				key: "density",
				label: "Density",
				type: "slider",
				min: 0.5,
				max: 3,
				step: 0.1,
			},
			{
				section: "fog",
				key: "brightness",
				label: "Brightness",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
			{ section: "fog", key: "color", label: "Color", type: "color" },
			{
				section: "fog",
				key: "maskInteraction",
				label: "Mask \u2192 Fog",
				type: "slider",
				min: 0,
				max: 2,
				step: 0.1,
			},
			{
				section: "fog",
				key: "trailInteraction",
				label: "Trail \u2192 Fog",
				type: "slider",
				min: 0,
				max: 50,
				step: 0.5,
			},
		],
	},
	{
		name: "Shadow",
		defaultOpen: false,
		controls: [
			{
				section: "shadow",
				key: "forceScale",
				label: "Force Scale",
				type: "slider",
				min: 0,
				max: 2,
				step: 0.05,
			},
			{
				section: "shadow",
				key: "damping",
				label: "Damping",
				type: "slider",
				min: 0.9,
				max: 0.999,
				step: 0.001,
			},
			{
				section: "shadow",
				key: "diffusion",
				label: "Diffusion",
				type: "slider",
				min: 0,
				max: 0.5,
				step: 0.01,
			},
			{
				section: "shadow",
				key: "advection",
				label: "Advection",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
			{
				section: "shadow",
				key: "noiseScale",
				label: "Noise Scale",
				type: "slider",
				min: 0.5,
				max: 10,
				step: 0.25,
			},
			{
				section: "shadow",
				key: "noiseSpeed",
				label: "Noise Speed",
				type: "slider",
				min: 0,
				max: 0.2,
				step: 0.005,
			},
			{
				section: "shadow",
				key: "noiseAmount",
				label: "Noise Amount",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
			{
				section: "shadow",
				key: "baseColor",
				label: "Base Color",
				type: "color",
			},
			{
				section: "shadow",
				key: "highlightColor",
				label: "Highlight Color",
				type: "color",
			},
			{
				section: "shadow",
				key: "baseDensity",
				label: "Base Density",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
			{
				section: "shadow",
				key: "creepSpeed",
				label: "Creep Speed",
				type: "slider",
				min: 0,
				max: 0.1,
				step: 0.005,
			},
			{
				section: "shadow",
				key: "pressureIterations",
				label: "Pressure Iters",
				type: "slider",
				min: 5,
				max: 40,
				step: 1,
			},
		],
	},
	{
		name: "Detection",
		controls: [
			{
				section: "segmentation",
				key: "confidenceThreshold",
				label: "Confidence",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
			{
				section: "segmentation",
				key: "temporalSmoothing",
				label: "Temporal Smoothing",
				type: "slider",
				min: 0,
				max: 0.95,
				step: 0.05,
			},
			{
				section: "segmentation",
				key: "motionThreshold",
				label: "Motion Threshold",
				type: "slider",
				min: 0,
				max: 1.0,
				step: 0.05,
			},
		],
	},
];
