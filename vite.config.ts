import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";
import glsl from "vite-plugin-glsl";
import { viteStaticCopy } from "vite-plugin-static-copy";

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

export default defineConfig({
	worker: {
		format: "es",
		plugins: () => [glsl()],
	},
	server: {
		host: true,
		hmr: {
			// Let the client connect to whatever hostname it used for the page.
			// Without this, HMR tries localhost which fails on LAN clients.
			host: "0.0.0.0",
		},
		headers: {
			"Cache-Control": "no-store",
		},
	},
	plugins: [
		basicSsl(),
		glsl(),
		presetSyncPlugin(),
		viteStaticCopy({
			targets: [
				{
					src: "node_modules/@mediapipe/tasks-vision/wasm/*",
					dest: "mediapipe/wasm",
				},
			],
		}),
	],
});
