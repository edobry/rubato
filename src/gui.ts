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
import { onLogChange } from "./autotune";
import { onParamChange, params } from "./params";

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
		const el = navItems[i].element;
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
					Math.max(tunable.min, tunable.object[tunable.key] + delta),
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
function makeDraggable(guiElement: HTMLElement): void {
	// lil-gui's root title is the first direct child with class "title"
	const titleBar = guiElement.querySelector(
		":scope > .title",
	) as HTMLElement | null;
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

export function initGui(): void {
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
	`;
	document.head.appendChild(style);

	const cam = gui.addFolder("Camera");
	cam.add(params.camera, "showFeed").name("Show Feed");
	cam
		.add(params.camera, "resolution", ["720p", "480p", "360p"])
		.name("Resolution");
	addParam(cam, params.camera, "fillAmount", 0, 1, 0.05, "Fill / Fit");
	cam.open();

	const seg = gui.addFolder("Segmentation");
	seg.add(params.segmentation, "model", ["quality", "fast"]).name("Model");
	seg
		.add(params.segmentation, "delegate", ["auto", "GPU", "CPU"])
		.name("Delegate");
	addParam(
		seg,
		params.segmentation,
		"confidenceThreshold",
		0,
		1,
		0.05,
		"Confidence Threshold",
	);
	addParam(
		seg,
		params.segmentation,
		"temporalSmoothing",
		0,
		0.95,
		0.05,
		"Temporal Smoothing",
	);
	addParam(seg, params.segmentation, "frameSkip", 1, 4, 1, "Frame Skip");
	addParam(
		seg,
		params.segmentation,
		"motionThreshold",
		0,
		1.0,
		0.05,
		"Motion Threshold",
	);
	seg.open();

	const mot = gui.addFolder("Motion Trails");
	addParam(mot, params.motion, "deposition", 0, 20, 0.5, "Deposition");
	addParam(mot, params.motion, "decay", 0.9, 0.999, 0.001, "Decay");
	mot.open();

	const overlay = gui.addFolder("Overlay");
	overlay.add(params.overlay, "showOverlay").name("Show Overlay");
	overlay
		.add(params.overlay, "visualize", ["mask", "motion", "trail", "both"])
		.name("Visualize");
	addParam(overlay, params.overlay, "opacity", 0, 1, 0.05, "Opacity");
	overlay.addColor(params.overlay, "color").name("Color");
	overlay
		.add(params.overlay, "colorMode", [
			"solid",
			"rainbow",
			"gradient",
			"contour",
			"invert",
			"aura",
		])
		.name("Color Mode");
	overlay.open();

	const tune = gui.addFolder("Auto-Tune");
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
		overflow-y: auto;
		white-space: pre;
		line-height: 1.4;
		border-top: 1px solid #333;
	`;
	logEl.textContent = "waiting…";
	tune.$children.appendChild(logEl);

	// Reactively update controllers when params change (replaces polling)
	onParamChange(() => {
		for (const c of gui!.controllersRecursive()) {
			c.updateDisplay();
		}
	});

	// Reactively update log panel when autotune logs a message
	onLogChange((log) => {
		logEl.textContent = log.join("\n") || "waiting…";
		logEl.scrollTop = logEl.scrollHeight;
	});

	tune.open();

	// Export button
	gui
		.add(
			{
				exportJSON() {
					navigator.clipboard.writeText(JSON.stringify(params, null, "\t"));
					console.log("Params copied to clipboard");
				},
			},
			"exportJSON",
		)
		.name("Export JSON (E)");

	// Make panel draggable
	makeDraggable(gui.domElement);

	// Build flat navigation list from ALL controllers and folder headings
	buildNavItems(gui);
	selectedIndex = 0;

	// Click-to-select: sync keyboard focus when user clicks a nav item
	for (let i = 0; i < navItems.length; i++) {
		const idx = i;
		navItems[i].element.addEventListener("click", () => {
			selectedIndex = idx;
			updateHighlight();
		});
	}

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

		// If a <select> has focus (e.g. after clicking a dropdown), blur it
		// so arrow keys are handled by our navigation instead of the browser.
		if (document.activeElement instanceof HTMLSelectElement) {
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
					if (isNavItemVisible(navItems[selectedIndex])) break;
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
					if (isNavItemVisible(navItems[selectedIndex])) break;
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
				navigator.clipboard.writeText(JSON.stringify(params, null, "\t"));
				console.log("Params copied to clipboard");
				break;
		}
	});
}
