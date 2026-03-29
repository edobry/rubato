import type {
	ClientRole,
	ClipRequestMessage,
	ClipResponseMessage,
	CommandMessage,
	ParamStateMessage,
	ParamUpdateMessage,
	PresetCommandMessage,
	PresetListMessage,
	RtcAnswerMessage,
	RtcIceCandidateMessage,
	RtcOfferMessage,
	StateMessage,
	StreamRequestMessage,
	StreamStopMessage,
	WsMessage,
} from "./protocol.js";

type CommandHandler = (msg: CommandMessage) => void;
type StateHandler = (msg: StateMessage) => void;
type ParamUpdateHandler = (msg: ParamUpdateMessage) => void;
type ParamStateHandler = (msg: ParamStateMessage) => void;
type RequestStateHandler = () => void;
type PresetListHandler = (msg: PresetListMessage) => void;
type PresetCommandHandler = (msg: PresetCommandMessage) => void;
type StreamRequestHandler = (msg: StreamRequestMessage) => void;
type StreamStopHandler = (msg: StreamStopMessage) => void;
type RtcOfferHandler = (msg: RtcOfferMessage) => void;
type RtcAnswerHandler = (msg: RtcAnswerMessage) => void;
type RtcIceCandidateHandler = (msg: RtcIceCandidateMessage) => void;
type ClipRequestHandler = (msg: ClipRequestMessage) => void;
type ClipResponseHandler = (msg: ClipResponseMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

const MAX_RECONNECT_DELAY = 10_000;

export class WsClient {
	private ws: WebSocket | null = null;
	private readonly role: ClientRole;
	private readonly url: string;

	/** Unique ID for admin clients, used for targeted WebRTC signaling */
	readonly adminId: string | undefined;

	private commandHandlers: CommandHandler[] = [];
	private stateHandlers: StateHandler[] = [];
	private paramUpdateHandlers: ParamUpdateHandler[] = [];
	private paramStateHandlers: ParamStateHandler[] = [];
	private requestStateHandlers: RequestStateHandler[] = [];
	private presetListHandlers: PresetListHandler[] = [];
	private presetCommandHandlers: PresetCommandHandler[] = [];
	private streamRequestHandlers: StreamRequestHandler[] = [];
	private streamStopHandlers: StreamStopHandler[] = [];
	private rtcOfferHandlers: RtcOfferHandler[] = [];
	private rtcAnswerHandlers: RtcAnswerHandler[] = [];
	private rtcIceCandidateHandlers: RtcIceCandidateHandler[] = [];
	private clipRequestHandlers: ClipRequestHandler[] = [];
	private clipResponseHandlers: ClipResponseHandler[] = [];
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
		if (role === "admin") {
			this.adminId = crypto.randomUUID();
		}
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

	/** Register handler for preset list messages (used by admin). */
	onPresetList(handler: PresetListHandler): void {
		this.presetListHandlers.push(handler);
	}

	/** Register handler for preset command messages (used by piece). */
	onPresetCommand(handler: PresetCommandHandler): void {
		this.presetCommandHandlers.push(handler);
	}

	/** Register handler for stream request messages (used by piece). */
	onStreamRequest(handler: StreamRequestHandler): void {
		this.streamRequestHandlers.push(handler);
	}

	/** Register handler for stream stop messages (used by piece). */
	onStreamStop(handler: StreamStopHandler): void {
		this.streamStopHandlers.push(handler);
	}

	/** Register handler for RTC offer messages (used by admin). */
	onRtcOffer(handler: RtcOfferHandler): void {
		this.rtcOfferHandlers.push(handler);
	}

	/** Register handler for RTC answer messages (used by piece). */
	onRtcAnswer(handler: RtcAnswerHandler): void {
		this.rtcAnswerHandlers.push(handler);
	}

	/** Register handler for RTC ICE candidate messages (used by both). */
	onRtcIceCandidate(handler: RtcIceCandidateHandler): void {
		this.rtcIceCandidateHandlers.push(handler);
	}

	/** Register handler for clip request messages (used by piece). */
	onClipRequest(handler: ClipRequestHandler): void {
		this.clipRequestHandlers.push(handler);
	}

	/** Register handler for clip response messages (used by admin). */
	onClipResponse(handler: ClipResponseHandler): void {
		this.clipResponseHandlers.push(handler);
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
			preset?: string;
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

	/** Send preset list to admin clients (used by piece). */
	sendPresetList(
		presets: Array<{ name: string; isBuiltIn: boolean }>,
		active: string,
	): void {
		this.send({ type: "presetList", presets, active });
	}

	/** Send a preset command to piece clients (used by admin). */
	sendPresetCommand(
		action: PresetCommandMessage["action"],
		name: string,
	): void {
		this.send({ type: "presetCommand", action, name });
	}

	/** Request the piece to start streaming via WebRTC (used by admin). */
	sendStreamRequest(): void {
		if (!this.adminId) return;
		this.send({ type: "streamRequest", adminId: this.adminId });
	}

	/** Tell the piece to stop streaming (used by admin). */
	sendStreamStop(): void {
		if (!this.adminId) return;
		this.send({ type: "streamStop", adminId: this.adminId });
	}

	/** Send a WebRTC offer to a specific admin (used by piece). */
	sendRtcOffer(adminId: string, offer: RTCSessionDescriptionInit): void {
		this.send({ type: "rtcOffer", adminId, offer });
	}

	/** Send a WebRTC answer to the piece (used by admin). */
	sendRtcAnswer(adminId: string, answer: RTCSessionDescriptionInit): void {
		this.send({ type: "rtcAnswer", adminId, answer });
	}

	/** Send an ICE candidate to the other peer (used by both). */
	sendRtcIceCandidate(adminId: string, candidate: RTCIceCandidateInit): void {
		this.send({ type: "rtcIceCandidate", adminId, candidate });
	}

	/** Request a clip from the piece ring buffer (used by admin). */
	sendClipRequest(duration: number): void {
		if (!this.adminId) return;
		this.send({ type: "clipRequest", adminId: this.adminId, duration });
	}

	/** Send clip response to a specific admin (used by piece). */
	sendClipResponse(
		adminId: string,
		status: ClipResponseMessage["status"],
		url?: string,
		error?: string,
	): void {
		const msg: ClipResponseMessage = { type: "clipResponse", adminId, status };
		if (url !== undefined) msg.url = url;
		if (error !== undefined) msg.error = error;
		this.send(msg);
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
			if (this.role === "admin" && this.adminId) {
				this.send({
					type: "register",
					role: this.role,
					adminId: this.adminId,
				});
			} else {
				this.send({ type: "register", role: this.role });
			}
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
				} else if (msg.type === "presetList") {
					for (const h of this.presetListHandlers) h(msg);
				} else if (msg.type === "presetCommand") {
					for (const h of this.presetCommandHandlers) h(msg);
				} else if (msg.type === "streamRequest") {
					for (const h of this.streamRequestHandlers) h(msg);
				} else if (msg.type === "streamStop") {
					for (const h of this.streamStopHandlers) h(msg);
				} else if (msg.type === "rtcOffer") {
					for (const h of this.rtcOfferHandlers) h(msg);
				} else if (msg.type === "rtcAnswer") {
					for (const h of this.rtcAnswerHandlers) h(msg);
				} else if (msg.type === "rtcIceCandidate") {
					for (const h of this.rtcIceCandidateHandlers) h(msg);
				} else if (msg.type === "clipRequest") {
					for (const h of this.clipRequestHandlers) h(msg);
				} else if (msg.type === "clipResponse") {
					for (const h of this.clipResponseHandlers) h(msg);
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
