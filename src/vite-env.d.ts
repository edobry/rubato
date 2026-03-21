/// <reference types="vite/client" />

declare const __TAILSCALE_HOST__: string | null;
declare const __GIT_HASH__: string;

declare module "*.glsl" {
	const value: string;
	export default value;
}
