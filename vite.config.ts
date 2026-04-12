import { execSync } from "node:child_process";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";
import glsl from "vite-plugin-glsl";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { buildInfo } from "./server/build-info.js";
import { presetSyncPlugin } from "./server/preset-api.js";
import { FilePresetStore } from "./server/preset-store.js";
import { remoteConsolePlugin } from "./server/remote-console.js";
import { wsPlugin } from "./src/ws/plugin.js";

/** Try running a Tailscale CLI command at the given path. */
function tryTailscaleCli(bin: string): string | null {
	try {
		const raw = execSync(`${bin} status --self --json`, {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const data = JSON.parse(raw);
		// Use DNSName (dashes, resolvable) not HostName (may have spaces).
		// DNSName looks like "machine-name.tailnet.ts.net." — extract short name.
		const dns: string | undefined = data.Self?.DNSName;
		if (dns) return dns.replace(/\.$/, "").split(".")[0] ?? null;
		return data.Self?.HostName ?? null;
	} catch {
		return null;
	}
}

/** Read the Tailscale hostname of the current machine, if available.
 *  Tries the PATH-based `tailscale` first, then the macOS app bundle CLI. */
function getTailscaleHostname(): string | null {
	return (
		tryTailscaleCli("tailscale") ??
		tryTailscaleCli("/Applications/Tailscale.app/Contents/MacOS/Tailscale")
	);
}

const tailscaleHost = getTailscaleHostname();
if (tailscaleHost) {
	console.log(`[rubato] Tailscale hostname: ${tailscaleHost}`);
}

/** Vite plugin that exposes a build-info API endpoint. */
function buildInfoPlugin(): Plugin {
	return {
		name: "build-info",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.method !== "GET" || req.url !== "/api/build-info")
					return next();

				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(buildInfo));
			});
		},
	};
}

export default defineConfig(({ mode }) => {
	const isLive = mode === "live";

	return {
		define: {
			__TAILSCALE_HOST__: JSON.stringify(tailscaleHost),
			__GIT_HASH__: JSON.stringify(buildInfo.hash),
		},
		build: {
			rollupOptions: {
				input: {
					main: resolve(__dirname, "index.html"),
					admin: resolve(__dirname, "admin/index.html"),
				},
			},
		},
		worker: {
			format: "es",
			plugins: () => [glsl()],
		},
		server: {
			host: true,
			// Live mode: no HMR, no file watching — stable server for gallery
			hmr: isLive
				? false
				: {
						host: tailscaleHost ?? "localhost",
						protocol: "wss",
					},
			watch: isLive ? { ignored: ["**"] } : undefined,
			headers: {
				"Cache-Control": "no-store",
			},
		},
		plugins: [
			basicSsl(),
			glsl(),
			buildInfoPlugin(),
			presetSyncPlugin(
				new FilePresetStore(resolve(__dirname, "custom-presets.json")),
			),
			wsPlugin(),
			remoteConsolePlugin(),
			viteStaticCopy({
				targets: [
					{
						src: "node_modules/@mediapipe/tasks-vision/wasm/*",
						dest: "mediapipe/wasm",
					},
				],
			}),
		],
	};
});
