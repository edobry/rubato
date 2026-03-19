import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	use: {
		browserName: "chromium",
		headless: !process.env.HEADED && !process.env.INTERACT,
		ignoreHTTPSErrors: true,
		launchOptions: {
			args: [
				"--use-fake-ui-for-media-stream", // Auto-grant camera permission
				"--use-fake-device-for-media-stream", // Provide fake camera in headless
			],
		},
		viewport: { width: 1920, height: 1080 },
	},
});
