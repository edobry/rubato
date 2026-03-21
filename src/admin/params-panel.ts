interface ParamControl {
	section: string;
	key: string;
	label: string;
	type: "slider" | "toggle" | "dropdown" | "color";
	min?: number;
	max?: number;
	step?: number;
	options?: string[];
}

interface ParamSection {
	name: string;
	controls: ParamControl[];
}

const PANEL_STATE_KEY = "rubato-admin-panel-state";

interface PanelUiState {
	panelOpen: boolean;
	sections: Record<string, boolean>;
}

function loadPanelState(): PanelUiState {
	try {
		const raw = localStorage.getItem(PANEL_STATE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return { panelOpen: false, sections: {} };
}

function savePanelState(state: PanelUiState): void {
	localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
}

const PARAM_SECTIONS: ParamSection[] = [
	{
		name: "Display",
		controls: [
			{
				section: "camera",
				key: "showFeed",
				label: "Show Feed",
				type: "toggle",
			},
			{
				section: "camera",
				key: "fillAmount",
				label: "Fill / Fit",
				type: "slider",
				min: 0,
				max: 1,
				step: 0.05,
			},
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
				max: 8,
				step: 0.1,
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
		controls: [
			{
				section: "density",
				key: "cultivationRate",
				label: "Cultivation Rate",
				type: "slider",
				min: 0.001,
				max: 0.15,
				step: 0.001,
			},
			{
				section: "density",
				key: "channelStrength",
				label: "Channel Strength",
				type: "slider",
				min: 0.5,
				max: 20.0,
				step: 0.1,
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
				max: 0.3,
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
		name: "Fog",
		controls: [
			{
				section: "fog",
				key: "mode",
				label: "Mode",
				type: "dropdown",
				options: ["classic", "shadow"],
			},
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
				label: "Mask → Fog",
				type: "slider",
				min: 0,
				max: 2,
				step: 0.1,
			},
			{
				section: "fog",
				key: "trailInteraction",
				label: "Trail → Fog",
				type: "slider",
				min: 0,
				max: 15,
				step: 0.1,
			},
		],
	},
	{
		name: "Shadow",
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

/** Compute the number of decimal places from a step value. */
function decimalsFromStep(step: number): number {
	const s = String(step);
	const dot = s.indexOf(".");
	return dot === -1 ? 0 : s.length - dot - 1;
}

/** Format a numeric value to the precision implied by step. */
function formatValue(value: number, step: number): string {
	return value.toFixed(decimalsFromStep(step));
}

interface ControlEntry {
	input: HTMLInputElement | HTMLSelectElement;
	valueDisplay: HTMLSpanElement | null;
	control: ParamControl;
}

export function createParamsPanel(options: {
	onParamChange: (
		section: string,
		key: string,
		value: number | string | boolean,
	) => void;
}): {
	element: HTMLElement;
	updateParams: (
		params: Record<string, Record<string, number | string | boolean>>,
	) => void;
} {
	const controlMap = new Map<string, ControlEntry>();
	const uiState = loadPanelState();

	// Root container
	const panel = document.createElement("div");
	panel.className = "params-panel";

	// Toggle button
	const toggle = document.createElement("button");
	toggle.className = "params-toggle";
	const toggleLabel = document.createElement("span");
	toggleLabel.textContent = "Parameters";
	const toggleChevron = document.createElement("span");
	toggleChevron.textContent = uiState.panelOpen ? "\u25BE" : "\u25B8";
	toggle.appendChild(toggleLabel);
	toggle.appendChild(toggleChevron);
	panel.appendChild(toggle);

	// Content wrapper
	const content = document.createElement("div");
	content.className = "params-content";
	content.style.display = uiState.panelOpen ? "" : "none";
	panel.appendChild(content);

	let expanded = uiState.panelOpen;
	toggle.addEventListener("click", () => {
		expanded = !expanded;
		content.style.display = expanded ? "" : "none";
		toggleChevron.textContent = expanded ? "\u25BE" : "\u25B8";
		uiState.panelOpen = expanded;
		savePanelState(uiState);
	});

	// Build sections
	for (const section of PARAM_SECTIONS) {
		const sectionEl = document.createElement("div");
		sectionEl.className = "param-section";

		const header = document.createElement("button");
		header.className = "section-header";
		const sectionSaved = uiState.sections[section.name] === true;
		header.innerHTML = `<span>${section.name}</span><span>${sectionSaved ? "\u25BE" : "\u25B8"}</span>`;
		sectionEl.appendChild(header);

		const sectionContent = document.createElement("div");
		sectionContent.className = "section-content";
		sectionContent.style.display = sectionSaved ? "" : "none";
		sectionEl.appendChild(sectionContent);

		let sectionExpanded = sectionSaved;
		header.addEventListener("click", () => {
			sectionExpanded = !sectionExpanded;
			sectionContent.style.display = sectionExpanded ? "" : "none";
			header.innerHTML = `<span>${section.name}</span><span>${sectionExpanded ? "\u25BE" : "\u25B8"}</span>`;
			uiState.sections[section.name] = sectionExpanded;
			savePanelState(uiState);
		});

		for (const ctrl of section.controls) {
			const controlEl = document.createElement("div");
			controlEl.className = "param-control";

			const mapKey = `${ctrl.section}.${ctrl.key}`;
			let valueDisplay: HTMLSpanElement | null = null;

			if (ctrl.type === "slider") {
				const label = document.createElement("div");
				label.className = "param-label";
				const nameSpan = document.createElement("span");
				nameSpan.textContent = ctrl.label;
				valueDisplay = document.createElement("span");
				valueDisplay.className = "param-value";
				valueDisplay.textContent = formatValue(
					ctrl.min ?? 0,
					ctrl.step ?? 0.01,
				);
				label.appendChild(nameSpan);
				label.appendChild(valueDisplay);
				controlEl.appendChild(label);

				const input = document.createElement("input");
				input.type = "range";
				input.min = String(ctrl.min ?? 0);
				input.max = String(ctrl.max ?? 1);
				input.step = String(ctrl.step ?? 0.01);
				input.value = String(ctrl.min ?? 0);
				controlEl.appendChild(input);

				const vd = valueDisplay;
				input.addEventListener("input", () => {
					const val = parseFloat(input.value);
					vd.textContent = formatValue(val, ctrl.step ?? 0.01);
					options.onParamChange(ctrl.section, ctrl.key, val);
				});

				controlMap.set(mapKey, { input, valueDisplay, control: ctrl });
			} else if (ctrl.type === "toggle") {
				const label = document.createElement("div");
				label.className = "param-label";
				const nameSpan = document.createElement("span");
				nameSpan.textContent = ctrl.label;
				label.appendChild(nameSpan);
				controlEl.appendChild(label);

				const toggleLabel = document.createElement("label");
				toggleLabel.className = "toggle-switch";
				const input = document.createElement("input");
				input.type = "checkbox";
				const track = document.createElement("span");
				track.className = "toggle-track";
				toggleLabel.appendChild(input);
				toggleLabel.appendChild(track);
				controlEl.appendChild(toggleLabel);

				input.addEventListener("change", () => {
					options.onParamChange(ctrl.section, ctrl.key, input.checked);
				});

				controlMap.set(mapKey, { input, valueDisplay: null, control: ctrl });
			} else if (ctrl.type === "dropdown") {
				const label = document.createElement("div");
				label.className = "param-label";
				const nameSpan = document.createElement("span");
				nameSpan.textContent = ctrl.label;
				label.appendChild(nameSpan);
				controlEl.appendChild(label);

				const select = document.createElement("select");
				for (const opt of ctrl.options ?? []) {
					const option = document.createElement("option");
					option.value = opt;
					option.textContent = opt;
					select.appendChild(option);
				}
				controlEl.appendChild(select);

				select.addEventListener("change", () => {
					options.onParamChange(ctrl.section, ctrl.key, select.value);
				});

				controlMap.set(mapKey, {
					input: select,
					valueDisplay: null,
					control: ctrl,
				});
			} else if (ctrl.type === "color") {
				const label = document.createElement("div");
				label.className = "param-label";
				const nameSpan = document.createElement("span");
				nameSpan.textContent = ctrl.label;
				valueDisplay = document.createElement("span");
				valueDisplay.className = "param-value";
				valueDisplay.textContent = "#000000";
				label.appendChild(nameSpan);
				label.appendChild(valueDisplay);
				controlEl.appendChild(label);

				const input = document.createElement("input");
				input.type = "color";
				input.value = "#000000";
				controlEl.appendChild(input);

				const vd = valueDisplay;
				input.addEventListener("input", () => {
					vd.textContent = input.value;
					options.onParamChange(ctrl.section, ctrl.key, input.value);
				});

				controlMap.set(mapKey, { input, valueDisplay, control: ctrl });
			}

			sectionContent.appendChild(controlEl);
		}

		content.appendChild(sectionEl);
	}

	function updateParams(
		params: Record<string, Record<string, number | string | boolean>>,
	): void {
		for (const [_mapKey, entry] of controlMap) {
			const sectionData = params[entry.control.section];
			if (!sectionData) continue;

			const value = sectionData[entry.control.key];
			if (value === undefined) continue;

			// Skip controls that currently have focus to avoid fighting user input
			if (document.activeElement === entry.input) continue;

			if (entry.control.type === "slider") {
				const numVal = Number(value);
				(entry.input as HTMLInputElement).value = String(numVal);
				if (entry.valueDisplay) {
					entry.valueDisplay.textContent = formatValue(
						numVal,
						entry.control.step ?? 0.01,
					);
				}
			} else if (entry.control.type === "toggle") {
				(entry.input as HTMLInputElement).checked = Boolean(value);
			} else if (entry.control.type === "dropdown") {
				(entry.input as HTMLSelectElement).value = String(value);
			} else if (entry.control.type === "color") {
				(entry.input as HTMLInputElement).value = String(value);
				if (entry.valueDisplay) {
					entry.valueDisplay.textContent = String(value);
				}
			}
		}
	}

	return { element: panel, updateParams };
}
