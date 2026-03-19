# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

時痕 Rubato ("Time Scar") — a browser-based interactive new media installation. A camera captures viewers, segments their bodies, and deposits decaying visual trails over an ambient fog field on a wall-mounted TV. No server; everything runs client-side in Chrome.

## Commands

```bash
npm run dev        # Vite dev server with HMR (VITE_DEV_GUI=true)
npm run build      # Production build to dist/ (dev GUI excluded)
npm run check      # Run all validations: lint + typecheck + build
npx serve dist     # Serve production build locally
```

Lint/format with Biome:
```bash
npx @biomejs/biome check .        # Check lint + format
npx @biomejs/biome check --write . # Auto-fix
```

Visual verification (requires dev server running on :5173):
```bash
npm run screenshot  # Headless screenshot → e2e/screenshot.png
npm run interact    # Headed browser + Playwright Inspector for manual interaction
```

**After any visual change, you MUST run `npm run screenshot` and read `e2e/screenshot.png` to verify the result before reporting it done.** Playwright uses a fake camera feed (`--use-fake-device-for-media-stream`) so the full pipeline — camera, segmentation, overlay, GUI — is exercised in headless mode. If the dev server isn't running, start it first (`npm run dev &`, wait for ready, then screenshot). Do not rely on the user to verify what the tooling can verify.

## Stack

- **TypeScript** — no UI framework, single full-screen canvas
- **Vite** with `vite-plugin-glsl` for `.glsl` imports
- **Biome** for linting and formatting
- **WebGL** for trail buffer, fog, compositing (all via GLSL shaders)
- **MediaPipe Selfie Segmentation** for body detection
- **lil-gui** for dev parameter panel (toggle with `G` key, build-gated by `VITE_DEV_GUI`)

## Architecture

The rendering pipeline is a linear chain of stages:

**Camera Capture → Body Segmentation → Motion Detection → Trail Accumulation & Decay → Compositing → Display**

With **Fog Field Generation** feeding into Compositing as a parallel input.

Each pipeline stage is its own module with clear inputs (textures, parameters) and outputs (textures, framebuffers). WebGL utility code (program creation, shader compilation, texture management) is separated from pipeline logic.

### Key design decisions

- **Shaders are separate `.glsl` files**, not inline template literals. `vite-plugin-glsl` imports them as strings.
- **Camera runs at ~640x480** for segmentation performance; display canvas renders at TV native resolution (1080p+). These are independent.
- **Aspect ratio mismatch** between camera and TV is handled by cropping, not letterboxing or stretching.
- **State model** is explicit: idle (no person), active (person moving), still (person present but not moving), fading (person left, trails decaying).
- **Parameters** load from `params.json` at startup. Dev GUI reads/writes the same in-memory object. "Export JSON" button copies current state to clipboard for pasting back into `params.json`.

## Target Environment

- **Chrome only** — gallery installation, not a public website. No cross-browser concerns.
- Must handle: camera unavailable, MediaPipe load failure, WebGL context loss — all degrade gracefully to fog-only display.

## Git Workflow

Commit proactively after every logical unit of work — don't wait to be asked. A "logical unit" is any coherent change: scaffolding a module, wiring up a pipeline stage, fixing a bug, adding a shader. Small, frequent commits are better than large, infrequent ones. Write concise commit messages that explain *why*, not just *what*. Always run Biome before committing and fix any issues.

## Task Management

All task tracking lives in the Notion **Implementation Tasks** database (ID: `d83e6058-0c04-405e-af82-f6e8a706255a`). Do NOT use Claude's native Tasks system.

When told to "work through the tasks" or similar:

1. Fetch tasks from Notion. Pick the next "Not started" task (lowest Phase, then oldest).
2. Set it to "In progress" in Notion.
3. Do the work. Commit.
4. Run the sanity checklist before declaring done:
   - `npm run check` passes (lint + typecheck + build)
   - Dev server is running on :5173 (check and restart if needed)
   - For visual changes: `npm run screenshot`, then read `e2e/screenshot.png` to verify
   - Everything the user needs to evaluate should be ready — they should not have to ask.
5. Mark it "Done" in Notion. Fill in:
   - **Summary**: 1–3 sentences for a non-technical reader describing what changed from a user/viewer perspective. No jargon. Describe the observable result, not the implementation.
   - **Notes**: Technical details for dev reference.
6. If the next task has "Feedback Checkpoint" checked, stop and tell me — Sarah needs to review. Otherwise, loop back to step 1.
7. If no "Not started" tasks remain, tell me we're done.

If you find work that isn't in the task list, flag it to me — don't create tasks yourself.

## Notion Project Workspace (Source of Truth)

The Notion workspace **時痕 Rubato** is the authoritative source for what to build and how. Always consult it rather than guessing or inferring requirements from code alone.

- **MVP Technical Spec** — the definitive reference for pipeline architecture, technology choices, and design constraints. If the code diverges from the spec, the spec wins unless the user says otherwise.
- **Implementation Plan** — defines the phased build order and the reasoning behind it. Before starting a new phase or task, read the plan to understand sequencing, risk notes, and feedback checkpoints.
- **Implementation Tasks** (database) — tracks individual work items by phase. When unsure what to do next, query this database for the next unfinished task.
- **Project Brief** — context on the installation concept, physical setup, and artistic intent. Reference this when making decisions that affect the viewer experience.
- **Project Setup & Tooling** — stack choices, repo conventions, parameter tuning workflow, and deployment details.

**When in doubt about scope, priority, or approach — look in Notion first.** Use `/Notion:find rubato` or fetch pages directly via their IDs to get current guidance before proceeding.
