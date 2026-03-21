import QRCode from "qrcode";

const STYLES = {
	overlay: `
		position: fixed;
		inset: 0;
		background: #000;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		color: #fff;
		-webkit-font-smoothing: antialiased;
	`,
	inner: `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 40px;
		padding: 48px 24px;
	`,
	titleBlock: `
		text-align: center;
	`,
	titleMain: `
		font-size: 96px;
		font-weight: 300;
		letter-spacing: 0.05em;
		line-height: 1.1;
		margin: 0;
	`,
	titleSub: `
		font-size: 24px;
		font-weight: 300;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: #aaa;
		margin: 8px 0 0 0;
	`,
	qrWrapper: `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	`,
	qrCanvas: `
		display: block;
	`,
	urlText: `
		font-size: 12px;
		color: #555;
		font-family: "SF Mono", Menlo, Consolas, monospace;
		letter-spacing: 0.02em;
		margin: 0;
	`,
	status: `
		font-size: 13px;
		color: #666;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin: 0;
	`,
} as const;

export function showLobby(): HTMLElement {
	const overlay = document.createElement("div");
	overlay.style.cssText = STYLES.overlay;

	const inner = document.createElement("div");
	inner.style.cssText = STYLES.inner;

	// Title block
	const titleBlock = document.createElement("div");
	titleBlock.style.cssText = STYLES.titleBlock;

	const titleMain = document.createElement("h1");
	titleMain.style.cssText = STYLES.titleMain;
	titleMain.textContent = "時痕";

	const titleSub = document.createElement("p");
	titleSub.style.cssText = STYLES.titleSub;
	titleSub.textContent = "Rubato";

	titleBlock.appendChild(titleMain);
	titleBlock.appendChild(titleSub);
	inner.appendChild(titleBlock);

	// QR code
	const tsHost: string | null = (globalThis as Record<string, unknown>)
		.__TAILSCALE_HOST__ as string | null;
	const origin = tsHost
		? `https://${tsHost}:${location.port}`
		: window.location.origin;
	const adminUrl = `${origin}/admin/`;

	const qrWrapper = document.createElement("div");
	qrWrapper.style.cssText = STYLES.qrWrapper;

	const canvas = document.createElement("canvas");
	canvas.style.cssText = STYLES.qrCanvas;

	QRCode.toCanvas(canvas, adminUrl, {
		width: 180,
		margin: 0,
		color: {
			dark: "#ffffff",
			light: "#000000",
		},
	});

	const urlText = document.createElement("p");
	urlText.style.cssText = STYLES.urlText;
	urlText.textContent = adminUrl;

	qrWrapper.appendChild(canvas);
	qrWrapper.appendChild(urlText);
	inner.appendChild(qrWrapper);

	// Status
	const statusEl = document.createElement("p");
	statusEl.style.cssText = STYLES.status;
	statusEl.dataset.role = "status";
	statusEl.textContent = "Ready";

	inner.appendChild(statusEl);
	overlay.appendChild(inner);

	return overlay;
}

export function destroyLobby(el: HTMLElement): void {
	el.remove();
}

export function updateLobbyStatus(el: HTMLElement, status: string): void {
	const statusEl = el.querySelector<HTMLElement>("[data-role='status']");
	if (statusEl) {
		statusEl.textContent = status;
	}
}
