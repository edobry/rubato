# 時痕 Rubato

*Time Scar*

A screen hangs on a gallery wall. When you step in front of it, your silhouette appears -- not as a mirror image, but as a ghostly imprint that lingers after you move. Walk, gesture, be still: every motion leaves a trace that slowly dissolves into drifting fog. When no one is present, only the fog remains.

The piece lives in the space between presence and absence -- the marks we leave simply by being somewhere, and how quickly they fade.

### How it works

A camera watches the space in front of the screen. It detects your body in real time, and your movement deposits dark trails onto the display. The trails decay over time, sinking back into an ambient fog field that fills the screen when the space is empty. Everything runs locally in the browser -- no server, no data leaves the room.

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

#### Current pipeline (Phases 1-3)

**Camera Capture -> Body Segmentation -> Motion Detection -> Overlay Visualization -> Display**

- **Camera Capture** -- `getUserMedia` feed at tunable resolution (720p/480p/360p).
- **Body Segmentation** -- MediaPipe Selfie Segmentation producing raw + temporally-smoothed masks.
- **Motion Detection** (in progress) -- frame-to-frame diff of raw segmentation masks, producing a per-pixel motion map that distinguishes moving vs. still regions. This motion map will drive trail deposition in Phase 4.
- **Overlay Visualization** -- renders the segmentation mask in multiple selectable color modes.
- **FPS Counter** -- live counter with timeseries sparkline graph.

**Auto-tuner** is a cross-cutting concern: a hill-climbing optimizer that monitors FPS and adjusts model variant, camera resolution, and frame-skip count to maintain target framerate. Includes GPU->CPU delegate fallback on weak WebGL hardware.

#### Planned pipeline (Phases 4-7)

Phases 4-7 extend the pipeline to the full installation:

**... -> Motion Map -> Trail Buffer (accumulate & decay) -> Compositing -> Display**

With **Fog Field** (procedural noise shader) feeding into Compositing as a parallel input.

- **Phase 4 -- Trail Accumulation:** WebGL framebuffer trail buffer; motion map drives deposition, configurable decay.
- **Phase 5 -- Fog Field:** Procedural simplex/Perlin noise shader as the ambient idle-state visual.
- **Phase 6 -- Compositing:** Blend fog + silhouette + trail buffer; parameter presets for A/B creative iteration.
- **Phase 7 -- Polish & Deployment:** Kiosk mode, error recovery, stress testing, final parameter lock with Sarah.

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
