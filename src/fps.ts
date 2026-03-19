/**
 * FPS counter — always visible during development.
 */

const SAMPLE_WINDOW = 60;

export class FpsCounter {
	private times: number[] = [];

	tick(): number {
		const now = performance.now();
		this.times.push(now);
		if (this.times.length > SAMPLE_WINDOW) this.times.shift();
		if (this.times.length < 2) return 0;
		const elapsed = now - this.times[0];
		return Math.round(((this.times.length - 1) / elapsed) * 1000);
	}

	draw(ctx: CanvasRenderingContext2D): void {
		const fps = this.tick();
		ctx.save();
		ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
		ctx.fillRect(8, 8, 72, 28);
		ctx.fillStyle = fps >= 24 ? "#0f0" : fps >= 15 ? "#ff0" : "#f00";
		ctx.font = "bold 16px monospace";
		ctx.textBaseline = "top";
		ctx.fillText(`${fps} fps`, 14, 14);
		ctx.restore();
	}
}
