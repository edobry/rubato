import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { type WebSocket, WebSocketServer } from "ws";
import { FileClipStore } from "../../server/clip-store.js";
import { Relay } from "./relay.js";

export function wsPlugin(): Plugin {
	return {
		name: "rubato-ws",
		configureServer(server) {
			const wss = new WebSocketServer({ noServer: true });
			const sockets = new Map<string, WebSocket>();
			let nextId = 0;

			const relay = new Relay((clientId, data) => {
				const ws = sockets.get(clientId);
				if (ws && ws.readyState === ws.OPEN) {
					ws.send(data);
				}
			});

			// Clip upload/serve endpoints
			const store = new FileClipStore(path.join(process.cwd(), ".clips"));

			server.middlewares.use("/clips", (req, res, next) => {
				if (req.method === "POST") {
					const filename = `clip-${Date.now()}.webm`;
					const chunks: Buffer[] = [];
					req.on("data", (chunk: Buffer) => chunks.push(chunk));
					req.on("end", () => {
						void store.save(filename, Buffer.concat(chunks)).then((url) => {
							res.writeHead(200, {
								"Content-Type": "application/json",
							});
							res.end(JSON.stringify({ url }));
						});
					});
					return;
				}

				if (req.method === "GET") {
					const filename = req.url?.replace(/^\//, "") ?? "";
					const filepath = store.filePath(filename);
					if (fs.existsSync(filepath)) {
						res.writeHead(200, {
							"Content-Type": "video/webm",
							"Content-Disposition": `attachment; filename="${filename}"`,
						});
						fs.createReadStream(filepath).pipe(res);
					} else {
						res.writeHead(404);
						res.end("Not found");
					}
					return;
				}
				next();
			});

			server.httpServer?.on("upgrade", (req, socket, head) => {
				// Only handle our path; let Vite HMR handle its own
				if (req.url !== "/ws") return;

				wss.handleUpgrade(req, socket, head, (ws) => {
					wss.emit("connection", ws, req);
				});
			});

			wss.on("connection", (ws) => {
				const id = String(nextId++);
				sockets.set(id, ws);
				relay.connect(id);

				ws.on("message", (raw) => {
					relay.message(id, raw.toString());
				});

				ws.on("close", () => {
					relay.disconnect(id);
					sockets.delete(id);
				});
			});
		},
	};
}
