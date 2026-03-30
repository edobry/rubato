# Production Server Architecture — Design Document

## Project Context

**Rubato** (時痕, "Time Scar") is an interactive new media art installation. A camera watches viewers in front of a wall-mounted screen; their body movements leave persistent visual traces in a procedural fog field. Everything runs client-side in Chrome — MediaPipe body segmentation, WebGL rendering, GLSL shaders. The server's job is limited to serving static files and providing a WebSocket control channel.

The piece is currently deployed in a gallery on a Mac Mini running a **Vite dev server in production** (`vite --mode live` with HMR disabled). A mobile admin interface allows remote control (start/stop, parameter tuning, preset management) over WebSocket.

## Problem

We need a production server that works for:

1. **Gallery installation** — Mac Mini running Chrome in kiosk mode, server on localhost. Must work offline (no internet dependency).
2. **Home/event setup** — Server on a laptop, piece open in the laptop browser, HDMI to TV for display. Phone connects to the same URL for admin control.
3. **Cloud-hosted version** — Full-featured public URL anyone can visit (uses their own camera). Hosted on Fly.io or similar.

All three should be full-featured: admin WebSocket, preset management, parameter tuning.

### Runtime model

The piece always runs on the machine with the camera. The TV/screen is just a display output (HDMI, AirPlay, Chromecast). The admin phone connects to the same server for control. This means:

- The piece browser is always on localhost or the hosted URL — never a LAN client needing its own camera
- HTTPS is only needed for cloud (platform TLS) and LAN admin access (phone connecting to laptop IP)
- `http://localhost` is a secure context in Chrome — no TLS needed for the piece itself on local deployments

## Current Architecture

```
Browser (Chrome)
  └── index.html + JS bundle (TypeScript, GLSL shaders)
        ├── Camera → MediaPipe segmentation → WebGL rendering (all client-side)
        └── WebSocket client (admin control channel)

Vite Dev Server (serve:live mode)
  ├── On-demand TypeScript/GLSL transformation (no pre-build)
  ├── WebSocket relay plugin (routes messages between piece + admin clients)
  ├── Preset sync API (GET/POST/DELETE /api/presets → custom-presets.json)
  ├── Version check API (GET /api/version → compares git hashes)
  ├── Clip storage (POST/GET /clips → filesystem)
  └── Static file serving for MediaPipe WASM assets
```

### Why replace Vite

- Transforms source files on every request (wasteful)
- Injects HMR client code even when disabled
- Can't be deployed to a cloud platform
- A dev tool doing a production job — fragile foundation for multiple deployment targets

## Proposed Architecture

### Core principle: one protocol, pluggable backends

The server is a thin composition root wiring together capability interfaces. Each deployment target provides concrete implementations.

```
server/
  index.ts          — composition root: HTTP + WebSocket + backend wiring
  preset-store.ts   — PresetStore interface + filesystem implementation
  clip-store.ts     — ClipStore interface + filesystem implementation
  build-info.ts     — BuildInfoProvider (static metadata baked at build time)
```

### Capability interfaces

```typescript
interface PresetStore {
  list(): Promise<Record<string, Preset>>;
  get(name: string): Promise<Preset | null>;
  save(name: string, preset: Preset): Promise<void>;
  delete(name: string): Promise<void>;
}

interface ClipStore {
  save(id: string, data: Buffer): Promise<string>;  // returns URL
  get(id: string): Promise<Buffer | null>;
  list(): Promise<string[]>;
}

interface BuildInfoProvider {
  getInfo(): { hash: string; buildTime: string };
}
```

### Implementations per target

| Capability | Gallery / Home | Cloud |
|-----------|---------------|-------|
| `PresetStore` | Filesystem (`custom-presets.json`) | Filesystem (Fly.io volume) or in-memory |
| `ClipStore` | Filesystem (`clips/` directory) | Filesystem (Fly.io volume) or object storage |
| `BuildInfoProvider` | Static build metadata | Static build metadata |
| TLS | `http://localhost` for piece, self-signed for LAN admin | Platform TLS |

All implementations are provided via environment config at startup — not conditional code paths.

### State model

**Build info** is static metadata baked at build time (`__BUILD_HASH__`, build timestamp). The server exposes `GET /api/build-info` returning this. The client polls it and shows "new version available, reload" when the server's hash differs from the hash the client loaded with. No git, no remote comparison — just "is my code stale relative to the server."

**Presets** are durably persisted via `PresetStore` and served over the REST API. The server is authoritative for the preset catalog. Presets must survive server restarts. Individual clients may cache in localStorage but the server is the source of truth for what presets exist and their contents.

**Clips** are ephemeral. The `ClipStore` holds captured clips long enough for the admin to download them, but durable storage is not required. Clips may be lost on server restart — this is acceptable.

**Live parameters** are runtime state propagated via WebSocket. The piece is authoritative — when an admin changes a param, it sends a `paramUpdate` to the piece, the piece applies it and echoes the full state back to all admins. No server persistence of live params (they're ephemeral per-session, restored from presets on reload).

**Reconnect / state sync:** When a new admin client connects, it sends a `requestState` message. The piece responds with its current state (running/lobby, active preset, all live param values). This ensures late-joining admins see the current state without requiring server-side state caching. If the piece reloads or disconnects, admin clients show "disconnected" state and re-sync when the piece reconnects.

### WebSocket relay (already built)

```typescript
// src/ws/relay.ts — pure, platform-agnostic, zero dependencies
export class Relay {
  constructor(private send: (clientId: string, data: string) => void) {}
  connect(id: string): void { ... }
  message(id: string, raw: string): void { /* parse JSON, route by role */ }
  disconnect(id: string): void { ... }
}
```

Routes 14 message types between piece clients and admin clients. Currently used by the Vite plugin adapter; the production server uses the same module with a thin adapter (~20 lines).

### Build step

`npm run build` produces `dist/` with pre-built static assets (HTML, JS bundles, GLSL compiled into JS, MediaPipe WASM files). Standard Vite production build — already works today. A `__BUILD_HASH__` is injected at build time via Vite's `define` config.

### Deployment targets

| Target | Run command | Piece URL | Admin URL | Notes |
|--------|-----------|-----------|-----------|-------|
| Gallery (Mac Mini) | `node server/` on Mac Mini | `http://localhost:3000` | `https://<tailscale>:3000/admin/` | launchd auto-start, Chrome kiosk |
| Home/event (laptop) | `node server/` on laptop | `http://localhost:3000` | `https://<laptop-ip>:3000/admin/` | HDMI to TV, phone admin over LAN |
| Cloud (Fly.io) | `fly deploy` | `https://rubato.fly.dev` | `https://rubato.fly.dev/admin/` | Platform TLS, persistent volume |

### Deployment workflow

**Gallery/local:**
```bash
npm run build && npm run start    # build + run locally
# or: npm run deploy              # build, push to Mac Mini, restart
```

**Cloud:**
```bash
npm run build
fly deploy
```

## Design Decisions

### Framework: Hono
Hono over Fastify/Express for lighter weight (~14kb), cleaner TypeScript types, and multi-runtime support (Node.js, Cloudflare Workers, Deno, Bun). For a ~150 line server with 3 JSON endpoints and a WebSocket upgrade, the full feature set of Fastify/Express is unnecessary. Not a critical decision at this scale.

### HTTPS for LAN admin
The piece runs on `http://localhost` (secure context in Chrome, no TLS needed). The phone admin connects over LAN and needs HTTPS for WebSocket (`wss://`). The server generates a self-signed certificate at startup (same approach as Vite's `@vitejs/plugin-basic-ssl`). The phone shows a one-time cert warning on first connect — acceptable for this use case. Cloud deployments use platform-provided TLS.

### Vite remains for development
`npm run dev` continues using Vite with HMR. The Vite WS plugin and the production server both use the same `relay.ts` module. Development workflow is unchanged.

## What Changes in the Codebase

| File | Change |
|------|--------|
| `server/index.ts` | New — production server composition root |
| `server/preset-store.ts` | New — PresetStore interface + FS implementation |
| `server/clip-store.ts` | New — ClipStore interface + FS implementation |
| `server/build-info.ts` | New — build metadata provider |
| `src/ws/relay.ts` | Already extracted, no change |
| `src/ws/plugin.ts` | No change — Vite dev adapter stays |
| `vite.config.ts` | Inject `__BUILD_HASH__` at build time |
| `scripts/deploy.sh` | Updated — builds then deploys artifacts |
| `package.json` | New `start` script |

## Out of Scope

- **PartyKit / serverless platforms** — evaluated, rejected. Adds complexity for no benefit at this scale.
- **Docker** — not needed for current targets. Can be added trivially later (the server is a single `node` process).
- **Authentication** — local/LAN deployments are trusted environments. Cloud admin is accepted as low-risk given the low traffic and non-sensitive nature of the controls (worst case: someone changes visual parameters). A lightweight admin token can be added later if needed, but is not required for v1.
- **Database** — no persistent state beyond presets (flat JSON) and clips (filesystem).
