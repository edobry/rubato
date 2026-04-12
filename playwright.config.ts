import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	timeout: 60_000,
	use: {
		browserName: "chromium",
		headless: !process.env.HEADED && !process.env.INTERACT,
		ignoreHTTPSErrors: true,
		launchOptions: {
			args: [
				"--use-fake-ui-for-media-stream",
				"--use-fake-device-for-media-stream",
				// SwiftShader: CPU-based rendering for deterministic, GPU-independent output
				"--use-gl=angle",
				"--use-angle=swiftshader",
				"--enable-unsafe-swiftshader",
			],
		},
		viewport: { width: 1280, height: 720 },
	},
	// Snapshot comparison settings
	expect: {
		toHaveScreenshot: {
			threshold: 0.05,
			maxDiffPixelRatio: 0.02,
		},
	},
});
