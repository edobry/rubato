import { execSync } from "node:child_process";

export interface BuildInfo {
	hash: string;
	buildTime: string;
}

function getGitHash(): string {
	if (process.env.BUILD_HASH && process.env.BUILD_HASH !== "unknown") {
		return process.env.BUILD_HASH;
	}
	try {
		return execSync("git rev-parse --short HEAD", {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "unknown";
	}
}

/** Capture build info once at import time. */
export const buildInfo: BuildInfo = {
	hash: getGitHash(),
	buildTime: new Date().toISOString(),
};
