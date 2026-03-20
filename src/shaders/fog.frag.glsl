precision mediump float;

varying vec2 v_uv;

uniform float u_time;
uniform float u_speed;
uniform float u_scale;
uniform float u_density;
uniform float u_brightness;
uniform vec3 u_color;
uniform float u_octaves;    // 2-5, controls detail vs performance
uniform float u_resolution; // render scale (1.0 = full, 0.5 = half)

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
    vec2 uv = v_uv * u_scale;
    float t = u_time * u_speed;

    // Two layers of fbm with different drift directions for organic movement
    float n1 = fbm(uv + vec2(t * 0.3, t * 0.1));
    float n2 = fbm(uv + vec2(-t * 0.2, t * 0.15) + vec2(5.2, 1.3));

    // Combine and shape
    float fog = (n1 + n2) * 0.5 + 0.5; // normalize to 0-1
    fog = pow(fog, 2.0 - u_density);     // density controls contrast
    fog *= u_brightness;

    gl_FragColor = vec4(fog * u_color, 1.0);
}
