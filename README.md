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
- **WebGL** for trail buffer, fog, fluid simulation, compositing (all via GLSL shaders)
- **MediaPipe Selfie Segmentation** for body detection
- **lil-gui** for dev parameter panel (toggle with `G` key, build-gated by `VITE_DEV_GUI`)

### Architecture

**Camera Capture -> Body Segmentation -> Motion Detection -> Trail Buffer -> Compositing -> Display**

- **Camera Capture** -- `getUserMedia` feed at tunable resolution (720p/480p/360p).
- **Body Segmentation** -- MediaPipe Selfie Segmentation producing raw + temporally-smoothed masks.
- **Motion Detection** -- frame-to-frame diff of segmentation masks, producing a per-pixel motion map that distinguishes moving vs. still regions.
- **Trail Buffer** -- WebGL framebuffer ping-pong; motion map drives deposition, configurable decay over time.
- **Fog Field** -- procedural simplex noise shader, the ambient idle-state visual when no one is present. Switchable between two modes via `fog.mode`:
  - **Classic** -- bright simplex noise FBM with silhouette carving and trail brightening.
  - **Shadow** -- dark ichor fluid driven by a GPU Stable Fluids simulation (see below).
- **Compositing** -- blends fog/shadow, silhouette, and trail buffer into the final output. Mode-aware fog interaction: classic mode carves through bright fog, shadow mode creates clearings in darkness.
- **Auto-tuner** -- hill-climbing optimizer that monitors FPS and adjusts model variant, camera resolution, and frame-skip count to maintain target framerate. Includes GPU->CPU delegate fallback on weak hardware.

#### Shadow Fog / Fluid Simulation

When `fog.mode` is set to `"shadow"`, the fog field is replaced by a GPU-accelerated 2D fluid simulation based on Jos Stam's [Stable Fluids](https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf) method. This makes the backdrop behave like viscous dark fluid that responds locally to the dancer's movements.

**Pipeline** (runs per frame at `shadow.resolution`, default 64×64):

```
Mask gradient → Force injection → Velocity advection → Divergence →
Pressure solve (Jacobi ×N) → Gradient subtraction → Density advection → Shadow render
```

1. **Force injection** (`fluid-force.frag`) -- Computes the segmentation mask gradient to find body boundary normals. Injects forces pointing outward from the dancer's silhouette into the velocity field. Motion energy amplifies force magnitude where the body is actively moving.
2. **Velocity advection** (`fluid-advect.frag`) -- Semi-Lagrangian self-advection of the velocity field. Each texel traces backward through the velocity to sample where its value came from, creating momentum and flow propagation.
3. **Pressure projection** (`fluid-divergence.frag`, `fluid-pressure.frag`, `fluid-gradient.frag`) -- Enforces incompressibility via the Helmholtz-Hodge decomposition: compute divergence, solve pressure via Jacobi iteration (default 20 iterations), then subtract the pressure gradient from velocity. This is what makes pushing one side cause bulging on the other.
4. **Density advection** -- The shadow density field (1.0 = full shadow, 0.0 = void) is advected through the velocity field. A source term blends density back toward `baseDensity` at `creepSpeed`, making shadow slowly fill back in after being displaced.
5. **Shadow render** (`shadow.frag`) -- Reads the fluid density and velocity textures. Density controls darkness, velocity distorts subtle noise sampling for fluid-like internal texture. Dithered highlights shimmer on dense flowing areas.

**Encoding:** All fields use RGBA8 textures (WebGL1 compatibility). Velocity and pressure use 0.5-centered signed encoding (0.5 = zero, 0.0 = -1.0, 1.0 = +1.0). Density uses direct [0,1] in the R channel.

**Key files:**

| File | Purpose |
|------|---------|
| `src/fluid.ts` | Fluid simulation orchestration, FBO management, shader pass execution |
| `src/shadow.ts` | Shadow fog renderer (density + velocity → dark ichor texture) |
| `src/shaders/fluid-advect.frag.glsl` | Semi-Lagrangian advection (velocity + density) |
| `src/shaders/fluid-force.frag.glsl` | Mask gradient → force injection |
| `src/shaders/fluid-divergence.frag.glsl` | Velocity divergence computation |
| `src/shaders/fluid-pressure.frag.glsl` | Jacobi pressure solve iteration |
| `src/shaders/fluid-gradient.frag.glsl` | Pressure gradient subtraction (projection) |
| `src/shaders/shadow.frag.glsl` | Dark ichor rendering with noise + highlights |
| `src/velocity.ts` | Grid-based velocity extraction (legacy, unused by fluid sim) |
| `src/displacement.ts` | Displacement field (legacy, replaced by fluid sim) |

**Tunable parameters** (all in `params.shadow.*`, exposed in dev GUI):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `forceScale` | 2.0 | How strongly the dancer's body pushes the fluid |
| `damping` | 0.985 | Velocity decay per frame (higher = more momentum) |
| `creepSpeed` | 0.015 | How fast shadow density fills back in |
| `pressureIterations` | 20 | Jacobi solver iterations (quality vs perf) |
| `resolution` | 64 | Fluid sim grid size (independent of display resolution) |
| `noiseAmount` | 0.15 | Internal texture variation (0 = smooth, 1 = noisy) |
| `baseDensity` | 0.95 | Shadow darkness at equilibrium |
| `baseColor` | `#0d0d0d` | Shadow RGB tint |

### Key design decisions

- **Shaders are separate `.glsl` files**, not inline template literals. `vite-plugin-glsl` imports them as strings.
- **Camera resolution is tunable** (720p/480p/360p) via GUI or `params.json`. Display canvas renders at TV native resolution (1080p+). These are independent.
- **Aspect ratio mismatch** between camera and TV is handled by cropping, not letterboxing or stretching.
- **State model** is explicit: idle (no person), active (person moving), still (person present but not moving), fading (person left, trails decaying).
- **Parameters** load from `params.json` at build time. The params object is wrapped in reactive Proxies -- changes propagate automatically to the GUI. "Export JSON" button copies current state to clipboard for pasting back into `params.json`.
- **Auto-tuner** monitors FPS and adjusts quality settings (frame skip, model, resolution) via hill-climbing with history tracking. GPU->CPU delegate fallback is automatic on devices with weak WebGL.
- **Shadow fog** uses a GPU Stable Fluids (Navier-Stokes) solver at low resolution (64×64) for viscous fluid dynamics. Forces are injected from the mask gradient at body boundaries, giving per-pixel local interaction. Switchable with the classic simplex noise fog via `fog.mode`.

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
