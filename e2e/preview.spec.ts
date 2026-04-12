/**
 * WebGL pipeline e2e tests.
 *
 * Uses SwiftShader (CPU rendering) for deterministic, GPU-independent output.
 * Tests click through the lobby to exercise the full rendering pipeline:
 * camera → segmentation → trail → fog → compositor.
 */
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const BASE_URL = "https://localhost:5173";

/** Check that a screenshot has non-black pixels in the center region. */
function hasVisibleContent(screenshotBuffer: Buffer): boolean {
	const png = PNG.sync.read(screenshotBuffer);
	const cx = Math.floor(png.width / 2);
	const cy = Math.floor(png.height / 2);
	const r = Math.floor(Math.min(png.width, png.height) / 4);

	for (let y = cy - r; y < cy + r; y += 4) {
		for (let x = cx - r; x < cx + r; x += 4) {
			const idx = (y * png.width + x) * 4;
			if (
				png.data[idx]! > 2 ||
				png.data[idx + 1]! > 2 ||
				png.data[idx + 2]! > 2
			) {
				return true;
			}
		}
	}
	return false;
}

/** Wait for the rendering pipeline to be active. */
async function waitForPipeline(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.waitForFunction(() => (window as any).__rubato?.fps > 0, {
		timeout: 20000,
	});
}

/** Click the lobby to start the piece. */
async function startPiece(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.locator("[data-role='hero']").click();
}

// ── Lobby ───────────────────────────────────────────────────────────

test("lobby renders", async ({ page }) => {
	await page.goto(BASE_URL);
	await page.waitForSelector("[data-role='hero']");
	await page.waitForTimeout(1000);
	const buf = await page.screenshot();
	expect(hasVisibleContent(buf)).toBe(true);
});

test("lobby screenshot", async ({ page }) => {
	await page.goto(BASE_URL);
	await page.waitForSelector("[data-role='hero']");
	await page.waitForTimeout(1000);
	await page.screenshot({ path: "e2e/screenshot.png", fullPage: true });
});

// ── Pipeline ────────────────────────────────────────────────────────

test("pipeline starts and produces visible output", async ({ page }) => {
	await page.goto(`${BASE_URL}?test`);
	await page.waitForSelector("[data-role='hero']");
	await startPiece(page);
	await waitForPipeline(page);
	await page.waitForTimeout(3000);

	const buf = await page.screenshot();
	await page.screenshot({ path: "e2e/pipeline.png" });
	expect(hasVisibleContent(buf)).toBe(true);
});

test("pipeline reports positive fps", async ({ page }) => {
	await page.goto(`${BASE_URL}?test`);
	await page.waitForSelector("[data-role='hero']");
	await startPiece(page);
	await waitForPipeline(page);

	const fps = await page.evaluate(() => (window as any).__rubato?.fps ?? 0);
	expect(fps).toBeGreaterThan(0);
});

// ── Presets ──────────────────────────────────────────────────────────

const PRESETS = [
	"default",
	"taichi",
	"shadow realm",
	"sarahdance",
	"silhouette",
];

for (const presetName of PRESETS) {
	test(`preset "${presetName}" renders visible output`, async ({ page }) => {
		await page.goto(`${BASE_URL}?test`);
		await page.waitForSelector("[data-role='hero']");
		await startPiece(page);
		await waitForPipeline(page);

		// Apply preset via debug API
		await page.evaluate((name: string) => {
			(window as any).__rubato?.applyPreset(name);
		}, presetName);

		// Wait for preset to take effect
		await page.waitForTimeout(3000);

		const buf = await page.screenshot();
		expect(hasVisibleContent(buf)).toBe(true);
	});
}

// ── Interactive ─────────────────────────────────────────────────────

test("interact", async ({ page }) => {
	test.skip(!process.env.INTERACT, "Set INTERACT=1 to run this test");
	await page.goto(`${BASE_URL}?test`);
	await page.waitForSelector("[data-role='hero']");
	await page.pause();
});
