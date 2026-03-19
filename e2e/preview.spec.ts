/**
 * Playwright utility for visual verification and interaction.
 *
 * Usage:
 *   npm run screenshot                    # headless screenshot
 *   HEADED=1 npm run screenshot           # headed screenshot
 *   npm run interact                      # headed + Playwright Inspector
 */
import { expect, test } from "@playwright/test";

const BASE_URL = "https://localhost:5173";

/** Check that a canvas has non-black pixels (i.e. something is rendering). */
async function canvasHasContent(
	page: import("@playwright/test").Page,
): Promise<boolean> {
	return page.evaluate(() => {
		const canvas = document.querySelector("canvas");
		if (!canvas) return false;
		const ctx = canvas.getContext("2d");
		if (!ctx) return false;
		const data = ctx.getImageData(
			canvas.width / 4,
			canvas.height / 4,
			canvas.width / 2,
			canvas.height / 2,
		).data;
		// Check if any pixel in the center region is non-black
		for (let i = 0; i < data.length; i += 4) {
			if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) return true;
		}
		return false;
	});
}

test("screenshot", async ({ page }) => {
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	await page.waitForTimeout(3000);
	await page.screenshot({ path: "e2e/screenshot.png", fullPage: true });
});

test("canvas renders content", async ({ page }) => {
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	await page.waitForTimeout(2000);
	const hasContent = await canvasHasContent(page);
	expect(hasContent).toBe(true);
});

test("resolution change keeps rendering", async ({ page }) => {
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	await page.waitForTimeout(2000);

	// Take baseline screenshot
	const before = await canvasHasContent(page);
	expect(before).toBe(true);

	// Change resolution via the GUI dropdown
	const select = page.locator(".lil-gui select").first();
	await select.selectOption("480p");
	await page.waitForTimeout(2000);

	// Verify canvas still has content after resolution change
	await page.screenshot({
		path: "e2e/screenshot-after-res-change.png",
		fullPage: true,
	});
	const after = await canvasHasContent(page);
	expect(after).toBe(true);
});

test("interact", async ({ page }) => {
	test.skip(!process.env.INTERACT, "Set INTERACT=1 to run this test");
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	await page.pause();
});
