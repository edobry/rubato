import type {
	ClientRole,
	CommandMessage,
	ParamStateMessage,
	ParamUpdateMessage,
	StateMessage,
	WsMessage,
} from "./protocol.js";

type CommandHandler = (msg: CommandMessage) => void;
type StateHandler = (msg: StateMessage) => void;
type ParamUpdateHandler = (msg: ParamUpdateMessage) => void;
type ParamStateHandler = (msg: ParamStateMessage) => void;
type RequestStateHandler = () => void;
type ConnectionHandler = (connected: boolean) => void;

const MAX_RECONNECT_DELAY = 10_000;

export class WsClient {
	private ws: WebSocket | null = null;
	private readonly role: ClientRole;
	private readonly url: string;

	private commandHandlers: CommandHandler[] = [];
	private stateHandlers: StateHandler[] = [];
	private paramUpdateHandlers: ParamUpdateHandler[] = [];
	private paramStateHandlers: ParamStateHandler[] = [];
	private requestStateHandlers: RequestStateHandler[] = [];
	private connectionHandlers: ConnectionHandler[] = [];

	private reconnectDelay = 1000;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private destroyed = false;

	private _connected = false;
	get connected(): boolean {
		return this._connected;
	}

	constructor(role: ClientRole) {
		this.role = role;
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		this.url = `${proto}//${location.host}/ws`;
		this.connect();
	}

	/** Register a handler for incoming command messages (used by piece). */
	onCommand(handler: CommandHandler): void {
		this.commandHandlers.push(handler);
	}

	/** Register a handler for incoming state messages (used by admin). */
	onState(handler: StateHandler): void {
		this.stateHandlers.push(handler);
	}

	/** Register handler for param update messages (used by piece). */
	onParamUpdate(handler: ParamUpdateHandler): void {
		this.paramUpdateHandlers.push(handler);
	}

	/** Register handler for param state messages (used by admin). */
	onParamState(handler: ParamStateHandler): void {
		this.paramStateHandlers.push(handler);
	}

	/** Register handler for state request messages (used by piece). */
	onRequestState(handler: RequestStateHandler): void {
		this.requestStateHandlers.push(handler);
	}

	/** Register a handler for connection status changes. */
	onConnectionChange(handler: ConnectionHandler): void {
		this.connectionHandlers.push(handler);
	}

	/** Send a command to piece clients (used by admin). */
	sendCommand(command: CommandMessage["command"]): void {
		this.send({ type: "command", command });
	}

	/** Send a state update to admin clients (used by piece). */
	sendState(
		state: StateMessage["state"],
		extra?: {
			fps?: number;
			error?: string;
			guiVisible?: boolean;
			hudVisible?: boolean;
		},
	): void {
		this.send({ type: "state", state, ...extra });
	}

	/** Send a single param update (used by admin). */
	sendParamUpdate(
		section: string,
		key: string,
		value: number | string | boolean,
	): void {
		this.send({ type: "paramUpdate", section, key, value });
	}

	/** Send full param state snapshot (used by piece). */
	sendParamState(
		params: Record<string, Record<string, number | string | boolean>>,
	): void {
		this.send({ type: "paramState", params });
	}

	/** Tear down the client and stop reconnecting. */
	destroy(): void {
		this.destroyed = true;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.ws?.close();
		this.ws = null;
		this.setConnected(false);
	}

	// -- internals --

	private connect(): void {
		if (this.destroyed) return;

		const ws = new WebSocket(this.url);
		this.ws = ws;

		ws.addEventListener("open", () => {
			this.reconnectDelay = 1000;
			this.setConnected(true);

			// Register our role with the server
			this.send({ type: "register", role: this.role });
		});

		ws.addEventListener("message", (ev) => {
			try {
				const msg: WsMessage = JSON.parse(
					typeof ev.data === "string" ? ev.data : "",
				);

				if (msg.type === "command") {
					for (const h of this.commandHandlers) h(msg);
				} else if (msg.type === "state") {
					for (const h of this.stateHandlers) h(msg);
				} else if (msg.type === "paramUpdate") {
					for (const h of this.paramUpdateHandlers) h(msg);
				} else if (msg.type === "paramState") {
					for (const h of this.paramStateHandlers) h(msg);
				} else if (msg.type === "requestState") {
					for (const h of this.requestStateHandlers) h();
				}
			} catch {
				// Ignore malformed messages
			}
		});

		ws.addEventListener("close", () => {
			this.setConnected(false);
			this.scheduleReconnect();
		});

		ws.addEventListener("error", () => {
			// The close event will fire after this; reconnect handled there
		});
	}

	private send(msg: WsMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	private setConnected(value: boolean): void {
		if (this._connected === value) return;
		this._connected = value;
		for (const h of this.connectionHandlers) h(value);
	}

	private scheduleReconnect(): void {
		if (this.destroyed) return;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelay);

		// Exponential backoff capped at MAX_RECONNECT_DELAY
		this.reconnectDelay = Math.min(
			this.reconnectDelay * 2,
			MAX_RECONNECT_DELAY,
		);
	}
}
