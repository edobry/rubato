/**
 * Camera error overlay — shown when camera access is denied or unavailable.
 * Styled to match the lobby/admin overlays (dark, minimal, white text).
 */

const OVERLAY_ID = "rubato-camera-error";

export function showCameraError(onRetry: () => void): void {
	// Don't double-create
	if (document.getElementById(OVERLAY_ID)) return;

	const overlay = document.createElement("div");
	overlay.id = OVERLAY_ID;
	overlay.style.cssText = `
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10002;
		background: #000;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		color: #fff;
		-webkit-font-smoothing: antialiased;
	`;

	const panel = document.createElement("div");
	panel.style.cssText = `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 48px 56px;
		max-width: 480px;
		text-align: center;
	`;

	const heading = document.createElement("p");
	heading.style.cssText = `
		font-size: 24px;
		font-weight: 300;
		letter-spacing: 0.03em;
		line-height: 1.4;
		margin: 0;
		color: #fff;
	`;
	heading.textContent = "Camera access is needed to experience this piece";

	const hint = document.createElement("p");
	hint.style.cssText = `
		font-size: 14px;
		font-weight: 400;
		line-height: 1.6;
		margin: 0;
		color: #888;
	`;
	hint.textContent =
		"Please allow camera access and reload, or check your browser settings.";

	const button = document.createElement("button");
	button.style.cssText = `
		margin-top: 8px;
		padding: 12px 32px;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.05em;
		color: #fff;
		background: transparent;
		border: 1px solid #555;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
		transition: border-color 0.2s;
	`;
	button.textContent = "Try again";
	button.addEventListener("mouseenter", () => {
		button.style.borderColor = "#aaa";
	});
	button.addEventListener("mouseleave", () => {
		button.style.borderColor = "#555";
	});
	button.addEventListener("click", onRetry);

	panel.appendChild(heading);
	panel.appendChild(hint);
	panel.appendChild(button);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);
}

export function removeCameraError(): void {
	document.getElementById(OVERLAY_ID)?.remove();
}
