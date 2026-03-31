# ADR 001: Cloud Hosting Platform — Fly.io

## Status
Accepted (2026-03-31)

## Context
We need a cloud platform to host the full-featured public version of Rubato. The server is a Node.js app (Hono + ws) that serves pre-built static assets and provides a WebSocket relay for admin control. Requirements:

- **WebSocket support** — persistent connections for real-time admin control (start/stop, param tuning, presets)
- **Container support** — we have a Dockerfile with a two-stage build
- **Free/low-cost** — low-traffic art project, not a revenue-generating service
- **No cold starts** — the piece should load immediately, not spin up after 30s of inactivity
- **Persistent storage** — for preset persistence across deploys (can fall back to in-memory but shouldn't)

## Options Evaluated

| Platform | WebSocket | Free tier | Cold start | Storage | Verdict |
|---|---|---|---|---|---|
| Fly.io | Full | 3 free VMs + 1GB volume | None (always-on) | Persistent volumes | **Selected** |
| Railway | Full | $5/month credit | None | Volumes | Good but credits expire |
| Render | Full | Free tier available | ~30s on free tier | Paid plans only | Cold start kills UX |
| Cloudflare Workers | Durable Objects | Limited DO free tier | Near-zero | KV/D1/R2 | Over-engineered for this |
| Vercel | No persistent WS | Generous | Per-request | KV/Blob | Not viable |
| Netlify | No native WS | Generous | Per-request | None | Not viable |

## Decision
**Fly.io.** Best fit across all requirements:
- Always-on VM (no cold starts)
- Full WebSocket support (standard TCP, no platform workarounds)
- Persistent volumes for preset storage
- Free tier covers a single small app indefinitely
- Simplest deployment: `fly deploy` from our existing Dockerfile
- Custom domains supported on free tier

## Consequences
- Fly.io account required (free, no credit card for free tier)
- `fly.toml` config file added to repo
- Deploy workflow: `npm run build && fly deploy` (or CI integration later)
- Presets stored on a Fly.io volume mounted at `/data` (FilePresetStore pointed there)
- `TLS=false` in the Dockerfile since Fly.io terminates TLS at the edge
