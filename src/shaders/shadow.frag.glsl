precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_displacement;  // displacement field (RG, 0.5-centered signed)
uniform float u_time;
uniform float u_noiseScale;        // base noise scale (4.0)
uniform float u_noiseSpeed;        // noise animation speed (0.03)
uniform float u_noiseAmount;       // how much noise texture (0-1, 0.3)
uniform vec3 u_baseColor;          // shadow color RGB (dark, e.g., 0.067, 0.067, 0.067)
uniform vec3 u_highlightColor;     // dithered highlight color RGB (e.g., 0.165, 0.165, 0.165)
uniform float u_baseDensity;       // how dark the base state is (0-1, 0.9)
uniform vec2 u_cropOffset;         // visible region top-left (0-1 UV space)
uniform vec2 u_cropScale;          // visible region size (0-1 UV space)

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

// Simplified FBM — 3 octaves, hardcoded for dark field texture
float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;

    // Octave 1
    value += amp * snoise(p * freq); freq *= 2.0; amp *= 0.5;
    // Octave 2
    value += amp * snoise(p * freq); freq *= 2.0; amp *= 0.5;
    // Octave 3
    value += amp * snoise(p * freq);

    return value;
}

void main() {
    // Crop shadow to the camera's visible region (black outside)
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

    // Read displacement field (0.5-centered signed encoding)
    vec2 disp = texture2D(u_displacement, v_uv).rg * 2.0 - 1.0;
    float dispMag = length(disp);

    // Displace UV for noise sampling — displacement warps the shadow field
    vec2 displacedUV = v_uv * u_noiseScale + disp * 3.0;

    float t = u_time * u_noiseSpeed;

    // Single-layer noise for subtle internal texture — NOT fbm fog
    // Use displaced UV so the shadow texture moves with the displacement
    float n1 = snoise(displacedUV + vec2(t * 0.2, t * 0.07));
    // Very subtle second layer for slow organic drift
    float n2 = snoise(displacedUV * 0.5 + vec2(-t * 0.1, t * 0.08) + vec2(3.7, 1.9));
    float noise = (n1 + n2) * 0.5; // stays in roughly -1..1 range

    // Compute shadow density — dramatic response to displacement
    float density = u_baseDensity;

    // Displacement creates voids — nonlinear falloff for viscous feel
    // smoothstep creates a soft boundary between shadow and void
    float voidAmount = smoothstep(0.0, 0.4, dispMag);
    density *= (1.0 - voidAmount);

    // Add very subtle noise texture (dark variation, not fog)
    density += noise * u_noiseAmount * density;
    density = clamp(density, 0.0, 1.0);

    // Dithered highlights — only in dense areas, very subtle
    // Uses the displacement to modulate highlight position for fluid feel
    float highlightNoise = snoise(v_uv * u_noiseScale * 2.5 + disp * 1.5 + vec2(t * 0.3, -t * 0.2));
    float highlight = smoothstep(0.4, 0.8, highlightNoise) * 0.1 * density * density;

    // Final color: dense dark shadow with viscous highlights
    vec3 color = u_baseColor * density;
    color += u_highlightColor * highlight;

    gl_FragColor = vec4(color, 1.0);
}
