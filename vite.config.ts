import { execSync } from "node:child_process";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";
import glsl from "vite-plugin-glsl";
import { viteStaticCopy } from "vite-plugin-static-copy";
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

/** Vite plugin that exposes a version check API endpoint. */
function versionCheckPlugin(): Plugin {
	const currentHash = execSync("git rev-parse --short HEAD", {
		encoding: "utf-8",
	}).trim();

	let lastFetchTime = 0;
	const FETCH_TTL_MS = 60_000;
	let cachedLatestHash: string | null = null;

	function getLatestHash(): string | null {
		const now = Date.now();
		if (now - lastFetchTime > FETCH_TTL_MS) {
			try {
				execSync("git fetch origin master --quiet", {
					encoding: "utf-8",
					timeout: 10_000,
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch {
				// git fetch failed — use cached value if available
			}
			lastFetchTime = now;
			try {
				cachedLatestHash = execSync("git rev-parse --short origin/master", {
					encoding: "utf-8",
				}).trim();
			} catch {
				cachedLatestHash = null;
			}
		}
		return cachedLatestHash;
	}

	return {
		name: "version-check",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.method !== "GET" || req.url !== "/api/version") return next();

				const latest = getLatestHash();
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify({
						current: currentHash,
						latest,
						updateAvailable: latest !== null && latest !== currentHash,
					}),
				);
			});
		},
	};
}

export default defineConfig(({ mode }) => {
	const isLive = mode === "live";

	return {
		define: {
			__TAILSCALE_HOST__: JSON.stringify(tailscaleHost),
			__GIT_HASH__: JSON.stringify(
				execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim(),
			),
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
			versionCheckPlugin(),
			wsPlugin(),
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
