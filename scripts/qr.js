#!/usr/bin/env node
/**
 * Generate a QR code for the dev server's LAN address.
 * Usage: node scripts/qr.js [port]
 */
import { networkInterfaces } from "node:os";
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

const qr = await QRCode.toString(url, { type: "terminal", small: true });
console.log(qr);
console.log(`  ${url}\n`);
