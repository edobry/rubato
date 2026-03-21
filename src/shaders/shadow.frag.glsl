precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_density;       // fluid density field (R channel, 0-1)
uniform sampler2D u_velocity;      // fluid velocity field (RG, 0.5-centered)
uniform float u_time;
uniform float u_noiseScale;        // base noise scale (4.0)
uniform float u_noiseSpeed;        // noise animation speed (0.03)
uniform float u_noiseAmount;       // how much noise texture (0-1, 0.3)
uniform vec3 u_baseColor;          // shadow color RGB (dark, e.g., 0.067, 0.067, 0.067)
uniform vec3 u_highlightColor;     // energy glow color RGB
uniform float u_baseDensity;       // equilibrium density (used to compute energy amount)
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
    // Crop check (keep existing crop logic exactly as-is)
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

    // Read fluid sim outputs
    float density = texture2D(u_density, v_uv).r;
    vec2 vel = texture2D(u_velocity, v_uv).rg * 2.0 - 1.0;
    float velMag = length(vel);

    // Use velocity to distort noise sampling — creates fluid texture movement
    float t = u_time * u_noiseSpeed;
    vec2 noiseUV = v_uv * u_noiseScale + vel * 0.5;

    // Subtle noise for internal texture (not fog-like, just slight variation)
    float n = snoise(noiseUV + vec2(t * 0.2, t * 0.07));
    float n2 = snoise(noiseUV * 0.6 + vec2(-t * 0.1, t * 0.05) + vec2(3.7, 1.9));
    float noise = (n + n2) * 0.5;

    // Shadow = fluid density + subtle noise texture
    float shadow = density;
    shadow += noise * u_noiseAmount * density;  // noise only where dense
    shadow = clamp(shadow, 0.0, 1.0);

    // Energy = inverse of density (where body cultivated light)
    // baseDensity is the equilibrium — anything below it is gathered energy
    float energy = clamp(1.0 - density / u_baseDensity, 0.0, 1.0);

    // Energy glow: brighten where energy has gathered or is flowing
    // Velocity-distorted noise gives the glow a fluid texture
    float glowNoise = snoise(v_uv * u_noiseScale * 2.0 + vel * 1.5 + vec2(t * 0.4, -t * 0.25));
    float glowTexture = 0.7 + 0.3 * glowNoise;  // subtle variation in glow

    // Flowing energy gets extra brightness from velocity
    float flowGlow = velMag * 0.4;

    // Final color: dark shadow + luminous energy
    vec3 color = u_baseColor * shadow;
    color += u_highlightColor * energy * glowTexture * 1.5;
    color += u_highlightColor * flowGlow * (energy + 0.1);

    gl_FragColor = vec4(color, 1.0);
}
