precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_prevTrail;  // previous frame's trail buffer
uniform sampler2D u_motion;     // current frame's motion map
uniform sampler2D u_mask;       // segmentation mask (imprint mode)

uniform float u_deposition;     // how much motion adds to trail
uniform float u_decay;          // multiplicative decay per frame

// Imprint mode uniforms
uniform float u_mode;           // 0 = legacy trail, 1 = imprint
uniform float u_cultivationRate;  // how fast energy builds during stillness
uniform float u_channelStrength;  // how much energy releases on motion
uniform float u_drainRate;        // how fast cultivation empties during motion
uniform float u_diffusionRate;    // spatial spreading speed
uniform float u_decayVariance;    // noise modulation on decay
uniform float u_disintSpeed;      // noise evolution speed
uniform float u_time;             // for noise animation
uniform vec2 u_texelSize;         // 1/width, 1/height for neighbor sampling
uniform float u_diffusionMode;    // 0 = isotropic, 1 = anisotropic

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

    // === Imprint mode (u_mode == 1) ===
    float prevCultivation = texture2D(u_prevTrail, v_uv).r;
    float prevDensity = texture2D(u_prevTrail, v_uv).g;
    float mask = texture2D(u_mask, v_uv).r;

    // Phase 1: Cultivation — stillness within the body accumulates energy
    float isStill = mask * (1.0 - step(0.01, motion));
    float newCultivation = prevCultivation + isStill * u_cultivationRate;

    // Phase 2: Channeling — motion releases cultivated energy into density
    float release = prevCultivation * motion * u_channelStrength;
    float newDensity = prevDensity + release;

    // Drain cultivation during motion
    newCultivation *= mix(1.0, u_drainRate, step(0.01, motion));

    // Phase 3: Disintegration — noise-modulated decay (not uniform fade)
    float noiseVal = snoise(v_uv * 8.0 + u_time * u_disintSpeed);
    float localDecay = u_decay * (1.0 + noiseVal * u_decayVariance);
    newDensity *= clamp(localDecay, 0.0, 1.0);

    // Spatial diffusion — density bleeds into neighbors
    if (u_diffusionMode > 0.5) {
        // Anisotropic: sample along motion direction
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
        // Isotropic: equal weight in all 4 cardinal directions
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

    // Clean up near-zero values
    if (newCultivation < 0.005) newCultivation = 0.0;
    if (newDensity < 0.005) newDensity = 0.0;

    gl_FragColor = vec4(newCultivation, newDensity, 0.0, 1.0);
}
