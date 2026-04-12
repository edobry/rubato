/**
 * Fog Field — Ambient Visual Ground
 *
 * The fog is the installation's resting state: a slowly drifting field of
 * procedural noise that fills the projection when no viewer is present. It
 * represents potential — the undisturbed surface that density traces will
 * later illuminate. When a viewer moves through the camera's field of view,
 * their accumulated density does not replace the fog; instead, density
 * *modulates* the fog, revealing structure that was always latently there.
 * The interplay between fog and density is the core visual metaphor of
 * Rubato: presence gives form to what was formless.
 *
 * Implementation: two offset layers of fractal Brownian motion (FBM) built
 * on 2D simplex noise, drifting in different directions to produce organic,
 * non-repeating movement. The number of FBM octaves is the primary
 * performance knob — 5 octaves yield rich detail on a desktop GPU, while
 * 2 octaves keep the Raspberry Pi within budget at ~60% GPU savings.
 *
 * A crop system restricts the fog to the camera's visible region so that
 * fog and density align spatially. Outside the crop, the screen is black.
 */

precision highp float;

varying vec2 v_uv;

uniform float u_time;
uniform float u_speed;
uniform float u_scale;
uniform float u_density;
uniform float u_brightness;
uniform vec3 u_color;
uniform float u_octaves;    // 2-5, controls detail vs performance
uniform float u_resolution; // render scale (1.0 = full, 0.5 = half)
uniform vec2 u_cropOffset;  // top-left of visible region in 0-1 UV space
uniform vec2 u_cropScale;   // size of visible region in 0-1 UV space

// Simplex noise functions (Ashima Arts / Ian McEwan)
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

// Fractal Brownian Motion — unrolled with octave control for perf tuning.
// u_octaves=2 on Pi (~60% GPU savings), u_octaves=5 on desktop (full detail).
float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;

    // Octave 1 (always)
    value += amp * snoise(p * freq); freq *= 2.0; amp *= 0.5;
    // Octave 2 (always)
    value += amp * snoise(p * freq); freq *= 2.0; amp *= 0.5;
    // Octave 3
    if (u_octaves > 2.5) { value += amp * snoise(p * freq); freq *= 2.0; amp *= 0.5; }
    // Octave 4
    if (u_octaves > 3.5) { value += amp * snoise(p * freq); freq *= 2.0; amp *= 0.5; }
    // Octave 5
    if (u_octaves > 4.5) { value += amp * snoise(p * freq); }

    return value;
}

void main() {
    // Crop fog to the camera's visible region (black outside)
    if (u_cropScale.x > 0.0 && u_cropScale.y > 0.0) {
        bool inRegion = v_uv.x >= u_cropOffset.x &&
                        v_uv.x <= u_cropOffset.x + u_cropScale.x &&
                        v_uv.y >= u_cropOffset.y &&
                        v_uv.y <= u_cropOffset.y + u_cropScale.y;
        if (!inRegion) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
    }

    vec2 uv = v_uv * u_scale;
    float t = u_time * u_speed;

    // Two FBM layers drift in different directions so the fog feels alive —
    // slow, cloud-like motion with no obvious tiling or repetition.
    // The offset vec2(5.2, 1.3) breaks correlation between layers.
    float n1 = fbm(uv + vec2(t * 0.3, t * 0.1));
    float n2 = fbm(uv + vec2(-t * 0.2, t * 0.15) + vec2(5.2, 1.3));

    // Combine, normalize to 0-1, then shape:
    //   - u_density controls contrast (higher = more opaque, less variation)
    //   - u_brightness sets overall intensity
    //   - u_color tints the monochrome noise to match the installation palette
    float fog = (n1 + n2) * 0.5 + 0.5;
    fog = pow(fog, 2.0 - u_density);
    fog *= u_brightness;

    gl_FragColor = vec4(fog * u_color, 1.0);
}
