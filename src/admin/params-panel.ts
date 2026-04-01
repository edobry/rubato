import {
	CREATIVE_PARAMS,
	ENVIRONMENT_PARAMS,
	type ParamControlDef,
} from "../param-schema.js";

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
	control: ParamControlDef;
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
	setDisabled: (disabled: boolean) => void;
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

	// Collapse/Expand all button
	const collapseAllBtn = document.createElement("button");
	collapseAllBtn.className = "collapse-all-toggle";
	collapseAllBtn.textContent = "Expand All";
	content.appendChild(collapseAllBtn);

	// Track section elements for collapse/expand all
	const sectionEntries: {
		name: string;
		header: HTMLButtonElement;
		content: HTMLDivElement;
		setExpanded: (open: boolean) => void;
	}[] = [];

	// Build sections from both environment and creative params
	const allSections = [...ENVIRONMENT_PARAMS, ...CREATIVE_PARAMS];
	for (const section of allSections) {
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
		const setSectionExpanded = (open: boolean) => {
			sectionExpanded = open;
			sectionContent.style.display = sectionExpanded ? "" : "none";
			header.innerHTML = `<span>${section.name}</span><span>${sectionExpanded ? "\u25BE" : "\u25B8"}</span>`;
			uiState.sections[section.name] = sectionExpanded;
		};
		header.addEventListener("click", () => {
			setSectionExpanded(!sectionExpanded);
			savePanelState(uiState);
			updateCollapseAllLabel();
		});
		sectionEntries.push({
			name: section.name,
			header,
			content: sectionContent,
			setExpanded: setSectionExpanded,
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

	// Update collapse-all button label based on initial state
	const updateCollapseAllLabel = () => {
		const anyOpen = sectionEntries.some(
			(e) => e.content.style.display !== "none",
		);
		collapseAllBtn.textContent = anyOpen ? "Collapse All" : "Expand All";
	};
	updateCollapseAllLabel();

	collapseAllBtn.addEventListener("click", () => {
		const anyOpen = sectionEntries.some(
			(e) => e.content.style.display !== "none",
		);
		const targetState = !anyOpen;
		for (const entry of sectionEntries) {
			entry.setExpanded(targetState);
		}
		savePanelState(uiState);
		updateCollapseAllLabel();
	});

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

	function setDisabled(disabled: boolean): void {
		panel.classList.toggle("disabled", disabled);
	}

	return { element: panel, updateParams, setDisabled };
}
