import type { Plugin } from "vite";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = "remote-console.log";

export function remoteConsolePlugin(): Plugin {
	const logPath = join(process.cwd(), LOG_FILE);

	return {
		name: "rubato:remote-console",
		configureServer(server) {
			// Clear log on server start
			writeFileSync(logPath, "");

			server.middlewares.use((req, res, next) => {
				if (req.url !== "/api/console") return next();

				if (req.method === "DELETE") {
					writeFileSync(logPath, "");
					res.writeHead(204);
					res.end();
					return;
				}

				if (req.method !== "POST") return next();

				let body = "";
				req.on("data", (chunk: Buffer) => {
					body += chunk.toString();
				});
				req.on("end", () => {
					try {
						const { level, args, timestamp, url } = JSON.parse(body);
						const tag = (level || "log").toUpperCase().padEnd(5);
						const page = url || "unknown";
						const msg = (args || []).join(" ");
						const line = `[${timestamp}] ${tag} (${page}) ${msg}\n`;
						appendFileSync(logPath, line);
					} catch {
						// Ignore malformed logs
					}
					res.writeHead(204);
					res.end();
				});
			});
		},
	};
}
