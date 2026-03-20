precision mediump float;

varying vec2 v_uv;

// Textures
uniform sampler2D u_fog;
uniform sampler2D u_camera;
uniform sampler2D u_mask;    // person mask (R channel, 0-1)
uniform sampler2D u_trail;   // trail buffer (R channel, 0-1)

// Camera crop (UV space)
uniform vec2 u_cropOffset;
uniform vec2 u_cropScale;
uniform float u_mirror;      // 1.0 = mirror, 0.0 = no mirror

// Display controls
uniform float u_showFeed;    // 1.0 = show camera, 0.0 = hide
uniform float u_showOverlay; // 1.0 = show overlay, 0.0 = hide
uniform float u_opacity;
uniform vec3 u_overlayColor;
uniform float u_time;
uniform float u_colorMode;   // 0=solid, 1=rainbow, 2=gradient, 3=contour, 4=invert, 5=aura

// Mask blur
uniform float u_blur;            // blur radius (0-5)
uniform vec2 u_maskTexelSize;    // 1.0/maskWidth, 1.0/maskHeight

// Fog interaction
uniform float u_fogMaskStrength;   // how much silhouette parts the fog (0-1)
uniform float u_fogTrailStrength;  // how much trails modulate fog brightness

// Gaussian blur helper: samples a texture in a 5x5 kernel with Gaussian weights
// Uses exp(-dist^2 / (2*radius^2)) weighting for smooth falloff instead of box blur
float gaussianBlur(sampler2D tex, vec2 uv, vec2 texelSize, float radius) {
    float sum = 0.0;
    float weightSum = 0.0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            float dist = sqrt(float(x * x + y * y));
            float weight = exp(-dist * dist / (2.0 * radius * radius));
            vec2 offset = vec2(float(x), float(y)) * texelSize * radius;
            sum += texture2D(tex, uv + offset).r * weight;
            weightSum += weight;
        }
    }
    return sum / weightSum;
}

vec2 getCameraUV(vec2 baseUV) {
    vec2 uv = u_cropOffset + baseUV * u_cropScale;
    if (u_mirror > 0.5) {
        uv.x = u_cropOffset.x + u_cropScale.x - (uv.x - u_cropOffset.x);
    }
    return uv;
}

// HSL to RGB conversion (h, s, l all in 0-1 range)
vec3 hsl2rgb(float h, float s, float l) {
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float hp = h * 6.0; // h mapped to 0-6
    float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
    float m = l - c * 0.5;
    vec3 rgb;
    if (hp < 1.0)      rgb = vec3(c, x, 0.0);
    else if (hp < 2.0) rgb = vec3(x, c, 0.0);
    else if (hp < 3.0) rgb = vec3(0.0, c, x);
    else if (hp < 4.0) rgb = vec3(0.0, x, c);
    else if (hp < 5.0) rgb = vec3(x, 0.0, c);
    else                rgb = vec3(c, 0.0, x);
    return rgb + m;
}

// Compute overlay color based on color mode, UV position, time, and current base color
// Returns vec4(rgb, alpha_multiplier) where alpha_multiplier modulates the overlay alpha
vec4 computeOverlayColor(vec2 uv, float maskVal, float trailVal, vec3 baseColor) {
    // solid (0)
    if (u_colorMode < 0.5) {
        return vec4(u_overlayColor, 1.0);
    }
    // rainbow (1)
    if (u_colorMode < 1.5) {
        float h = mod(u_time * 0.5 + uv.x * 0.5 + uv.y * 0.3, 1.0);
        return vec4(hsl2rgb(h, 1.0, 0.5), 1.0);
    }
    // gradient (2)
    if (u_colorMode < 2.5) {
        float h = mod(u_time * 0.5 + uv.y * 0.5, 1.0);
        return vec4(hsl2rgb(h, 0.8, 0.5), 1.0);
    }
    // contour (3) — edge detection via mask gradient
    if (u_colorMode < 3.5) {
        float right = texture2D(u_mask, uv + vec2(u_maskTexelSize.x, 0.0)).r;
        float below = texture2D(u_mask, uv + vec2(0.0, u_maskTexelSize.y)).r;
        float rawMask = texture2D(u_mask, uv).r;
        float dx = rawMask - right;
        float dy = rawMask - below;
        float edge = abs(dx) + abs(dy);
        if (edge < 0.05) return vec4(u_overlayColor, 0.0); // no edge, skip
        float ea = min(edge * 5.0, 1.0);
        return vec4(u_overlayColor, ea);
    }
    // invert (4) — invert the base color
    if (u_colorMode < 4.5) {
        return vec4(1.0 - baseColor, 1.0);
    }
    // aura (5) — pulsing glow with hue shift
    // Legacy uses: pulse = 0.7 + 0.3 * sin(rainbowHue * 0.05 + y * 0.02)
    //              hue = (rainbowHue + y * 0.3) % 360
    // rainbowHue advances 0.5/frame ~= 30/sec, so rainbowHue ≈ time * 30
    float pulse = 0.7 + 0.3 * sin(u_time * 1.5 + uv.y * 1.44);
    float hue = mod(u_time * 0.083 + uv.y * 0.3, 1.0);
    vec3 auraColor = hsl2rgb(hue, 0.8, 0.3 + 0.3 * pulse);
    float auraMult = pulse * (200.0 / 255.0);
    return vec4(auraColor, auraMult);
}

void main() {
    // Flip Y for video/mask textures (WebGL origin is bottom-left, video is top-left)
    vec2 flippedUV = vec2(v_uv.x, 1.0 - v_uv.y);

    // Sample fog (rendered in WebGL space, no flip needed)
    vec3 fog = texture2D(u_fog, v_uv).rgb;

    // Sample camera-space textures (Y-flipped for video/mask coordinate space)
    vec2 camUV = getCameraUV(flippedUV);
    vec3 camera = texture2D(u_camera, camUV).rgb;
    float mask;
    float trail;
    if (u_blur > 0.5) {
        mask = gaussianBlur(u_mask, camUV, u_maskTexelSize, u_blur);
        trail = gaussianBlur(u_trail, camUV, u_maskTexelSize, u_blur);
        // Smooth edges to eliminate stepped aliasing artifacts
        mask = smoothstep(0.1, 0.5, mask);
    } else {
        mask = texture2D(u_mask, camUV).r;
        trail = texture2D(u_trail, camUV).r;
    }

    // Base layer: fog
    vec3 color = fog;

    // Fog interaction: silhouette carves through fog
    float fogSuppression = mask * u_fogMaskStrength;
    color *= (1.0 - fogSuppression);

    // Fog interaction: trails brighten/modulate fog
    color += fog * trail * u_fogTrailStrength;

    // Layer camera feed where person is detected (if enabled)
    if (u_showFeed > 0.5) {
        color = mix(color, camera, mask * 0.8);
    }

    // Overlay tint on person (color mode aware)
    if (u_showOverlay > 0.5) {
        vec4 overlayResult = computeOverlayColor(camUV, mask, trail, color);
        float overlayAlpha = max(mask, trail * 0.7) * u_opacity * overlayResult.a;
        color = mix(color, overlayResult.rgb, overlayAlpha);
    }

    gl_FragColor = vec4(color, 1.0);
}
