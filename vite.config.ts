import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";
import glsl from "vite-plugin-glsl";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { wsPlugin } from "./src/ws/plugin.js";

/** Read the Tailscale hostname of the current machine, if available. */
function getTailscaleHostname(): string | null {
	try {
		const raw = execSync("tailscale status --self --json", {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const data = JSON.parse(raw);
		return data.Self?.HostName ?? null;
	} catch {
		return null;
	}
}

const tailscaleHost = getTailscaleHostname();
if (tailscaleHost) {
	console.log(`[rubato] Tailscale hostname: ${tailscaleHost}`);
}

/** Vite plugin that serves a simple preset sync API during development. */
function presetSyncPlugin(): Plugin {
	const presetsPath = resolve(__dirname, "custom-presets.json");

	function readPresets(): Record<string, unknown> {
		if (!existsSync(presetsPath)) return {};
		try {
			return JSON.parse(readFileSync(presetsPath, "utf-8"));
		} catch {
			return {};
		}
	}

	function writePresets(data: Record<string, unknown>): void {
		writeFileSync(presetsPath, `${JSON.stringify(data, null, "\t")}\n`);
	}

	return {
		name: "preset-sync",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith("/api/presets")) return next();

				// GET /api/presets
				if (req.method === "GET" && req.url === "/api/presets") {
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify(readPresets()));
					return;
				}

				// POST /api/presets
				if (req.method === "POST" && req.url === "/api/presets") {
					let body = "";
					req.on("data", (chunk: Buffer) => {
						body += chunk.toString();
					});
					req.on("end", () => {
						try {
							const { name, preset } = JSON.parse(body);
							const presets = readPresets();
							presets[name] = preset;
							writePresets(presets);
							res.setHeader("Content-Type", "application/json");
							res.end(JSON.stringify({ ok: true }));
						} catch {
							res.statusCode = 400;
							res.end(JSON.stringify({ error: "Invalid JSON" }));
						}
					});
					return;
				}

				// DELETE /api/presets/:name
				if (req.method === "DELETE" && req.url.startsWith("/api/presets/")) {
					const name = decodeURIComponent(
						req.url.slice("/api/presets/".length),
					);
					const presets = readPresets();
					delete presets[name];
					writePresets(presets);
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify({ ok: true }));
					return;
				}

				next();
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
			presetSyncPlugin(),
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
