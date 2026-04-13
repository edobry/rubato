/**
 * Golden image baseline tests — visual regression testing for each preset.
 *
 * Uses SwiftShader for GPU-independent rendering and synthetic mask injection
 * for deterministic body detection. Baselines are stored in e2e/golden.spec.ts-snapshots/
 * and compared on every run with tight tolerance.
 *
 * To update baselines after intentional visual changes:
 *   npx playwright test e2e/golden.spec.ts --update-snapshots
 */
import { expect, test } from "@playwright/test";

const BASE_URL = "https://localhost:5173";
const MASK_W = 256;
const MASK_H = 256;

/** Create a synthetic body mask — a centered rectangle. */
function createBodyMask(): number[] {
	const mask = new Array(MASK_W * MASK_H).fill(0);
	const left = Math.floor(MASK_W * 0.3);
	const right = Math.floor(MASK_W * 0.7);
	const top = Math.floor(MASK_H * 0.15);
	const bottom = Math.floor(MASK_H * 0.85);
	for (let y = top; y < bottom; y++) {
		for (let x = left; x < right; x++) {
			mask[y * MASK_W + x] = 1.0;
		}
	}
	return mask;
}

/** Start the piece and wait for the pipeline to be ready. */
async function startAndWait(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.goto(`${BASE_URL}?test`);
	await page.waitForSelector("[data-role='hero']");
	await page.locator("[data-role='hero']").click();
	await page.waitForFunction(() => (window as any).__rubato?.fps > 0, {
		timeout: 20000,
	});
	await page.waitForTimeout(1000);
}

/** Inject a body mask for several frames so trails accumulate. */
async function injectBodyFrames(
	page: import("@playwright/test").Page,
	frameCount = 10,
): Promise<void> {
	const mask = createBodyMask();
	for (let i = 0; i < frameCount; i++) {
		await page.evaluate(
			({ maskData, w, h }) => {
				(window as any).__rubato?.injectTestFrame(maskData, w, h);
			},
			{ maskData: mask, w: MASK_W, h: MASK_H },
		);
		await page.waitForTimeout(150);
	}
	// Let the last frame render
	await page.waitForTimeout(500);
}

// ── Per-preset golden image tests ────────────────────────────────────

const PRESETS = [
	"default",
	"taichi",
	"shadow realm",
	"sarahdance",
	"silhouette",
];

for (const presetName of PRESETS) {
	test(`golden: ${presetName}`, async ({ page }) => {
		await startAndWait(page);

		// Apply preset
		await page.evaluate((name: string) => {
			(window as any).__rubato?.applyPreset(name);
		}, presetName);
		await page.waitForTimeout(500);

		// Inject body mask so body interaction is visible
		await injectBodyFrames(page);

		// Compare against baseline — animated presets need longer stabilization
		const animated = ["shadow realm", "sarahdance"].includes(presetName);
		await expect(page).toHaveScreenshot(
			`${presetName.replace(/ /g, "-")}.png`,
			{
				maxDiffPixelRatio: animated ? 0.05 : 0.02,
				threshold: animated ? 0.3 : 0.1,
				timeout: animated ? 15000 : 5000,
			},
		);
	});
}

// ── Specific state golden images ────────────────────────────────────

test("golden: idle fog (no body)", async ({ page }) => {
	await startAndWait(page);
	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("default");
	});
	await page.waitForTimeout(2000);

	await expect(page).toHaveScreenshot("idle-fog.png", {
		maxDiffPixelRatio: 0.02,
		threshold: 0.1,
	});
});

test("golden: imprint density traces", async ({ page }) => {
	await startAndWait(page);

	// Shadow Realm uses imprint mode
	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("shadow realm");
	});
	await page.waitForTimeout(500);

	// Inject body, then shift to create departure traces
	const mask = createBodyMask();
	for (let i = 0; i < 8; i++) {
		await page.evaluate(
			({ maskData, w, h }) => {
				(window as any).__rubato?.injectTestFrame(maskData, w, h);
			},
			{ maskData: mask, w: MASK_W, h: MASK_H },
		);
		await page.waitForTimeout(150);
	}

	// Shift body right to create departure traces
	const shifted = new Array(MASK_W * MASK_H).fill(0);
	for (let y = Math.floor(MASK_H * 0.15); y < Math.floor(MASK_H * 0.85); y++) {
		for (let x = Math.floor(MASK_W * 0.5); x < Math.floor(MASK_W * 0.9); x++) {
			shifted[y * MASK_W + x] = 1.0;
		}
	}
	for (let i = 0; i < 5; i++) {
		await page.evaluate(
			({ maskData, w, h }) => {
				(window as any).__rubato?.injectTestFrame(maskData, w, h);
			},
			{ maskData: shifted, w: MASK_W, h: MASK_H },
		);
		await page.waitForTimeout(150);
	}
	await page.waitForTimeout(500);

	await expect(page).toHaveScreenshot("imprint-traces.png", {
		maxDiffPixelRatio: 0.05,
		threshold: 0.3,
		timeout: 15000,
	});
});
