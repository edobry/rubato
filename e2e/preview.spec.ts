/**
 * Playwright utility for visual verification and interaction.
 *
 * Usage:
 *   npx playwright test e2e/preview.ts                    # screenshot only
 *   HEADED=1 npx playwright test e2e/preview.ts           # headed (visible browser)
 *   INTERACT=1 npx playwright test e2e/preview.ts         # headed + pause for interaction
 */
import { test } from "@playwright/test";

const BASE_URL = "http://localhost:5173";

test("screenshot", async ({ page }) => {
	await page.goto(BASE_URL);
	// Wait for the canvas to be in the DOM and a frame to render
	await page.waitForSelector("canvas");
	await page.waitForTimeout(1000);
	await page.screenshot({ path: "e2e/screenshot.png", fullPage: true });
});

test("interact", async ({ page }) => {
	test.skip(!process.env.INTERACT, "Set INTERACT=1 to run this test");
	await page.goto(BASE_URL);
	await page.waitForSelector("canvas");
	await page.pause(); // Opens Playwright Inspector for manual interaction
});
