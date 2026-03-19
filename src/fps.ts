/**
 * FPS counter with timeseries graph — always visible during development.
 */

import { autoTuneState } from "./autotune";
import { params } from "./params";

const SAMPLE_WINDOW = 60;
const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 40;
const GRAPH_HISTORY = 200; // frames of history

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class FpsCounter {
	private times: number[] = [];
	private history: number[] = [];
	private spinnerIdx = 0;
	private spinnerTime = 0;

	tick(): number {
		const now = performance.now();
		this.times.push(now);
		if (this.times.length > SAMPLE_WINDOW) this.times.shift();
		if (this.times.length < 2) return 0;
		const elapsed = now - this.times[0];
		const fps = Math.round(((this.times.length - 1) / elapsed) * 1000);

		this.history.push(fps);
		if (this.history.length > GRAPH_HISTORY) this.history.shift();

		// Advance spinner ~10fps
		if (now - this.spinnerTime > 100) {
			this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER.length;
			this.spinnerTime = now;
		}

		return fps;
	}

	draw(ctx: CanvasRenderingContext2D): void {
		const fps = this.tick();
		const tuning =
			params.autoTune.enabled &&
			autoTuneState.status !== "stable" &&
			autoTuneState.status !== "idle" &&
			autoTuneState.status !== "optimal";

		const fpsColor = fps >= 24 ? "#0f0" : fps >= 15 ? "#ff0" : "#f00";
		const label = tuning
			? `${fps} fps ${SPINNER[this.spinnerIdx]} tuning`
			: `${fps} fps`;
		const labelWidth = tuning ? 160 : 72;

		ctx.save();

		// FPS label background
		ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
		ctx.fillRect(8, 8, labelWidth, 28);

		// FPS text
		ctx.fillStyle = fpsColor;
		ctx.font = "bold 16px monospace";
		ctx.textBaseline = "top";
		ctx.fillText(label, 14, 14);

		// Timeseries graph
		if (this.history.length > 1) {
			const gx = 8;
			const gy = 40;

			// Background
			ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
			ctx.fillRect(gx, gy, GRAPH_WIDTH, GRAPH_HEIGHT);

			// Target line
			const target = params.autoTune.targetFps;
			const maxFps = Math.max(120, ...this.history);
			const targetY = gy + GRAPH_HEIGHT - (target / maxFps) * GRAPH_HEIGHT;
			ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(gx, targetY);
			ctx.lineTo(gx + GRAPH_WIDTH, targetY);
			ctx.stroke();
			ctx.setLineDash([]);

			// FPS line
			ctx.strokeStyle = fpsColor;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			const step = GRAPH_WIDTH / (GRAPH_HISTORY - 1);
			const offset = GRAPH_HISTORY - this.history.length;
			for (let i = 0; i < this.history.length; i++) {
				const x = gx + (offset + i) * step;
				const y = gy + GRAPH_HEIGHT - (this.history[i] / maxFps) * GRAPH_HEIGHT;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();

			// Target label
			ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
			ctx.font = "10px monospace";
			ctx.textBaseline = "bottom";
			ctx.fillText(`${target}`, gx + 2, targetY - 1);
		}

		ctx.restore();
	}
}
