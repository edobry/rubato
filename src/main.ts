import { initCamera } from "./camera";
import { drawFrame, initCanvas, resizeCanvas } from "./renderer";

async function main(): Promise<void> {
	const canvas = initCanvas();
	resizeCanvas(canvas);
	window.addEventListener("resize", () => resizeCanvas(canvas));

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		console.error("Failed to get 2D context");
		return;
	}

	let video: HTMLVideoElement;
	try {
		video = await initCamera();
	} catch (err) {
		console.error("Camera unavailable:", err);
		// Fallback: black screen with status message
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "#333";
		ctx.font = "16px monospace";
		ctx.textAlign = "center";
		ctx.fillText("camera unavailable", canvas.width / 2, canvas.height / 2);
		return;
	}

	function loop(): void {
		drawFrame(ctx!, video);
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);
}

main();
