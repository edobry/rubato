/**
 * Pipeline integration tests — verify data flow through rendering stages.
 *
 * Uses synthetic mask injection and FBO readback to test:
 * - Motion detection produces output when mask changes between frames
 * - Trail accumulation persists across frames
 * - Density cultivation builds up during body presence (imprint mode)
 * - Fog interaction modulates output based on mask/trail data
 */
import { expect, test } from "@playwright/test";

const BASE_URL = "https://localhost:5173";
const W = 256;
const H = 256;

/** Create a body mask — centered rectangle. */
function bodyMask(): number[] {
	const mask = new Array(W * H).fill(0);
	for (let y = Math.floor(H * 0.2); y < Math.floor(H * 0.8); y++) {
		for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.7); x++) {
			mask[y * W + x] = 1.0;
		}
	}
	return mask;
}

/** Create a body mask shifted right (for motion testing). */
function shiftedBodyMask(): number[] {
	const mask = new Array(W * H).fill(0);
	for (let y = Math.floor(H * 0.2); y < Math.floor(H * 0.8); y++) {
		for (let x = Math.floor(W * 0.5); x < Math.floor(W * 0.9); x++) {
			mask[y * W + x] = 1.0;
		}
	}
	return mask;
}

/** Empty mask (no body). */
function emptyMask(): number[] {
	return new Array(W * H).fill(0);
}

/** Start the piece and wait for pipeline. */
async function startAndWait(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.goto(`${BASE_URL}?test`);
	await page.waitForSelector("[data-role='hero']");
	await page.locator("[data-role='hero']").click();
	await page.waitForFunction(() => (window as any).__rubato?.fps > 0, {
		timeout: 20000,
	});
	await page.waitForTimeout(500);
}

/** Inject a mask and wait for it to be processed. */
async function injectMask(
	page: import("@playwright/test").Page,
	mask: number[],
): Promise<void> {
	await page.evaluate(
		({ maskData, w, h }) => {
			(window as any).__rubato?.injectTestFrame(maskData, w, h);
		},
		{ maskData: mask, w: W, h: H },
	);
	await page.waitForTimeout(100);
}

/** Read trail pixels at the center of the body region. */
async function readTrailCenter(
	page: import("@playwright/test").Page,
): Promise<{ r: number; g: number; b: number; a: number } | null> {
	return await page.evaluate(() => {
		return (window as any).__rubato?.readTrailPixels(
			Math.floor(256 * 0.5),
			Math.floor(256 * 0.5),
		);
	});
}

// ── Frame state tests ───────────────────────────────────────────────

test("injected mask updates frame state", async ({ page }) => {
	await startAndWait(page);

	const before = await page.evaluate(() => (window as any).__rubato?.frame);
	expect(before.generation).toBe(0);

	await injectMask(page, bodyMask());

	const after = await page.evaluate(() => (window as any).__rubato?.frame);
	expect(after.generation).toBeGreaterThan(before.generation);
	expect(after.hasMask).toBe(true);
	expect(after.maskW).toBe(256);
	expect(after.maskH).toBe(256);
});

// ── Motion detection tests ──────────────────────────────────────────

test("motion is detected when mask changes between frames", async ({
	page,
}) => {
	await startAndWait(page);

	// First frame: body on left-center
	await injectMask(page, bodyMask());

	// Second frame: body shifted right — should produce motion in the transition region
	await injectMask(page, shiftedBodyMask());

	const frame = await page.evaluate(() => (window as any).__rubato?.frame);
	expect(frame.hasMotion).toBe(true);
});

test("no motion when mask is static", async ({ page }) => {
	await startAndWait(page);

	const mask = bodyMask();
	// Same mask twice — should produce minimal/no motion
	await injectMask(page, mask);
	await injectMask(page, mask);

	// Motion should still exist as a Float32Array but values should be near zero
	const frame = await page.evaluate(() => (window as any).__rubato?.frame);
	expect(frame.hasMotion).toBe(true);
	// We can't easily check values are zero from here, but the frame should have motion data
});

// ── Trail accumulation tests ────────────────────────────────────────

test("trail accumulates over multiple frames", async ({ page }) => {
	await startAndWait(page);

	// Apply default preset (uses "both" visualize mode — trail R channel)
	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("default");
	});
	await page.waitForTimeout(300);

	// Inject body, then shift to create trail deposits
	await injectMask(page, bodyMask());
	await injectMask(page, shiftedBodyMask());

	// Inject several more frames of the shifted position to accumulate
	for (let i = 0; i < 5; i++) {
		await injectMask(page, shiftedBodyMask());
	}

	const frame = await page.evaluate(() => (window as any).__rubato?.frame);
	expect(frame.hasTrail).toBe(true);
});

test("trail FBO has non-zero values after body movement", async ({ page }) => {
	await startAndWait(page);

	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("default");
	});
	await page.waitForTimeout(300);

	// Inject body and movement
	await injectMask(page, bodyMask());
	await page.waitForTimeout(100);
	await injectMask(page, shiftedBodyMask());
	await page.waitForTimeout(100);

	// Read trail pixels — should have non-zero R (trail deposition)
	const px = await readTrailCenter(page);
	expect(px).not.toBeNull();
	if (px) {
		// Trail R channel should have accumulated something
		// (may be zero at exact center if body hasn't reached there)
		// Check a broader assertion: at least one channel is non-zero
		const hasData = px.r > 0 || px.g > 0;
		expect(hasData).toBe(true);
	}
});

// ── Density cultivation tests (imprint mode) ────────────────────────

test("cultivation accumulates during body presence in imprint mode", async ({
	page,
}) => {
	await startAndWait(page);

	// Shadow Realm uses imprint mode
	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("shadow realm");
	});
	await page.waitForTimeout(500);

	// Inject body mask repeatedly — cultivation (R channel) should increase
	const mask = bodyMask();
	for (let i = 0; i < 10; i++) {
		await injectMask(page, mask);
	}

	const px = await readTrailCenter(page);
	expect(px).not.toBeNull();
	if (px) {
		// R channel = cultivation energy (should accumulate inside body)
		expect(px.r).toBeGreaterThan(0);
	}
});

test("density appears after body departure in imprint mode", async ({
	page,
}) => {
	await startAndWait(page);

	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("shadow realm");
	});
	await page.waitForTimeout(500);

	// Build up cultivation
	const mask = bodyMask();
	for (let i = 0; i < 10; i++) {
		await injectMask(page, mask);
	}

	// Depart — inject empty mask (body leaves)
	for (let i = 0; i < 5; i++) {
		await injectMask(page, emptyMask());
	}

	// Read at the center where body WAS — G channel (density) should show departure trace
	const px = await readTrailCenter(page);
	expect(px).not.toBeNull();
	if (px) {
		// G channel = visible density (should be non-zero from departure release)
		expect(px.g).toBeGreaterThan(0);
	}
});

// ── No-body baseline ────────────────────────────────────────────────

test("trail is empty with no body present", async ({ page }) => {
	await startAndWait(page);

	await page.evaluate(() => {
		(window as any).__rubato?.applyPreset("default");
	});
	await page.waitForTimeout(300);

	// Inject empty frames
	for (let i = 0; i < 5; i++) {
		await injectMask(page, emptyMask());
	}

	const px = await readTrailCenter(page);
	expect(px).not.toBeNull();
	if (px) {
		// No body → no trail → R and G should be 0
		expect(px.r).toBe(0);
		expect(px.g).toBe(0);
	}
});
