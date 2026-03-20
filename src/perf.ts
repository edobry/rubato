/**
 * Per-frame performance profiler.
 * Tracks time spent in each pipeline stage to identify bottlenecks.
 * Displays as a small bar chart next to the FPS counter.
 */

const HISTORY = 60; // frames to average over

interface StageRecord {
	name: string;
	color: string;
	times: number[];
	avg: number;
}

const stages: Map<string, StageRecord> = new Map();
let frameStart = 0;
let lastMark = 0;

export function perfFrameStart(): void {
	frameStart = performance.now();
	lastMark = frameStart;
}

export function perfMark(stageName: string, color = "#888"): void {
	const now = performance.now();
	const elapsed = now - lastMark;
	lastMark = now;

	let record = stages.get(stageName);
	if (!record) {
		record = { name: stageName, color, times: [], avg: 0 };
		stages.set(stageName, record);
	}
	record.times.push(elapsed);
	if (record.times.length > HISTORY) record.times.shift();
	record.avg = record.times.reduce((a, b) => a + b, 0) / record.times.length;
}

export function perfFrameEnd(): void {
	perfMark("other", "#555");
}

/**
 * Draw the performance breakdown as a stacked bar + legend.
 * Call after drawing the FPS counter.
 */
export function drawPerfOverlay(ctx: CanvasRenderingContext2D): void {
	const x = 8;
	const y = 90; // below FPS graph
	const barW = 200;
	const barH = 12;
	const totalMs = [...stages.values()].reduce((sum, s) => sum + s.avg, 0);

	if (totalMs === 0) return;

	// Background
	ctx.save();
	ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
	const legendH = stages.size * 14 + 4;
	ctx.fillRect(x, y, barW, barH + legendH + 4);

	// Stacked bar
	let offset = 0;
	for (const stage of stages.values()) {
		const w = (stage.avg / totalMs) * barW;
		ctx.fillStyle = stage.color;
		ctx.fillRect(x + offset, y, w, barH);
		offset += w;
	}

	// Legend
	ctx.font = "10px monospace";
	ctx.textBaseline = "top";
	let ly = y + barH + 2;
	for (const stage of stages.values()) {
		ctx.fillStyle = stage.color;
		ctx.fillRect(x + 2, ly + 2, 8, 8);
		ctx.fillStyle = "#ccc";
		ctx.fillText(`${stage.name}: ${stage.avg.toFixed(1)}ms`, x + 14, ly);
		ly += 14;
	}

	ctx.restore();
}

/**
 * Get a text summary of the performance breakdown.
 * For the DOM FPS overlay in unified mode.
 */
export function getPerfSummary(): string {
	const parts: string[] = [];
	for (const stage of stages.values()) {
		if (stage.avg > 0.1) {
			parts.push(`${stage.name}:${stage.avg.toFixed(1)}ms`);
		}
	}
	return parts.join(" | ");
}
