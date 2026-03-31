import { execSync } from "node:child_process";
import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import selfsigned from "selfsigned";
import { WebSocketServer, type WebSocket } from "ws";
import { Relay } from "../src/ws/relay.js";
import { FileClipStore } from "./clip-store.js";
import { FilePresetStore } from "./preset-store.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 5173;
const useTls = process.env.TLS !== "false";
const DIST_DIR = path.resolve(import.meta.dirname, "..", "dist");
const PRESETS_FILE = path.resolve(
	import.meta.dirname,
	"..",
	"custom-presets.json",
);
const CLIPS_DIR = path.resolve(import.meta.dirname, "..", ".clips");

// Build info — read git hash once at startup
let buildHash = "unknown";
try {
	buildHash = execSync("git rev-parse --short HEAD", {
		encoding: "utf-8",
	}).trim();
} catch {
	// Not a git repo or git not available — fine
}
const buildTime = new Date().toISOString();

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const presetStore = new FilePresetStore(PRESETS_FILE);
const clipStore = new FileClipStore(CLIPS_DIR);

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

// REST API ----------------------------------------------------------------

app.get("/api/build-info", (c) =>
	c.json({ hash: buildHash, buildTime }),
);

app.get("/api/presets", async (c) => {
	const presets = await presetStore.list();
	return c.json(presets);
});

app.post("/api/presets", async (c) => {
	const body = (await c.req.json()) as { name: string; preset: unknown };
	if (!body.name) return c.json({ error: "name required" }, 400);
	await presetStore.save(body.name, body.preset);
	return c.json({ ok: true });
});

app.delete("/api/presets/:name", async (c) => {
	await presetStore.delete(c.req.param("name"));
	return c.json({ ok: true });
});

// Clip upload (POST /clips) and download (GET /clips/:filename)
app.post("/clips", async (c) => {
	const data = Buffer.from(await c.req.arrayBuffer());
	const filename = `clip-${Date.now()}.webm`;
	const url = await clipStore.save(filename, data);
	return c.json({ url });
});

app.get("/clips/:filename", async (c) => {
	const filename = c.req.param("filename");
	const filepath = clipStore.filePath(filename);
	if (!fs.existsSync(filepath)) return c.notFound();
	const stream = fs.createReadStream(filepath);
	c.header("Content-Type", "video/webm");
	c.header("Content-Disposition", `attachment; filename="${filename}"`);
	return c.body(stream as unknown as ReadableStream);
});

// Static files from dist/ -------------------------------------------------
app.use(
	"/*",
	serveStatic({
		root: path.relative(process.cwd(), DIST_DIR),
	}),
);

// ---------------------------------------------------------------------------
// HTTPS cert generation
// ---------------------------------------------------------------------------

async function generateCert() {
	const attrs = [{ name: "commonName", value: "rubato-local" }];
	const notAfterDate = new Date();
	notAfterDate.setFullYear(notAfterDate.getFullYear() + 1);
	const pems = await selfsigned.generate(attrs, {
		notAfterDate,
		keySize: 2048,
		algorithm: "sha256",
	});
	return { key: pems.private, cert: pems.cert };
}

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });
const sockets = new Map<string, WebSocket>();
let nextId = 0;

const relay = new Relay((clientId, data) => {
	const ws = sockets.get(clientId);
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(data);
	}
});

wss.on("connection", (ws) => {
	const id = String(nextId++);
	sockets.set(id, ws);
	relay.connect(id);

	ws.on("message", (raw) => {
		relay.message(id, raw.toString());
	});

	ws.on("close", () => {
		relay.disconnect(id);
		sockets.delete(id);
	});
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
	const serverOptions = useTls
		? {
				createServer: createHttpsServer,
				serverOptions: await generateCert().then((c) => ({
					key: c.key,
					cert: c.cert,
				})),
			}
		: { createServer: createHttpServer };

	const protocol = useTls ? "https" : "http";

	const server = serve(
		{
			fetch: app.fetch,
			port: PORT,
			...serverOptions,
		},
		(info) => {
			console.log("[rubato] Production server started");
			console.log(`[rubato]   Port:  ${info.port}`);
			console.log(
				`[rubato]   TLS:   ${useTls ? "enabled (self-signed)" : "disabled"}`,
			);
			console.log(`[rubato]   Build: ${buildHash} (${buildTime})`);
			console.log(
				`[rubato]   Piece: ${protocol}://localhost:${info.port}/`,
			);
			console.log(
				`[rubato]   Admin: ${protocol}://localhost:${info.port}/admin/`,
			);
		},
	);

	// Handle WebSocket upgrade
	server.on("upgrade", (req, socket, head) => {
		if (req.url !== "/ws") {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	});

	// Graceful shutdown
	function shutdown() {
		console.log("\n[rubato] Shutting down...");
		wss.close();
		server.close(() => {
			console.log("[rubato] Server stopped.");
			process.exit(0);
		});
		setTimeout(() => process.exit(1), 5000);
	}

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main();
