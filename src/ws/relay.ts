import type { ClientRole, WsMessage } from "./protocol.js";

/** Callback to send a serialized message to a specific client. */
export type SendFn = (clientId: string, data: string) => void;

interface TrackedClient {
	role: ClientRole;
	/** Unique ID for admin clients, used for targeted WebRTC signaling */
	adminId?: string;
}

/**
 * Platform-agnostic WebSocket message relay.
 *
 * Tracks connected clients and their roles, routes messages between
 * piece and admin clients. Has zero platform dependencies — the actual
 * transport is provided via the `send` callback.
 */
export class Relay {
	private clients = new Map<string, TrackedClient>();

	constructor(private send: SendFn) {}

	connect(id: string): void {
		// Default role until the client sends a register message
		this.clients.set(id, { role: "admin" });
		console.log("[rubato-ws] Client connected");
	}

	disconnect(id: string): void {
		const client = this.clients.get(id);
		if (client) {
			console.log(`[rubato-ws] ${client.role} client disconnected`);
			this.clients.delete(id);
		}
	}

	message(id: string, raw: string): void {
		const client = this.clients.get(id);
		if (!client) return;

		try {
			const msg: WsMessage = JSON.parse(raw);

			if (msg.type === "register") {
				client.role = msg.role;
				if (msg.adminId) client.adminId = msg.adminId;
				console.log(
					`[rubato-ws] Client registered as ${msg.role}${msg.adminId ? ` (adminId: ${msg.adminId})` : ""}`,
				);
				// When a new admin connects, ask piece clients to resend state
				if (msg.role === "admin") {
					this.broadcast("piece", { type: "requestState" });
				}
				return;
			}

			if (msg.type === "command") {
				// Forward commands to all piece clients
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "state") {
				// Forward state to all admin clients
				this.broadcast("admin", msg);
				return;
			}

			if (msg.type === "paramUpdate") {
				// Forward param updates to piece clients (admin → piece)
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "paramState") {
				// Forward param state to admin clients (piece → admin)
				this.broadcast("admin", msg);
				return;
			}

			if (msg.type === "presetCommand") {
				// Forward preset commands to piece clients (admin → piece)
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "presetList") {
				// Forward preset list to admin clients (piece → admin)
				this.broadcast("admin", msg);
				return;
			}

			if (msg.type === "streamRequest") {
				// Forward stream request to piece clients (admin → piece)
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "streamStop") {
				// Forward stream stop to piece clients (admin → piece)
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "rtcOffer") {
				// Forward RTC offer to the specific admin (piece → admin)
				this.sendToAdmin(msg.adminId, msg);
				return;
			}

			if (msg.type === "rtcAnswer") {
				// Forward RTC answer to piece clients (admin → piece)
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "rtcIceCandidate") {
				// Forward ICE candidates to the other role
				if (client.role === "admin") {
					this.broadcast("piece", msg);
				} else {
					this.sendToAdmin(msg.adminId, msg);
				}
				return;
			}

			if (msg.type === "clipRequest") {
				// Forward clip request to piece clients (admin → piece)
				this.broadcast("piece", msg);
				return;
			}

			if (msg.type === "clipResponse") {
				// Forward clip response to the specific admin (piece → admin)
				this.sendToAdmin(msg.adminId, msg);
				return;
			}
		} catch (err) {
			console.error("[rubato-ws] Invalid message:", err);
		}
	}

	/** Send a message to all connected clients with the given role. */
	private broadcast(targetRole: ClientRole, msg: WsMessage): void {
		const payload = JSON.stringify(msg);
		for (const [id, c] of this.clients) {
			if (c.role === targetRole) {
				this.send(id, payload);
			}
		}
	}

	/** Send a message to a specific admin client by adminId. */
	private sendToAdmin(adminId: string, msg: WsMessage): void {
		const payload = JSON.stringify(msg);
		for (const [id, c] of this.clients) {
			if (c.role === "admin" && c.adminId === adminId) {
				this.send(id, payload);
				return;
			}
		}
	}
}
