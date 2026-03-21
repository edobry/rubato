/** Client roles */
export type ClientRole = "piece" | "admin";

/** Registration message — first thing a client sends after connecting */
export interface RegisterMessage {
	type: "register";
	role: ClientRole;
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
}

/** All possible messages */
export type WsMessage = RegisterMessage | CommandMessage | StateMessage;
