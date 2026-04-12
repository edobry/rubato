/** Loading overlay shown between lobby dismiss and first frame render. */

export function showLoading(): HTMLElement {
	const overlay = document.createElement("div");
	overlay.style.cssText =
		"position:fixed;inset:0;background:#000;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;";

	const title = document.createElement("div");
	title.textContent = "\u6642\u75D5";
	title.style.cssText =
		"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:48px;font-weight:200;color:#fff;letter-spacing:0.15em;-webkit-font-smoothing:antialiased;";

	const status = document.createElement("div");
	status.textContent = "initializing\u2026";
	status.style.cssText =
		"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:300;color:#666;letter-spacing:0.1em;margin-top:24px;animation:rubato-loading-pulse 1.5s ease-in-out infinite;-webkit-font-smoothing:antialiased;";

	// Inject keyframe animation
	const style = document.createElement("style");
	style.textContent = `@keyframes rubato-loading-pulse{0%,100%{opacity:.3}50%{opacity:1}}`;
	overlay.appendChild(style);

	overlay.appendChild(title);
	overlay.appendChild(status);

	return overlay;
}

export function hideLoading(el: HTMLElement): void {
	el.style.transition = "opacity 0.5s ease";
	el.style.opacity = "0";
	setTimeout(() => el.remove(), 500);
}
