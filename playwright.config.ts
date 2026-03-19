import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	use: {
		browserName: "chromium",
		headless: !process.env.HEADED && !process.env.INTERACT,
		launchOptions: {
			args: [
				"--use-fake-ui-for-media-stream", // Auto-grant camera permission
				"--enable-features=UseOzonePlatform",
			],
		},
		viewport: { width: 1920, height: 1080 },
	},
});
