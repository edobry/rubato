precision highp float;

/*
 * 時痕 Rubato — Trail Fragment Shader (Imprint Density System)
 * ============================================================
 *
 * This shader implements the core artistic logic of the Rubato installation:
 * the body is never displayed, but the *memory of its movement* lingers as
 * an impressionistic residue in fog. Standing still produces nothing visible.
 * Moving through space leaves a trace — not of form, but of force.
 *
 * The conceptual framework draws from butoh (舞踏, the dance of darkness),
 * where the body is a vessel for internal forces rather than a shape to be
 * displayed, and from tai chi quan's model of qi cultivation and flow.
 *
 * THREE-PHASE IMPRINT DENSITY MODEL
 * ----------------------------------
 *
 * Phase 1 — Cultivation (qi gathering)
 *   Stillness within the body silhouette accumulates invisible energy in the
 *   R channel. Nothing is rendered; the viewer sees only fog. Like qi pooling
 *   in a practitioner's dantian before it flows, the body is a vessel slowly
 *   filling with potential. The longer you stand still, the more energy gathers.
 *
 * Phase 2 — Channeling (meridian flow)
 *   When the body moves, accumulated cultivation drains from the R channel and
 *   releases into the G channel as visible density. The trace doesn't outline
 *   the body — it marks where motion *occurred*, elongating through the space
 *   traversed. Longer stillness produces more dramatic release; faster motion
 *   produces more intense traces. This models qi flowing through meridians:
 *   energy channeled along paths of movement.
 *
 * Phase 3 — Disintegration (memory corruption)
 *   Visible density does not fade uniformly. Instead, simplex noise modulates
 *   the decay rate per-pixel, creating non-uniform fragmentation — traces
 *   break apart unevenly like misfiring neurons or corrupting memory, then
 *   dissolve back into the fog. This avoids the artificial look of linear fade.
 *
 * DATA ENCODING
 * -------------
 *   Trail buffer:  R = cultivation energy (invisible), G = visible density
 *   Motion texture: R = magnitude, G = dx direction, B = dy direction
 *   Mask texture:   R = body silhouette (1 = inside body)
 */

varying vec2 v_uv;

uniform sampler2D u_prevTrail;  // previous frame's trail buffer (R=cultivation, G=density)
uniform sampler2D u_motion;     // motion map (R=magnitude, GB=direction when anisotropic)
uniform sampler2D u_mask;       // segmentation mask — body silhouette for cultivation bounds

uniform float u_deposition;     // (legacy mode) how much motion adds to trail
uniform float u_decay;          // base multiplicative decay per frame

// Imprint density system uniforms
uniform float u_mode;             // 0 = legacy trail, 1 = imprint density system
uniform float u_cultivationRate;  // qi gathering speed — how fast energy builds during stillness
uniform float u_channelStrength;  // meridian flow intensity — how much energy releases on motion
uniform float u_drainRate;        // vessel emptying — how fast cultivation drains during motion
uniform float u_diffusionRate;    // spatial bleed — how much density spreads to neighbors
uniform float u_decayVariance;    // disintegration roughness — noise modulation on decay
uniform float u_disintSpeed;      // corruption drift — how fast the disintegration pattern shifts
uniform float u_time;             // clock for noise animation
uniform vec2 u_texelSize;         // 1/width, 1/height for neighbor sampling
uniform float u_diffusionMode;    // 0 = isotropic (uniform spread), 1 = anisotropic (elongated along motion, like meridian traces)

// Simplex noise (Ashima Arts / Ian McEwan) — same as fog shader
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
    const vec4 C = vec4(
        0.211324865405187,   // (3.0 - sqrt(3.0)) / 6.0
        0.366025403784439,   // 0.5 * (sqrt(3.0) - 1.0)
        -0.577350269189626,  // -1.0 + 2.0 * C.x
        0.024390243902439    // 1.0 / 41.0
    );

    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);

    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);

    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;

    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;

    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;

    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;

    return 130.0 * dot(m, g);
}

void main() {
    float prev = texture2D(u_prevTrail, v_uv).r;
    float motion = texture2D(u_motion, v_uv).r;

    // Legacy trail mode (u_mode == 0)
    if (u_mode < 0.5) {
        float trail = min(1.0, prev + motion * u_deposition);
        trail *= u_decay;
        trail = trail < 0.005 ? 0.0 : trail;
        gl_FragColor = vec4(trail, trail, trail, 1.0);
        return;
    }

    // === Imprint density system (u_mode == 1) ===
    float prevCultivation = texture2D(u_prevTrail, v_uv).r;  // invisible energy
    float prevDensity = texture2D(u_prevTrail, v_uv).g;      // visible trace
    float mask = texture2D(u_mask, v_uv).r;

    // --- Phase 1: Cultivation (qi gathering) ---
    // Energy accumulates wherever the body IS present — the entire
    // silhouette interior, not just still regions. The body is a vessel
    // filling with potential. isPresent is binary: inside body or not.
    float isPresent = step(0.1, mask);
    float newCultivation = prevCultivation + isPresent * u_cultivationRate;

    // --- Phase 2a: Direct motion deposition ---
    // Motion deposits density only where the body has DEPARTED (not arrived),
    // preventing bright edges from outlining the current body position.
    float newDensity = prevDensity + motion * u_deposition * (1.0 - isPresent);

    // --- Phase 2b: Cultivation leakage ---
    // Cultivation continuously bleeds into density while body is present,
    // filling the body interior with a visible glow that builds during stillness.
    newDensity += prevCultivation * isPresent * u_cultivationRate;

    // --- Phase 2c: Channeling (departure-based release) ---
    // When the body moves away, cultivation converts to visible density.
    float departure = (1.0 - isPresent) * step(0.005, prevCultivation);
    float retainFactor = mix(1.0, u_drainRate, departure);
    float drained = prevCultivation * (1.0 - retainFactor);
    newDensity += drained * u_channelStrength;

    // Zero out cultivation where body departed (energy was converted)
    newCultivation *= retainFactor;

    // --- Phase 3: Disintegration (memory corruption) ---
    // Traces don't fade uniformly — they fragment and break apart.
    // Simplex noise creates spatially varying decay: some pixels decay
    // faster, others linger, producing an organic dissolution that
    // resembles corrupting memory or misfiring neurons.
    float noiseVal = snoise(v_uv * 8.0 + u_time * u_disintSpeed);
    float localDecay = u_decay * (1.0 + noiseVal * u_decayVariance);
    newDensity *= clamp(localDecay, 0.0, 1.0);

    // Spatial diffusion — density bleeds into neighboring pixels.
    // This softens hard edges and lets traces spread organically.
    if (u_diffusionMode > 0.5) {
        // Anisotropic diffusion: density spreads preferentially along the
        // direction of motion, creating elongated "meridian" traces rather
        // than uniform circular blobs. Along-motion neighbors get 70% weight,
        // perpendicular neighbors get 30%, so traces stretch in the direction
        // the body traveled.
        vec2 motionDir = texture2D(u_motion, v_uv).gb * 2.0 - 1.0;
        float dirLen = length(motionDir);

        if (dirLen > 0.01) {
            vec2 dir = normalize(motionDir);
            vec2 perp = vec2(-dir.y, dir.x);
            vec2 stepAlong = dir * u_texelSize;
            vec2 stepPerp = perp * u_texelSize;

            float along1 = texture2D(u_prevTrail, v_uv + stepAlong).g;
            float along2 = texture2D(u_prevTrail, v_uv - stepAlong).g;
            float perp1 = texture2D(u_prevTrail, v_uv + stepPerp).g;
            float perp2 = texture2D(u_prevTrail, v_uv - stepPerp).g;

            float neighbors = (along1 + along2) * 0.35 + (perp1 + perp2) * 0.15;
            newDensity = mix(newDensity, neighbors, u_diffusionRate);
        } else {
            float neighbors = (
                texture2D(u_prevTrail, v_uv + vec2(u_texelSize.x, 0.0)).g +
                texture2D(u_prevTrail, v_uv - vec2(u_texelSize.x, 0.0)).g +
                texture2D(u_prevTrail, v_uv + vec2(0.0, u_texelSize.y)).g +
                texture2D(u_prevTrail, v_uv - vec2(0.0, u_texelSize.y)).g
            ) * 0.25;
            newDensity = mix(newDensity, neighbors, u_diffusionRate);
        }
    } else {
        // Isotropic diffusion: equal spread in all directions (uniform blur)
        float neighbors = (
            texture2D(u_prevTrail, v_uv + vec2(u_texelSize.x, 0.0)).g +
            texture2D(u_prevTrail, v_uv - vec2(u_texelSize.x, 0.0)).g +
            texture2D(u_prevTrail, v_uv + vec2(0.0, u_texelSize.y)).g +
            texture2D(u_prevTrail, v_uv - vec2(0.0, u_texelSize.y)).g
        ) * 0.25;
        newDensity = mix(newDensity, neighbors, u_diffusionRate);
    }

    // Clamp
    newCultivation = clamp(newCultivation, 0.0, 1.0);
    newDensity = clamp(newDensity, 0.0, 1.0);

    // Clean up near-zero values to avoid accumulating GPU rounding noise
    if (newCultivation < 0.005) newCultivation = 0.0;
    if (newDensity < 0.005) newDensity = 0.0;

    // Output: R = cultivation (invisible energy), G = visible density, BA unused
    gl_FragColor = vec4(newCultivation, newDensity, 0.0, 1.0);
}
