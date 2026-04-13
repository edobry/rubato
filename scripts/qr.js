#!/usr/bin/env node
/**
 * Generate a QR code for the dev server's LAN address.
 * Usage: node scripts/qr.js [port]
 */
import { networkInterfaces } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";
import QRCode from "qrcode";

const port = process.argv[2] || "5173";

const ip = Object.values(networkInterfaces())
	.flat()
	.find((i) => i?.family === "IPv4" && !i.internal)?.address;

if (!ip) {
	console.error("Could not detect LAN IP address");
	process.exit(1);
}

const url = `https://${ip}:${port}/`;

// Generate PNG and open it
const pngPath = join(process.cwd(), "qr.png");
await QRCode.toFile(pngPath, url, { width: 400 });
console.log(`\n  ${url}\n`);

// Open the image (macOS: open, Linux: xdg-open)
try {
	const cmd = process.platform === "darwin" ? "open" : "xdg-open";
	execSync(`${cmd} ${pngPath}`, { stdio: "ignore" });
} catch {
	console.log(`QR code saved to ${pngPath}`);
}
