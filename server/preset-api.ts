import type { Connect, Plugin } from "vite";
import type { PresetStore } from "./preset-store.js";

/** Read the full request body as a string. */
function readBody(req: Connect.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

/**
 * Vite plugin that exposes REST endpoints for preset CRUD.
 *
 *   GET    /api/presets         → list all presets
 *   POST   /api/presets         → save a preset  { name, preset }
 *   DELETE /api/presets/:name   → delete a preset
 */
export function presetSyncPlugin(store: PresetStore): Plugin {
	return {
		name: "preset-sync",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = req.url ?? "";

				// GET /api/presets
				if (req.method === "GET" && url === "/api/presets") {
					try {
						const data = await store.list();
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify(data));
					} catch (err) {
						res.statusCode = 500;
						res.end(
							JSON.stringify({ error: String(err) }),
						);
					}
					return;
				}

				// POST /api/presets
				if (req.method === "POST" && url === "/api/presets") {
					try {
						const body = JSON.parse(await readBody(req)) as {
							name?: string;
							preset?: unknown;
						};
						if (!body.name || body.preset === undefined) {
							res.statusCode = 400;
							res.end(
								JSON.stringify({
									error: "name and preset are required",
								}),
							);
							return;
						}
						await store.save(body.name, body.preset);
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true }));
					} catch (err) {
						res.statusCode = 500;
						res.end(
							JSON.stringify({ error: String(err) }),
						);
					}
					return;
				}

				// DELETE /api/presets/:name
				const deleteMatch = req.method === "DELETE" && url.match(/^\/api\/presets\/(.+)$/);
				if (deleteMatch) {
					try {
						const name = decodeURIComponent(deleteMatch[1]!);
						await store.delete(name);
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true }));
					} catch (err) {
						res.statusCode = 500;
						res.end(
							JSON.stringify({ error: String(err) }),
						);
					}
					return;
				}

				next();
			});
		},
	};
}
