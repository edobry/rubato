/**
 * Help overlay — press '?' to toggle a compact panel showing all
 * available keyboard shortcuts.
 */

const STYLES = {
	overlay: `
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10002;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		color: #fff;
		-webkit-font-smoothing: antialiased;
		background: rgba(0, 0, 0, 0.6);
	`,
	panel: `
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		padding: 36px 48px;
		background: #111;
		border-radius: 12px;
		border: 1px solid #333;
	`,
	title: `
		font-size: 14px;
		font-weight: 400;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #999;
		margin: 0;
	`,
	table: `
		border-collapse: collapse;
		border-spacing: 0;
	`,
	keyCell: `
		padding: 5px 20px 5px 0;
		font-family: "SF Mono", Menlo, Consolas, monospace;
		font-size: 13px;
		color: #ccc;
		text-align: right;
		white-space: nowrap;
		vertical-align: top;
	`,
	descCell: `
		padding: 5px 0;
		font-size: 13px;
		color: #888;
		vertical-align: top;
	`,
	sectionHeader: `
		padding: 12px 0 4px 0;
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: #555;
	`,
	hint: `
		font-size: 12px;
		color: #777;
		letter-spacing: 0.05em;
		margin: 8px 0 0 0;
		padding: 8px 16px;
		border: 1px solid #333;
		border-radius: 6px;
	`,
} as const;

interface ShortcutEntry {
	key: string;
	desc: string;
}

interface ShortcutSection {
	label?: string;
	entries: ShortcutEntry[];
}

const SHORTCUTS: ShortcutSection[] = [
	{
		entries: [
			{ key: "Tab", desc: "Toggle params panel" },
			{
				key: "\u2190 / \u2192",
				desc: "Browse presets (when panel is closed)",
			},
			{ key: "F", desc: "Toggle fullscreen" },
			{ key: "S", desc: "Toggle stats/FPS overlay" },
			{ key: "A", desc: "Toggle admin overlay" },
			{ key: "L", desc: "Return to lobby" },
			{ key: "E", desc: "Export current params to clipboard" },
			{ key: "?", desc: "Toggle this help menu" },
		],
	},
	{
		label: "When params panel is open (Tab)",
		entries: [
			{ key: "\u2191 / \u2193", desc: "Navigate controls" },
			{ key: "\u2190 / \u2192", desc: "Adjust values / collapse folders" },
			{
				key: "Shift + \u2190/\u2192",
				desc: "Larger step adjustment",
			},
			{ key: "Enter", desc: "Activate / toggle folder" },
		],
	},
];

let overlayEl: HTMLElement | null = null;

function createOverlay(): HTMLElement {
	const overlay = document.createElement("div");
	overlay.style.cssText = STYLES.overlay;

	const panel = document.createElement("div");
	panel.style.cssText = STYLES.panel;

	// Title
	const title = document.createElement("p");
	title.style.cssText = STYLES.title;
	title.textContent = "Keyboard Shortcuts";
	panel.appendChild(title);

	// Shortcuts table
	const table = document.createElement("table");
	table.style.cssText = STYLES.table;
	const tbody = document.createElement("tbody");

	for (const section of SHORTCUTS) {
		if (section.label) {
			const headerRow = document.createElement("tr");
			const headerCell = document.createElement("td");
			headerCell.colSpan = 2;
			headerCell.style.cssText = STYLES.sectionHeader;
			headerCell.textContent = section.label;
			headerRow.appendChild(headerCell);
			tbody.appendChild(headerRow);
		}

		for (const entry of section.entries) {
			const row = document.createElement("tr");

			const keyCell = document.createElement("td");
			keyCell.style.cssText = STYLES.keyCell;
			keyCell.textContent = entry.key;

			const descCell = document.createElement("td");
			descCell.style.cssText = STYLES.descCell;
			descCell.textContent = entry.desc;

			row.appendChild(keyCell);
			row.appendChild(descCell);
			tbody.appendChild(row);
		}
	}

	table.appendChild(tbody);
	panel.appendChild(table);

	// Dismiss hint
	const hint = document.createElement("p");
	hint.style.cssText = STYLES.hint;
	hint.textContent = "press ?, Enter, or Escape to dismiss";
	panel.appendChild(hint);

	overlay.appendChild(panel);
	return overlay;
}

/** Toggle the help overlay. Returns true if now visible. */
export function toggleHelpOverlay(): boolean {
	if (overlayEl) {
		overlayEl.remove();
		overlayEl = null;
		return false;
	}
	overlayEl = createOverlay();
	document.body.appendChild(overlayEl);
	return true;
}

/** Dismiss the help overlay if it is currently showing. */
export function hideHelpOverlay(): void {
	if (overlayEl) {
		overlayEl.remove();
		overlayEl = null;
	}
}

/** Whether the help overlay is currently visible. */
export function isHelpOverlayVisible(): boolean {
	return overlayEl !== null;
}
