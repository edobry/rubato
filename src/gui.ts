/**
 * Dev GUI panel (lil-gui).
 * Toggle visibility with 'G' key. Only included when VITE_DEV_GUI is set.
 * Draggable by the title bar.
 *
 * Keyboard controls:
 *   G          — toggle panel visibility
 *   Up/Down    — select previous/next control (skips collapsed sections)
 *   Left/Right — adjust selected control (slider, dropdown, checkbox)
 *                on folder headings: Left = collapse, Right = expand
 *   Shift+L/R  — larger step (10x for sliders)
 *   Enter      — activate buttons, toggle folder open/closed
 *   E          — export params to clipboard
 */

import type { Controller } from "lil-gui";
import GUI from "lil-gui";
import { autoTuneState, onLogChange } from "./autotune";
import { detectDevice } from "./device";
import { onParamChange, params } from "./params";
import { getPerfSummary } from "./perf";
import {
	applyPreset,
	type CreativePreset,
	deletePreset,
	deletePresetFromServer,
	exportAllPresets,
	extractPreset,
	getBuiltInPresets,
	getLastPreset,
	getSavedPresets,
	importPresets,
	initServerPresets,
	savePreset,
	setLastPreset,
	syncPresetToServer,
} from "./presets";

let gui: GUI | null = null;

interface TunableParam {
	name: string;
	controller: ReturnType<GUI["add"]>;
	object: Record<string, number>;
	key: string;
	step: number;
	min: number;
	max: number;
}

const tunables: TunableParam[] = [];

/** Navigation item: either a controller or a folder heading. */
type NavItem =
	| { type: "controller"; controller: Controller; element: HTMLElement }
	| { type: "folder"; folder: GUI; element: HTMLElement };

/** Flat list of navigable items (controllers + folder headings) in DOM order. */
let navItems: NavItem[] = [];
let selectedIndex = 0;

function addParam(
	folder: GUI,
	obj: Record<string, unknown>,
	key: string,
	min: number,
	max: number,
	step: number,
	label: string,
): void {
	const controller = folder.add(obj, key, min, max, step).name(label);
	tunables.push({
		name: label,
		controller,
		object: obj as Record<string, number>,
		key,
		step,
		min,
		max,
	});
}

/** Detect control type from a lil-gui Controller instance. */
function getControllerType(
	c: Controller,
): "number" | "option" | "boolean" | "function" | "color" | "string" {
	// OptionController has $select
	if ("$select" in c) return "option";
	// FunctionController has $button
	if ("$button" in c) return "function";
	// BooleanController: has $input that is a checkbox
	if (
		"$input" in c &&
		(c as unknown as { $input: HTMLInputElement }).$input?.type === "checkbox"
	)
		return "boolean";
	// NumberController: has _step or _hasSlider
	if ("_step" in c || "_hasSlider" in c) return "number";
	// ColorController: has $display and _format
	if ("_format" in c) return "color";
	return "string";
}

/** Look up the TunableParam entry for a controller, if one exists. */
function findTunable(c: Controller): TunableParam | undefined {
	return tunables.find((t) => t.controller === c);
}

function updateHighlight(): void {
	for (let i = 0; i < navItems.length; i++) {
		const el = navItems[i]!.element;
		el.style.outline = i === selectedIndex ? "2px solid #0ff" : "none";
		el.style.outlineOffset = i === selectedIndex ? "-2px" : "0";
		el.style.backgroundColor =
			i === selectedIndex ? "rgba(0, 255, 255, 0.08)" : "";
	}
}

/** Check if a nav item is currently visible (not inside a collapsed folder). */
function isNavItemVisible(item: NavItem): boolean {
	// For folder items, the title element lives directly inside the folder's
	// own domElement, so we need to check *ancestor* folders, not the folder
	// itself. Walk up the DOM looking for any element with the "closed" class.
	// However, a folder's own title is always visible even when the folder is
	// closed (because the title is how you re-open it). The children are hidden.
	// So for a folder nav item, we check if any *ancestor* GUI is closed.
	// For a controller nav item, we check if any ancestor GUI is closed.
	let el: HTMLElement | null = item.element.parentElement;
	while (el) {
		if (el.classList.contains("closed")) return false;
		el = el.parentElement;
	}
	return true;
}

/** Attach click-to-select handlers so clicking a nav item syncs the highlight. */
function registerClickHandlers(): void {
	for (let i = 0; i < navItems.length; i++) {
		const idx = i;
		navItems[i]!.element.addEventListener("click", () => {
			selectedIndex = idx;
			updateHighlight();
		});
	}
}

/** Build the navItems array in DOM order from folders and controllers. */
function buildNavItems(rootGui: GUI): void {
	navItems = [];

	// Collect all navigable elements with their DOM position
	const entries: { element: HTMLElement; item: NavItem }[] = [];

	// Add folder headings (the $title element)
	for (const folder of rootGui.foldersRecursive()) {
		const titleEl = (folder as unknown as { $title: HTMLElement }).$title;
		if (titleEl) {
			entries.push({
				element: titleEl,
				item: { type: "folder", folder, element: titleEl },
			});
		}
	}

	// Add controllers
	for (const controller of rootGui.controllersRecursive()) {
		const el = controller.domElement;
		if (el instanceof HTMLElement) {
			entries.push({
				element: el,
				item: { type: "controller", controller, element: el },
			});
		}
	}

	// Sort by document order using compareDocumentPosition
	entries.sort((a, b) => {
		const pos = a.element.compareDocumentPosition(b.element);
		if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
		if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
		return 0;
	});

	navItems = entries.map((e) => e.item);

	// Clamp selectedIndex so it stays within bounds after a rebuild
	if (selectedIndex >= navItems.length) {
		selectedIndex = Math.max(0, navItems.length - 1);
	}

	// (Re-)register click-to-select handlers on all nav items
	registerClickHandlers();
}

/** Handle Left/Right arrow for the currently selected item. */
function adjustSelected(direction: 1 | -1, shift: boolean): void {
	const item = navItems[selectedIndex];
	if (!item) return;

	// Folder items: Left = collapse, Right = expand
	if (item.type === "folder") {
		if (direction === -1) item.folder.close();
		else item.folder.open();
		return;
	}

	const c = item.controller;
	const type = getControllerType(c);

	switch (type) {
		case "number": {
			const tunable = findTunable(c);
			if (tunable) {
				// Use tunable's explicit step/min/max
				const multiplier = shift ? 10 : 1;
				const delta = tunable.step * multiplier * direction;
				const newVal = Math.min(
					tunable.max,
					Math.max(tunable.min, (tunable.object[tunable.key] ?? 0) + delta),
				);
				tunable.object[tunable.key] = Math.round(newVal * 1000) / 1000;
			} else {
				// Fallback for number controllers without tunable entry
				const nc = c as unknown as {
					_step: number;
					_min: number;
					_max: number;
				};
				const step = nc._step || 1;
				const multiplier = shift ? 10 : 1;
				const cur = c.getValue() as number;
				let newVal = cur + step * multiplier * direction;
				if (nc._min !== undefined) newVal = Math.max(nc._min, newVal);
				if (nc._max !== undefined) newVal = Math.min(nc._max, newVal);
				c.setValue(Math.round(newVal * 1000) / 1000);
			}
			c.updateDisplay();
			break;
		}
		case "option": {
			const oc = c as unknown as { _values: unknown[] };
			const values = oc._values;
			const cur = c.getValue();
			const idx = values.indexOf(cur);
			const next = (idx + direction + values.length) % values.length;
			c.setValue(values[next]);
			break;
		}
		case "boolean": {
			// Toggle on either direction
			c.setValue(!c.getValue());
			break;
		}
		// function, color, string: no-op for arrow keys
	}
}

/** Make the GUI panel draggable by its title bar. */
function makeDraggable(guiInstance: GUI): void {
	const guiElement = guiInstance.domElement;
	// Prefer lil-gui's exposed $title property; fall back to DOM queries
	// for resilience across browser versions.
	const titleBar =
		(guiInstance as unknown as { $title: HTMLElement | undefined }).$title ??
		(guiElement.querySelector(":scope > .title") as HTMLElement | null) ??
		(Array.from(guiElement.children).find(
			(el) => el instanceof HTMLElement && el.classList.contains("title"),
		) as HTMLElement | null) ??
		((): HTMLElement | null => {
			const el = guiElement.querySelector(".title");
			return el instanceof HTMLElement && el.parentElement === guiElement
				? el
				: null;
		})();
	if (!titleBar) {
		console.warn("Could not find GUI title bar for dragging");
		return;
	}

	guiElement.style.position = "fixed";
	guiElement.style.top = "0px";
	guiElement.style.right = "0px";
	guiElement.style.left = "auto";
	titleBar.style.cursor = "grab";
	titleBar.style.userSelect = "none";

	let dragging = false;
	let offsetX = 0;
	let offsetY = 0;

	titleBar.addEventListener("mousedown", (e) => {
		dragging = true;
		titleBar.style.cursor = "grabbing";
		const rect = guiElement.getBoundingClientRect();
		offsetX = e.clientX - rect.left;
		offsetY = e.clientY - rect.top;
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		guiElement.style.right = "auto";
		guiElement.style.left = `${e.clientX - offsetX}px`;
		guiElement.style.top = `${e.clientY - offsetY}px`;
	});

	window.addEventListener("mouseup", () => {
		if (dragging) {
			dragging = false;
			titleBar.style.cursor = "grab";
		}
	});
}

export async function initGui(): Promise<void> {
	// Fetch server presets before building the GUI so the dropdown is complete.
	await initServerPresets();

	gui = new GUI({ title: "rubato params", width: 350 });
	gui.domElement.style.zIndex = "10000";

	// Scale up the GUI for easier interaction
	const style = document.createElement("style");
	style.textContent = `
		.lil-gui { --font-size: 14px; --row-height: 32px; --widget-height: 28px; font-size: 14px !important; }
		.lil-gui .controller { min-height: 32px; }
		.lil-gui input[type="number"] { font-size: 14px; width: 60px; }
		.lil-gui .slider { height: 28px; }
		.lil-gui .title { font-size: 15px !important; padding: 8px 12px; }
		.lil-gui .controller .name { padding: 0 8px; }

		/* Top-level folder titles: bold, larger, distinct background */
		.lil-gui.root > .children > .lil-gui > .title {
			font-size: 16px !important;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 1px;
			background: #0a4a6a !important;
			color: #fff !important;
			padding: 10px 12px;
			margin-top: 2px;
		}

		/* Sub-folder titles: smaller, dimmer, indented with accent */
		.lil-gui .lil-gui .lil-gui > .title {
			font-size: 12px !important;
			font-weight: 400;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			color: #6aa !important;
			background: rgba(255,255,255,0.03) !important;
			padding: 4px 12px 4px 14px;
			border-left: 2px solid #0af;
		}
	`;
	document.head.appendChild(style);

	// ── Presets section ──────────────────────────────────────────────
	const presetsFolder = gui.addFolder("Presets");

	// State for the preset selector
	const presetState = { selected: "default", newName: "" };

	/** Build the list of all available preset names. */
	function allPresetNames(): string[] {
		const builtIn = Object.keys(getBuiltInPresets());
		const saved = Object.keys(getSavedPresets());
		return [...saved.map((n) => `* ${n}`), ...builtIn];
	}

	/** Look up a preset by display name. */
	function resolvePreset(displayName: string): CreativePreset | null {
		const builtIns = getBuiltInPresets();
		if (displayName in builtIns) return builtIns[displayName]!;
		// User presets are prefixed with "* "
		if (displayName.startsWith("* ")) {
			const name = displayName.slice(2);
			const saved = getSavedPresets();
			if (name in saved) return saved[name]!;
		}
		return null;
	}

	const presetDropdown = presetsFolder
		.add(presetState, "selected", allPresetNames())
		.name("Preset")
		.onChange((value: string) => {
			const preset = resolvePreset(value);
			if (preset) applyPreset(preset);
			setLastPreset(value);
		});

	// Auto-select last-used preset on page load
	{
		const lastPreset = getLastPreset();
		const names = allPresetNames();
		if (names.includes(lastPreset)) {
			presetState.selected = lastPreset;
		} else {
			presetState.selected = "default";
		}
		presetDropdown.updateDisplay();
		const initialPreset = resolvePreset(presetState.selected);
		if (initialPreset) applyPreset(initialPreset);
	}

	presetsFolder.add(presetState, "newName").name("New Preset Name");

	presetsFolder
		.add(
			{
				save() {
					let name = presetState.newName.trim();
					if (!name) {
						// Fall back to the currently selected preset name
						// (strip the "* " prefix for user presets)
						const sel = presetState.selected;
						name = sel.startsWith("* ") ? sel.slice(2) : sel;
					}
					if (!name) return;
					const preset = extractPreset(name);
					savePreset(name, preset);
					void syncPresetToServer(name, preset);
					// Refresh the dropdown options
					presetDropdown.options(allPresetNames());
					presetState.selected = `* ${name}`;
					setLastPreset(`* ${name}`);
					presetDropdown.updateDisplay();
					presetState.newName = "";
					// Update the name input display
					for (const c of presetsFolder.controllersRecursive()) {
						c.updateDisplay();
					}
					// Rebuild nav items since dropdown.options() replaces the DOM
					buildNavItems(gui!);
					updateHighlight();
				},
			},
			"save",
		)
		.name("Save Preset");

	presetsFolder
		.add(
			{
				remove() {
					const sel = presetState.selected;
					if (!sel.startsWith("* ")) return; // can't delete built-ins
					const name = sel.slice(2);
					deletePreset(name);
					void deletePresetFromServer(name);
					presetState.selected = "default";
					setLastPreset("default");
					presetDropdown.options(allPresetNames());
					presetDropdown.updateDisplay();
					const fallback = resolvePreset("default");
					if (fallback) applyPreset(fallback);
					// Rebuild nav items since dropdown.options() replaces the DOM
					buildNavItems(gui!);
					updateHighlight();
				},
			},
			"remove",
		)
		.name("Delete Preset");

	presetsFolder
		.add(
			{
				exportAll() {
					const json = exportAllPresets();
					void navigator.clipboard.writeText(json).then(
						() => console.log("All presets copied to clipboard"),
						() => console.warn("Clipboard write failed"),
					);
				},
			},
			"exportAll",
		)
		.name("Export All Presets");

	presetsFolder
		.add(
			{
				importAll() {
					const json = prompt("Paste presets JSON:");
					if (!json) return;
					try {
						const count = importPresets(json);
						console.log(`Imported ${count} preset(s)`);
						presetDropdown.options(allPresetNames());
						presetDropdown.updateDisplay();
						buildNavItems(gui!);
						updateHighlight();
					} catch (err) {
						console.error("Failed to import presets:", err);
						alert("Invalid JSON — import failed.");
					}
				},
			},
			"importAll",
		)
		.name("Import Presets");

	presetsFolder.open();

	// ── Creative section ─────────────────────────────────────────────
	const creative = gui.addFolder("Creative");

	const display = creative.addFolder("Display");
	display.add(params.camera, "showFeed").name("Show Feed");
	addParam(display, params.camera, "fillAmount", 0, 1, 0.05, "Fill / Fit");
	display.add(params.overlay, "showOverlay").name("Show Overlay");
	display
		.add(params.overlay, "visualize", ["mask", "motion", "trail", "both"])
		.name("Visualize");
	display.open();

	const overlayStyle = creative.addFolder("Overlay Style");
	addParam(overlayStyle, params.overlay, "opacity", 0, 1, 0.05, "Opacity");
	overlayStyle.addColor(params.overlay, "color").name("Color");
	overlayStyle
		.add(params.overlay, "colorMode", [
			"solid",
			"rainbow",
			"gradient",
			"contour",
			"invert",
			"aura",
		])
		.name("Color Mode");
	addParam(overlayStyle, params.overlay, "blur", 0, 5, 1, "Blur");
	overlayStyle.open();

	const trails = creative.addFolder("Trails");
	addParam(trails, params.motion, "deposition", 0, 8, 0.1, "Deposition");
	addParam(trails, params.motion, "decay", 0.9, 0.999, 0.001, "Decay");
	trails.open();

	const fog = creative.addFolder("Fog");
	addParam(fog, params.fog, "speed", 0, 0.5, 0.01, "Speed");
	addParam(fog, params.fog, "scale", 0.5, 10, 0.25, "Scale");
	addParam(fog, params.fog, "density", 0.5, 3, 0.1, "Density");
	addParam(fog, params.fog, "brightness", 0, 1, 0.05, "Brightness");
	fog.addColor(params.fog, "color").name("Color");
	addParam(fog, params.fog, "maskInteraction", 0, 2, 0.1, "Mask → Fog");
	addParam(fog, params.fog, "trailInteraction", 0, 5, 0.1, "Trail → Fog");
	fog.open();

	const detection = creative.addFolder("Detection");
	addParam(
		detection,
		params.segmentation,
		"confidenceThreshold",
		0,
		1,
		0.05,
		"Confidence Threshold",
	);
	addParam(
		detection,
		params.segmentation,
		"temporalSmoothing",
		0,
		0.95,
		0.05,
		"Temporal Smoothing",
	);
	addParam(
		detection,
		params.segmentation,
		"motionThreshold",
		0,
		1.0,
		0.05,
		"Motion Threshold",
	);
	detection.open();

	creative.open();

	// ── Performance section ──────────────────────────────────────────
	const performance = gui.addFolder("Performance");
	performance
		.add(params.rendering, "pipeline", ["legacy", "unified"])
		.name("Pipeline (reload)")
		.onChange((value: string) => {
			localStorage.setItem("rubato-pipeline", value);
			window.location.reload();
		});

	const cam = performance.addFolder("Camera");
	cam
		.add(params.camera, "resolution", ["720p", "480p", "360p"])
		.name("Resolution");
	cam.open();

	const seg = performance.addFolder("Segmentation");
	seg.add(params.segmentation, "model", ["quality", "fast"]).name("Model");
	seg
		.add(params.segmentation, "delegate", ["auto", "GPU", "CPU"])
		.name("Delegate");
	addParam(seg, params.segmentation, "frameSkip", 1, 15, 1, "Frame Skip");
	addParam(seg, params.overlay, "downsample", 1, 4, 1, "Overlay Downsample");
	addParam(seg, params.fog, "octaves", 2, 5, 1, "Fog Octaves");
	addParam(seg, params.fog, "renderScale", 0.25, 1, 0.25, "Fog Render Scale");
	seg.open();

	const tune = performance.addFolder("Auto-Tune");
	tune.add(params.autoTune, "enabled").name("Enabled");
	addParam(tune, params.autoTune, "targetFps", 15, 60, 5, "Target FPS");
	addParam(tune, params.autoTune, "simulatedLoad", 0, 100, 5, "Sim Load ms");

	const tuneAdvanced = tune.addFolder("Advanced");
	addParam(
		tuneAdvanced,
		params.autoTune,
		"settleTime",
		1000,
		10000,
		500,
		"Settle Time ms",
	);
	addParam(
		tuneAdvanced,
		params.autoTune,
		"stableDuration",
		1000,
		10000,
		500,
		"Stable Duration ms",
	);
	addParam(
		tuneAdvanced,
		params.autoTune,
		"upgradeHysteresis",
		1000,
		10000,
		500,
		"Upgrade Hysteresis ms",
	);
	addParam(
		tuneAdvanced,
		params.autoTune,
		"upgradeHeadroom",
		1,
		20,
		1,
		"Upgrade Headroom fps",
	);
	addParam(
		tuneAdvanced,
		params.autoTune,
		"dropThreshold",
		0.05,
		0.5,
		0.05,
		"Drop Threshold %",
	);
	addParam(
		tuneAdvanced,
		params.autoTune,
		"dropSustainedDuration",
		500,
		10000,
		500,
		"Drop Sustained ms",
	);
	addParam(
		tuneAdvanced,
		params.autoTune,
		"tolerancePct",
		0.05,
		0.3,
		0.01,
		"Tolerance %",
	);
	tuneAdvanced.close();

	// Scrolling log panel
	const logEl = document.createElement("div");
	logEl.style.cssText = `
		font: 11px monospace;
		color: #aaa;
		background: #1a1a1a;
		padding: 6px 8px;
		max-height: 120px;
		min-height: 40px;
		overflow-y: auto;
		white-space: pre;
		line-height: 1.4;
		border-top: 1px solid #333;
		user-select: text;
		cursor: text;
	`;
	logEl.textContent = "waiting\u2026";
	tune.$children.appendChild(logEl);

	// Copy Log button
	tune
		.add(
			{
				copyLog() {
					const text = logEl.textContent || "";
					void navigator.clipboard.writeText(text).then(
						() => console.log("Autotune log copied to clipboard"),
						() => console.warn("Clipboard write failed"),
					);
				},
			},
			"copyLog",
		)
		.name("Copy Log");

	// Reactively update controllers when params change (replaces polling)
	onParamChange(() => {
		for (const c of gui!.controllersRecursive()) {
			c.updateDisplay();
		}
	});

	// Reactively update log panel when autotune logs a message
	onLogChange((log) => {
		logEl.textContent = log.join("\n") || "waiting\u2026";
		logEl.scrollTop = logEl.scrollHeight;
	});

	tune.open();

	// Copy Debug Info button
	performance
		.add(
			{
				copyDebugInfo() {
					const device = detectDevice();
					const perf = getPerfSummary();
					const lines: string[] = [];

					lines.push("=== rubato debug info ===");
					lines.push("");

					// Device
					lines.push("-- Device --");
					lines.push(`Platform: ${device.platform}`);
					lines.push(`Constrained: ${device.isConstrained}`);
					lines.push(`Cores: ${device.cores}`);
					lines.push(`GPU: ${device.gpu}`);
					if (device.memory !== undefined)
						lines.push(`Memory: ${device.memory} GB`);
					lines.push("");

					// Pipeline & segmentation
					lines.push("-- Pipeline --");
					lines.push(`Mode: ${params.rendering.pipeline}`);
					lines.push(`Seg model: ${params.segmentation.model}`);
					lines.push(`Seg delegate: ${params.segmentation.delegate}`);
					lines.push(`Resolution: ${params.camera.resolution}`);
					lines.push(`Frame skip: ${params.segmentation.frameSkip}`);
					lines.push("");

					// FPS & performance
					lines.push("-- Performance --");
					lines.push(`FPS: ${autoTuneState.fps}`);
					lines.push(`Perf breakdown: ${perf || "n/a"}`);
					lines.push("");

					// Autotune
					lines.push("-- Auto-Tune --");
					lines.push(`Enabled: ${params.autoTune.enabled}`);
					lines.push(`Target FPS: ${params.autoTune.targetFps}`);
					lines.push(`Status: ${autoTuneState.status}`);
					lines.push(`Last action: ${autoTuneState.lastAction || "none"}`);
					lines.push(`Adjustments: ${autoTuneState.adjustCount}`);
					if (autoTuneState.log.length > 0) {
						lines.push("Log:");
						for (const entry of autoTuneState.log) {
							lines.push(`  ${entry}`);
						}
					}
					lines.push("");

					// Params snapshot
					lines.push("-- Params --");
					lines.push(JSON.stringify(params, null, 2));
					lines.push("");

					// localStorage values
					lines.push("-- localStorage --");
					for (const key of [
						"rubato-gpu-failed",
						"rubato-pipeline",
						"rubato-last-preset",
					]) {
						lines.push(`${key}: ${localStorage.getItem(key) ?? "(not set)"}`);
					}

					const text = lines.join("\n");
					void navigator.clipboard.writeText(text).then(
						() => console.log("Debug info copied to clipboard"),
						() => console.warn("Clipboard write failed"),
					);
				},
			},
			"copyDebugInfo",
		)
		.name("Copy Debug Info");

	performance.open();

	// Export button
	gui
		.add(
			{
				exportJSON() {
					void navigator.clipboard.writeText(
						JSON.stringify(params, null, "\t"),
					);
					console.log("Params copied to clipboard");
				},
			},
			"exportJSON",
		)
		.name("Export JSON (E)");

	// Make panel draggable
	makeDraggable(gui);

	// Build flat navigation list from ALL controllers and folder headings
	buildNavItems(gui);
	selectedIndex = 0;

	// Initial highlight
	updateHighlight();

	// Keyboard controls
	window.addEventListener("keydown", (e) => {
		// Don't intercept if user is typing in an input
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;

		// If any interactive element inside the GUI panel has focus (e.g. after
		// clicking a dropdown, checkbox, or slider), blur it so navigation keys
		// are handled by our handler instead of the browser.
		if (
			gui &&
			document.activeElement instanceof HTMLElement &&
			gui.domElement.contains(document.activeElement)
		) {
			document.activeElement.blur();
		}

		switch (e.key) {
			case "g":
			case "G":
				if (gui) gui.show(gui._hidden);
				break;

			case "ArrowUp": {
				e.preventDefault();
				const startUp = selectedIndex;
				for (let step = 0; step < navItems.length; step++) {
					selectedIndex =
						(selectedIndex - 1 + navItems.length) % navItems.length;
					if (isNavItemVisible(navItems[selectedIndex]!)) break;
					if (selectedIndex === startUp) break;
				}
				updateHighlight();
				break;
			}

			case "ArrowDown": {
				e.preventDefault();
				const startDown = selectedIndex;
				for (let step = 0; step < navItems.length; step++) {
					selectedIndex = (selectedIndex + 1) % navItems.length;
					if (isNavItemVisible(navItems[selectedIndex]!)) break;
					if (selectedIndex === startDown) break;
				}
				updateHighlight();
				break;
			}

			case "ArrowLeft": {
				e.preventDefault();
				adjustSelected(-1, e.shiftKey);
				break;
			}

			case "ArrowRight": {
				e.preventDefault();
				adjustSelected(1, e.shiftKey);
				break;
			}

			case "Enter": {
				e.preventDefault();
				const item = navItems[selectedIndex];
				if (!item) break;
				if (item.type === "folder") {
					// Toggle folder open/closed
					if (item.folder._closed) item.folder.open();
					else item.folder.close();
				} else {
					const c = item.controller;
					if (getControllerType(c) === "function") {
						const fc = c as unknown as { $button: HTMLButtonElement };
						fc.$button.click();
					}
				}
				break;
			}

			case "e":
			case "E":
				void navigator.clipboard.writeText(JSON.stringify(params, null, "\t"));
				console.log("Params copied to clipboard");
				break;
		}
	});
}
