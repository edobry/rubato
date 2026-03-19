/**
 * Dev GUI panel (lil-gui).
 * Toggle visibility with 'G' key. Only included when VITE_DEV_GUI is set.
 * Draggable by the title bar.
 *
 * Keyboard controls:
 *   G          — toggle panel visibility
 *   Up/Down    — select previous/next parameter
 *   Left/Right — decrease/increase selected parameter
 *   Shift+L/R  — larger step (10x)
 *   E          — export params to clipboard
 */

import GUI from "lil-gui";
import { params } from "./params";

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

function updateHighlight(): void {
	for (let i = 0; i < tunables.length; i++) {
		const el = tunables[i].controller.domElement.closest(".lil-gui.controller");
		if (el instanceof HTMLElement) {
			el.style.outline = i === selectedIndex ? "2px solid #0ff" : "none";
			el.style.outlineOffset = i === selectedIndex ? "-2px" : "0";
		}
	}
}

/** Make the GUI panel draggable by its title bar. */
function makeDraggable(guiElement: HTMLElement): void {
	const titleBar = guiElement.querySelector(".title") as HTMLElement | null;
	if (!titleBar) return;

	// Switch from fixed top-right to absolute positioning
	guiElement.style.position = "fixed";
	guiElement.style.top = "0px";
	guiElement.style.right = "0px";
	guiElement.style.left = "auto";
	titleBar.style.cursor = "grab";

	let dragging = false;
	let offsetX = 0;
	let offsetY = 0;

	titleBar.addEventListener("mousedown", (e) => {
		// Don't start drag if clicking the collapse arrow
		if ((e.target as HTMLElement).closest(".lil-gui > .title") !== titleBar)
			return;
		dragging = true;
		titleBar.style.cursor = "grabbing";
		const rect = guiElement.getBoundingClientRect();
		offsetX = e.clientX - rect.left;
		offsetY = e.clientY - rect.top;
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		// Switch to left/top positioning once dragging starts
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
	seg.open();

	const overlay = gui.addFolder("Overlay");
	overlay.add(params.overlay, "showOverlay").name("Show Overlay");
	addParam(overlay, params.overlay, "opacity", 0, 1, 0.05, "Opacity");
	overlay.open();

	const tune = gui.addFolder("Auto-Tune");
	tune.add(params.autoTune, "enabled").name("Enabled");
	addParam(tune, params.autoTune, "targetFps", 15, 60, 5, "Target FPS");
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

		switch (e.key) {
			case "g":
			case "G":
				if (gui) gui.show(gui._hidden);
				break;

			case "ArrowUp":
				e.preventDefault();
				selectedIndex = (selectedIndex - 1 + tunables.length) % tunables.length;
				updateHighlight();
				break;

			case "ArrowDown":
				e.preventDefault();
				selectedIndex = (selectedIndex + 1) % tunables.length;
				updateHighlight();
				break;

			case "ArrowLeft":
			case "ArrowRight": {
				e.preventDefault();
				const t = tunables[selectedIndex];
				const multiplier = e.shiftKey ? 10 : 1;
				const delta =
					e.key === "ArrowRight" ? t.step * multiplier : -t.step * multiplier;
				const newVal = Math.min(
					t.max,
					Math.max(t.min, t.object[t.key] + delta),
				);
				t.object[t.key] = Math.round(newVal * 1000) / 1000; // avoid float drift
				t.controller.updateDisplay();
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
