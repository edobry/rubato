/** Client roles */
export type ClientRole = "piece" | "admin";

/** Registration message — first thing a client sends after connecting */
export interface RegisterMessage {
	type: "register";
	role: ClientRole;
	/** Unique ID for admin clients, used for targeted WebRTC signaling */
	adminId?: string;
}

/** Commands from admin → piece */
export interface CommandMessage {
	type: "command";
	command: "run" | "stop" | "reload" | "toggleGui" | "toggleHud";
}

/** State updates from piece → all admins */
export interface StateMessage {
	type: "state";
	state: "lobby" | "running" | "error";
	fps?: number;
	error?: string;
	guiVisible?: boolean;
	hudVisible?: boolean;
	preset?: string;
}

/** Single param change from admin → piece */
export interface ParamUpdateMessage {
	type: "paramUpdate";
	section: string;
	key: string;
	value: number | string | boolean;
}

/** Full param state snapshot from piece → admin */
export interface ParamStateMessage {
	type: "paramState";
	params: Record<string, Record<string, number | string | boolean>>;
}

/** Request from server to piece to resend current state */
export interface RequestStateMessage {
	type: "requestState";
}

/** Preset list from piece → admin */
export interface PresetListMessage {
	type: "presetList";
	presets: Array<{ name: string; isBuiltIn: boolean }>;
	active: string;
}

/** Preset command from admin → piece */
export interface PresetCommandMessage {
	type: "presetCommand";
	action: "apply" | "save" | "delete";
	name: string;
}

/** Admin requests the piece to start streaming via WebRTC */
export interface StreamRequestMessage {
	type: "streamRequest";
	/** Unique ID for this admin's stream session */
	adminId: string;
}

/** Admin tells piece to stop streaming */
export interface StreamStopMessage {
	type: "streamStop";
	adminId: string;
}

/** WebRTC offer from piece → specific admin */
export interface RtcOfferMessage {
	type: "rtcOffer";
	adminId: string;
	offer: RTCSessionDescriptionInit;
}

/** WebRTC answer from admin → piece */
export interface RtcAnswerMessage {
	type: "rtcAnswer";
	adminId: string;
	answer: RTCSessionDescriptionInit;
}

/** ICE candidate exchange (bidirectional) */
export interface RtcIceCandidateMessage {
	type: "rtcIceCandidate";
	adminId: string;
	candidate: RTCIceCandidateInit;
}

/** All possible messages */
export type WsMessage =
	| RegisterMessage
	| CommandMessage
	| StateMessage
	| ParamUpdateMessage
	| ParamStateMessage
	| RequestStateMessage
	| PresetListMessage
	| PresetCommandMessage
	| StreamRequestMessage
	| StreamStopMessage
	| RtcOfferMessage
	| RtcAnswerMessage
	| RtcIceCandidateMessage;
