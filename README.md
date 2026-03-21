# 時痕 Rubato

*Time Scar*

A screen hangs on a gallery wall. Drifting fog fills its surface. When you step in front of it, nothing visible happens -- no mirror, no outline, no silhouette. But when you *move*, the space you moved through retains a trace. Not of your body, but of the movement's energy -- an impressionistic residue of force that lingers where motion occurred.

Stand still, and energy slowly cultivates within your form -- invisible, gathering, like qi pooling before it flows. Begin to move, and the accumulated density channels along your path, draining from where you lingered and elongating through the space you traverse. The longer you were still, the more dramatic the release. The faster you move, the more intensely the trace blazes.

Over time, these traces don't simply fade -- they disintegrate. The memory of movement corrupts and fragments, like misfiring neurons, breaking apart unevenly before dissolving back into the fog. The viewer can read the history: where the dancer lingered (dense pools), how they moved (elongated channels), how long ago (degree of disintegration).

The piece draws from butoh (舞踏, the dance of darkness) -- the body as a vessel for internal forces rather than a form to be displayed -- and from tai chi quan's concepts of qi cultivation and meridian channeling. Sarah Lin performs a butoh piece during the opening, her body becoming the first instrument to inscribe the system.

### How it works

A camera watches the space in front of the screen. It detects the human body in real time, but the body itself is never shown. Instead, the system tracks *motion* -- where the body moves and how intensely -- and deposits density into a persistent field that accumulates, channels, and slowly disintegrates back into an ambient procedural fog. Everything runs locally in the browser -- no server, no data leaves the room.

---

## Development

### Stack

- **TypeScript** -- no UI framework, single full-screen canvas
- **Vite** with `vite-plugin-glsl` for `.glsl` imports
- **Biome** for linting and formatting
- **WebGL** for trail buffer, fog, compositing (all via GLSL shaders)
- **MediaPipe Selfie Segmentation** for body detection
- **lil-gui** for dev parameter panel (toggle with `G` key, build-gated by `VITE_DEV_GUI`)

### Architecture

**Camera Capture -> Body Segmentation -> Motion Detection -> Trail Buffer -> Compositing -> Display**

- **Camera Capture** -- `getUserMedia` feed at tunable resolution (720p/480p/360p).
- **Body Segmentation** -- MediaPipe Selfie Segmentation producing raw + temporally-smoothed masks.
- **Motion Detection** -- frame-to-frame diff of segmentation masks, producing a per-pixel motion map that distinguishes moving vs. still regions.
- **Trail Buffer** -- WebGL framebuffer ping-pong; motion map drives deposition, configurable decay over time.
- **Fog Field** -- procedural simplex noise shader, the ambient idle-state visual when no one is present.
- **Compositing** -- blends fog, silhouette, and trail buffer into the final output.
- **Auto-tuner** -- hill-climbing optimizer that monitors FPS and adjusts model variant, camera resolution, and frame-skip count to maintain target framerate. Includes GPU->CPU delegate fallback on weak hardware.

### Key design decisions

- **Shaders are separate `.glsl` files**, not inline template literals. `vite-plugin-glsl` imports them as strings.
- **Camera resolution is tunable** (720p/480p/360p) via GUI or `params.json`. Display canvas renders at TV native resolution (1080p+). These are independent.
- **Aspect ratio mismatch** between camera and TV is handled by cropping, not letterboxing or stretching.
- **State model** is explicit: idle (no person), active (person moving), still (person present but not moving), fading (person left, trails decaying).
- **Parameters** load from `params.json` at build time. The params object is wrapped in reactive Proxies -- changes propagate automatically to the GUI. "Export JSON" button copies current state to clipboard for pasting back into `params.json`.
- **Auto-tuner** monitors FPS and adjusts quality settings (frame skip, model, resolution) via hill-climbing with history tracking. GPU->CPU delegate fallback is automatic on devices with weak WebGL.

### Target Environment

- **Chrome only** -- gallery installation, not a public website. No cross-browser concerns.
- Must handle: camera unavailable, MediaPipe load failure, WebGL context loss -- all degrade gracefully to fog-only display.

### Commands

```bash
# Development
npm run dev          # Vite dev server with HMR (VITE_DEV_GUI=true)
npm run build        # Production build to dist/ (dev GUI excluded)
npm run check        # Run all validations: lint + typecheck + build
npx serve dist       # Serve production build locally

# Lint/format (Biome)
npx @biomejs/biome check .          # Check lint + format
npx @biomejs/biome check --write .  # Auto-fix

# Visual verification (requires dev server on :5173)
npm run screenshot   # Headless screenshot -> e2e/screenshot.png
npm run interact     # Headed browser + Playwright Inspector for manual interaction
```
