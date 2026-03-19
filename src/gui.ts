/**
 * Dev GUI panel (lil-gui).
 * Toggle visibility with 'G' key. Only included when VITE_DEV_GUI is set.
 */

import GUI from "lil-gui";
import { params } from "./params";

let gui: GUI | null = null;

export function initGui(): void {
	gui = new GUI({ title: "rubato params" });
	gui.domElement.style.zIndex = "10000";

	const seg = gui.addFolder("Segmentation");
	seg
		.add(params.segmentation, "confidenceThreshold", 0, 1, 0.01)
		.name("Confidence Threshold");
	seg
		.add(params.segmentation, "temporalSmoothing", 0, 0.95, 0.01)
		.name("Temporal Smoothing");
	seg.open();

	// Export button — copies current params to clipboard as JSON
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
		.name("Export JSON");

	// Toggle with G key
	window.addEventListener("keydown", (e) => {
		if (e.key === "g" || e.key === "G") {
			if (gui) gui.show(gui._hidden);
		}
	});
}
