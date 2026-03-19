/**
 * Playwright utility for visual verification and interaction.
 *
 * Usage:
 *   npm run screenshot                    # headless screenshot
 *   HEADED=1 npm run screenshot           # headed screenshot
 *   npm run interact                      # headed + Playwright Inspector
 */
import { test } from "@playwright/test";

const BASE_URL = "https://localhost:5173";

test("screenshot", async ({ page }) => {
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	// Wait for segmentation to initialize and a few frames to render
	await page.waitForTimeout(3000);
	await page.screenshot({ path: "e2e/screenshot.png", fullPage: true });
});

test("interact", async ({ page }) => {
	test.skip(!process.env.INTERACT, "Set INTERACT=1 to run this test");
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	await page.pause();
});
