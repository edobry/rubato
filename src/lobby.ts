import QRCode from "qrcode";

const STYLES = {
	overlay: `
		position: fixed;
		inset: 0;
		background: #000;
		overflow-y: auto;
		z-index: 10000;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		color: #fff;
		-webkit-font-smoothing: antialiased;
	`,
	hero: `
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		position: relative;
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
	scrollIndicator: `
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		color: #999;
		font-size: 12px;
		letter-spacing: 0.08em;
		animation: lobbyBounce 2s ease-in-out infinite;
	`,
	aboutSection: `
		padding: 40px 24px 120px;
		margin-top: -40px;
		display: flex;
		flex-direction: column;
		align-items: center;
	`,
	aboutInner: `
		max-width: 600px;
		width: 100%;
	`,
	aboutSeparator: `
		width: 40px;
		height: 1px;
		background: #333;
		border: none;
		margin: 0 auto 60px;
	`,
	aboutParagraph: `
		font-size: 15px;
		font-weight: 300;
		line-height: 1.7;
		color: #999;
		margin: 0 0 28px 0;
	`,
	aboutNote: `
		font-size: 12px;
		font-weight: 300;
		line-height: 1.6;
		color: #555;
		margin: 40px 0 0 0;
		font-style: italic;
	`,
} as const;

export function showLobby(): HTMLElement {
	const overlay = document.createElement("div");
	overlay.style.cssText = STYLES.overlay;

	// Inject keyframes for scroll indicator
	const styleTag = document.createElement("style");
	styleTag.textContent = `
		@keyframes lobbyBounce {
			0%, 100% { opacity: 0.6; transform: translateX(-50%) translateY(0); }
			50% { opacity: 1; transform: translateX(-50%) translateY(6px); }
		}
	`;
	overlay.appendChild(styleTag);

	// Hero section (first viewport)
	const hero = document.createElement("div");
	hero.style.cssText = STYLES.hero;
	hero.dataset.role = "hero";

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

	const tapHint = document.createElement("p");
	tapHint.style.cssText = `
		font-size: 14px;
		color: #888;
		letter-spacing: 0.1em;
		margin-top: 32px;
		text-transform: uppercase;
	`;
	tapHint.textContent = "click anywhere to begin";
	inner.appendChild(tapHint);

	hero.appendChild(inner);

	// Scroll indicator
	const scrollIndicator = document.createElement("div");
	scrollIndicator.style.cssText = STYLES.scrollIndicator;
	scrollIndicator.innerHTML = `
		<span>scroll for more</span>
		<svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="1,1 8,8 15,1"/>
		</svg>
	`;
	hero.appendChild(scrollIndicator);

	overlay.appendChild(hero);

	// About section
	const about = document.createElement("div");
	about.style.cssText = STYLES.aboutSection;

	const aboutInner = document.createElement("div");
	aboutInner.style.cssText = STYLES.aboutInner;

	const separator = document.createElement("hr");
	separator.style.cssText = STYLES.aboutSeparator;
	aboutInner.appendChild(separator);

	const paragraphs = [
		"時痕 Rubato (Time Scar) is an interactive new media installation by Sarah Lin and Eugene Dobry, created for the time.place exhibition at tiat in San Francisco.",
		"A camera watches the space. When it finds you, your body becomes a presence in a slowly modulating fog field — not a reflection, but a shadow that moves as you move, inscribing traces into the surface of the image.",
		"Move and you leave residue — temporal marks along the path of your passage. Stand still and the accumulation stops. Step away and what remains is a machine still moving according to someone no longer there. The screen becomes a repository of absent bodies. Traces dissolve slowly, unevenly, like memory corrupting.",
		"The piece asks whether time is something external that we obey, or something internal that we inscribe — into machines, into spaces, into each other. The shadow recalls the sundial, the oldest temporal instrument. The body recalls butoh, the dance of darkness. Both turn presence into mark.",
	];

	const credit = document.createElement("p");
	credit.style.cssText = `
		font-size: 12px;
		font-weight: 300;
		line-height: 1.6;
		color: #666;
		margin: 32px 0 0 0;
		text-align: center;
	`;
	credit.textContent =
		"Sarah Lin — artist  ·  Eugene Dobry — technical collaborator";

	for (const text of paragraphs) {
		const p = document.createElement("p");
		p.style.cssText = STYLES.aboutParagraph;
		if (text.includes("time.place")) {
			// Make "time.place" a link and italicize
			p.innerHTML = text.replace(
				"time.place",
				'<a href="https://www.tiat.place/exhibitions/time-place" target="_blank" rel="noopener" style="color: #bbb; text-decoration: underline; text-decoration-color: #555; text-underline-offset: 3px;"><em>time.place</em></a>',
			);
		} else {
			p.textContent = text;
		}
		aboutInner.appendChild(p);
	}

	const cameraNote = document.createElement("p");
	cameraNote.style.cssText = STYLES.aboutNote;
	cameraNote.textContent =
		"This piece requires camera access to detect your presence.";
	aboutInner.appendChild(cameraNote);
	aboutInner.appendChild(credit);

	// Remote control section — QR code for multi-device setups
	const tsHost: string | null = (globalThis as Record<string, unknown>)
		.__TAILSCALE_HOST__ as string | null;
	const port = location.port ? `:${location.port}` : "";
	const origin = tsHost ? `https://${tsHost}${port}` : window.location.origin;
	const adminUrl = `${origin}/admin/`;

	const remoteSep = document.createElement("hr");
	remoteSep.style.cssText = `
		width: 40px;
		height: 1px;
		background: #333;
		border: none;
		margin: 48px auto 32px;
	`;
	aboutInner.appendChild(remoteSep);

	const remoteLabel = document.createElement("p");
	remoteLabel.style.cssText = `
		font-size: 12px;
		font-weight: 300;
		color: #555;
		letter-spacing: 0.05em;
		text-align: center;
		margin: 0 0 16px 0;
	`;
	remoteLabel.textContent = "Control from another device";
	aboutInner.appendChild(remoteLabel);

	const qrWrapper = document.createElement("div");
	qrWrapper.style.cssText = `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	`;

	const canvas = document.createElement("canvas");
	QRCode.toCanvas(canvas, adminUrl, {
		width: 140,
		margin: 0,
		color: { dark: "#888888", light: "#000000" },
	});

	const urlText = document.createElement("p");
	urlText.style.cssText = `
		font-size: 11px;
		color: #444;
		font-family: "SF Mono", Menlo, Consolas, monospace;
		letter-spacing: 0.02em;
		margin: 0;
	`;
	urlText.textContent = adminUrl;

	qrWrapper.appendChild(canvas);
	qrWrapper.appendChild(urlText);
	aboutInner.appendChild(qrWrapper);

	about.appendChild(aboutInner);
	overlay.appendChild(about);

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
