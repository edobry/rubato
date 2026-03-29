import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { type WebSocket, WebSocketServer } from "ws";
import type {
	ClientRole,
	ClipRequestMessage,
	ClipResponseMessage,
	CommandMessage,
	ParamStateMessage,
	ParamUpdateMessage,
	PresetCommandMessage,
	PresetListMessage,
	RequestStateMessage,
	RtcAnswerMessage,
	RtcIceCandidateMessage,
	RtcOfferMessage,
	StateMessage,
	StreamRequestMessage,
	StreamStopMessage,
	WsMessage,
} from "./protocol.js";

interface TrackedClient {
	ws: WebSocket;
	role: ClientRole;
	/** Unique ID for admin clients, used for targeted WebRTC signaling */
	adminId?: string;
}

export function wsPlugin(): Plugin {
	return {
		name: "rubato-ws",
		configureServer(server) {
			const wss = new WebSocketServer({ noServer: true });
			const clients = new Set<TrackedClient>();

			// Clip upload/serve endpoints
			const clipsDir = path.join(process.cwd(), ".clips");
			fs.mkdirSync(clipsDir, { recursive: true });

			server.middlewares.use("/clips", (req, res, next) => {
				if (req.method === "POST") {
					const filename = `clip-${Date.now()}.webm`;
					const filepath = path.join(clipsDir, filename);
					const chunks: Buffer[] = [];
					req.on("data", (chunk: Buffer) => chunks.push(chunk));
					req.on("end", () => {
						fs.writeFileSync(filepath, Buffer.concat(chunks));
						res.writeHead(200, {
							"Content-Type": "application/json",
						});
						res.end(JSON.stringify({ url: `/clips/${filename}` }));
					});
					return;
				}

				if (req.method === "GET") {
					const filename = req.url?.replace(/^\//, "") ?? "";
					const filepath = path.join(clipsDir, filename);
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
				// Default role until the client sends a register message
				const client: TrackedClient = { ws, role: "admin" };
				clients.add(client);
				console.log("[rubato-ws] Client connected");

				ws.on("message", (raw) => {
					try {
						const msg: WsMessage = JSON.parse(raw.toString());

						if (msg.type === "register") {
							client.role = msg.role;
							if (msg.adminId) client.adminId = msg.adminId;
							console.log(
								`[rubato-ws] Client registered as ${msg.role}${msg.adminId ? ` (adminId: ${msg.adminId})` : ""}`,
							);
							// When a new admin connects, ask piece clients to resend state
							if (msg.role === "admin") {
								broadcast(clients, "piece", { type: "requestState" });
							}
							return;
						}

						if (msg.type === "command") {
							// Forward commands to all piece clients
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "state") {
							// Forward state to all admin clients
							broadcast(clients, "admin", msg);
							return;
						}

						if (msg.type === "paramUpdate") {
							// Forward param updates to piece clients (admin → piece)
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "paramState") {
							// Forward param state to admin clients (piece → admin)
							broadcast(clients, "admin", msg);
							return;
						}

						if (msg.type === "presetCommand") {
							// Forward preset commands to piece clients (admin → piece)
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "presetList") {
							// Forward preset list to admin clients (piece → admin)
							broadcast(clients, "admin", msg);
							return;
						}

						if (msg.type === "streamRequest") {
							// Forward stream request to piece clients (admin → piece)
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "streamStop") {
							// Forward stream stop to piece clients (admin → piece)
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "rtcOffer") {
							// Forward RTC offer to the specific admin (piece → admin)
							sendToAdmin(clients, msg.adminId, msg);
							return;
						}

						if (msg.type === "rtcAnswer") {
							// Forward RTC answer to piece clients (admin → piece)
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "rtcIceCandidate") {
							// Forward ICE candidates to the other role
							if (client.role === "admin") {
								broadcast(clients, "piece", msg);
							} else {
								sendToAdmin(clients, msg.adminId, msg);
							}
							return;
						}

						if (msg.type === "clipRequest") {
							// Forward clip request to piece clients (admin → piece)
							broadcast(clients, "piece", msg);
							return;
						}

						if (msg.type === "clipResponse") {
							// Forward clip response to the specific admin (piece → admin)
							sendToAdmin(clients, msg.adminId, msg);
							return;
						}
					} catch (err) {
						console.error("[rubato-ws] Invalid message:", err);
					}
				});

				ws.on("close", () => {
					clients.delete(client);
					console.log(`[rubato-ws] ${client.role} client disconnected`);
				});
			});
		},
	};
}

/** Send a message to all connected clients with the given role. */
function broadcast(
	clients: Set<TrackedClient>,
	targetRole: ClientRole,
	msg:
		| CommandMessage
		| StateMessage
		| ParamUpdateMessage
		| ParamStateMessage
		| RequestStateMessage
		| PresetCommandMessage
		| PresetListMessage
		| StreamRequestMessage
		| StreamStopMessage
		| RtcAnswerMessage
		| RtcIceCandidateMessage
		| ClipRequestMessage,
): void {
	const payload = JSON.stringify(msg);
	for (const c of clients) {
		if (c.role === targetRole && c.ws.readyState === c.ws.OPEN) {
			c.ws.send(payload);
		}
	}
}

/** Send a message to a specific admin client by adminId. */
function sendToAdmin(
	clients: Set<TrackedClient>,
	adminId: string,
	msg: RtcOfferMessage | RtcIceCandidateMessage | ClipResponseMessage,
): void {
	const payload = JSON.stringify(msg);
	for (const c of clients) {
		if (
			c.role === "admin" &&
			c.adminId === adminId &&
			c.ws.readyState === c.ws.OPEN
		) {
			c.ws.send(payload);
			return;
		}
	}
}
