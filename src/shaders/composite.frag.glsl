/**
 * composite.frag.glsl — Final compositing stage for the 時痕 Rubato installation.
 *
 * This is the last shader in the rendering pipeline and determines everything
 * the viewer actually sees on the wall-mounted screen. It blends four visual
 * layers into a single output:
 *
 *   1. FOG (always visible)
 *      A procedural simplex-noise field that fills the screen. This is the
 *      ambient idle-state visual — when no one is present, the viewer sees
 *      only fog. The fog is never fully replaced; the body interacts with it
 *      but never overrides it.
 *
 *   2. CAMERA FEED (debug/development only)
 *      The raw webcam image. Controlled by u_showFeed; always off in the
 *      gallery. Useful for aligning the camera crop and verifying detection.
 *
 *   3. MASK OVERLAY (debug/development only)
 *      A tinted silhouette derived from the body-segmentation model.
 *      Controlled by u_showOverlay. In gallery mode this is off; the viewer
 *      should never see a literal outline of their body.
 *
 *   4. TRAIL / DENSITY (the core artistic layer)
 *      A persistent trace of accumulated movement, stored in an offscreen
 *      trail FBO. In the default (non-imprint) mode the trail's R channel
 *      modulates fog brightness. In imprint mode the trail's G channel
 *      (density) illuminates the fog — areas where a viewer has moved glow
 *      brighter, as if the fog is being lit from within. The body itself is
 *      NEVER shown; only its accumulated energy is visible.
 *
 * Blending philosophy:
 *   The installation's aesthetic is subtractive presence — the viewer's body
 *   is revealed only through its effect on the fog, never as a direct image.
 *   In classic fog mode the silhouette carves dark clearings; in shadow mode
 *   it creates bright clearings in dark fog. Trails leave persistent traces
 *   that slowly fade over time.
 *
 * Color modes (u_colorMode) provide different aesthetic treatments for how
 * the overlay/density is rendered — see computeOverlayColor() below.
 */

precision mediump float;

varying vec2 v_uv;

// --- Input textures ---
uniform sampler2D u_fog;
uniform sampler2D u_camera;
uniform sampler2D u_mask;    // person mask (R channel, 0-1)
uniform sampler2D u_trail;   // trail buffer — R: cultivation/trail, G: density (imprint mode)

// --- Camera crop / transform (UV space) ---
// Maps screen UVs to the sub-region of the camera texture that should be
// displayed, accounting for aspect-ratio differences and optional mirroring.
uniform vec2 u_cropOffset;
uniform vec2 u_cropScale;
uniform float u_mirror;      // 1.0 = mirror horizontally (natural selfie view)

// --- Display toggles (debug controls, off in gallery) ---
uniform float u_showFeed;    // 1.0 = show raw camera feed
uniform float u_showOverlay; // 1.0 = show colored mask overlay
uniform float u_opacity;     // overlay opacity multiplier
uniform vec3 u_overlayColor; // base tint for solid / contour / aura modes
uniform float u_time;        // elapsed seconds, drives animated color modes
uniform float u_colorMode;   // color treatment — see computeOverlayColor()
uniform float u_imprint;     // 1.0 = imprint mode (density-only, no silhouette)

// --- Mask blur ---
// Softens the hard segmentation edges from the ML model to avoid a harsh
// cut-out look. A 5x5 Gaussian kernel is applied when u_blur > 0.5.
uniform float u_blur;            // blur radius in texels (0 = off, 1-5 typical)
uniform vec2 u_maskTexelSize;    // 1.0/maskWidth, 1.0/maskHeight

// --- Camera fill ---
// Controls how much of the camera feed is visible beyond the detected body.
// 0 = camera only where the mask says a person is (artistic/gallery mode)
// 1 = camera fills the entire frame regardless of mask (debug/alignment mode)
uniform float u_cameraFill;

// --- Fog interaction ---
// These uniforms control how the body and its trails affect the fog layer.
uniform float u_fogMaskStrength;   // how strongly the live silhouette parts the fog (0-1)
uniform float u_fogTrailStrength;  // how strongly accumulated trails modulate fog brightness
uniform float u_fogMode;           // 0 = classic (bright fog, body darkens it)
                                   // 1 = shadow (dark fog, body lightens it)

// Gaussian blur helper: samples a texture in a 5x5 kernel with Gaussian weights.
// The ML segmentation model produces hard-edged masks that look unnatural when
// composited directly. This blur softens the boundary so the body's interaction
// with the fog feels organic rather than cut-out. Uses exp(-d^2 / 2r^2) weighting
// for smooth falloff instead of a box blur.
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

    // When fillAmount < 1.0 (zoomed out), some screen pixels map outside the
    // camera texture's 0-1 range. CLAMP_TO_EDGE repeats edge pixels, causing
    // visible vertical line artifacts. Zero out everything outside valid range.
    bool inBounds = camUV.x >= 0.0 && camUV.x <= 1.0 && camUV.y >= 0.0 && camUV.y <= 1.0;

    vec3 camera = inBounds ? texture2D(u_camera, camUV).rgb : vec3(0.0);
    float mask;
    float trail;
    if (!inBounds) {
        mask = 0.0;
        trail = 0.0;
    } else if (u_blur > 0.5) {
        mask = gaussianBlur(u_mask, camUV, u_maskTexelSize, u_blur);
        trail = gaussianBlur(u_trail, camUV, u_maskTexelSize, u_blur);
        // Smooth edges to eliminate stepped aliasing artifacts
        mask = smoothstep(0.1, 0.5, mask);
    } else {
        mask = texture2D(u_mask, camUV).r;
        trail = texture2D(u_trail, camUV).r;
    }

    // Imprint mode: density illuminates fog, no person outline visible
    if (u_imprint > 0.5) {
        // In imprint mode, trail texture has R=cultivation, G=density
        // Sample the G channel for the density value
        float density;
        if (!inBounds) {
            density = 0.0;
        } else {
            density = texture2D(u_trail, camUV).g;
        }

        // Base layer: fog
        vec3 color = fog;

        // Density illuminates the fog — brighter where energy has been channeled
        color += fog * density * u_fogTrailStrength;

        // Layer camera feed (if enabled)
        if (u_showFeed > 0.5) {
            float camBlend = u_cameraFill * 0.8;
            color = mix(color, camera, camBlend);
        }

        // No overlay tint — person outline is never visible in imprint mode

        gl_FragColor = vec4(color, 1.0);
        return;
    }

    // Base layer: fog
    vec3 color = fog;

    // Fog interaction: mode-dependent
    if (u_fogMode < 0.5) {
        // Classic: silhouette carves through bright fog (darkens)
        float fogSuppression = mask * u_fogMaskStrength;
        color *= (1.0 - fogSuppression);
        // Trails brighten fog
        color += fog * trail * u_fogTrailStrength;
    } else {
        // Shadow: silhouette creates clearings in dark fog (lightens)
        // In shadow mode, the displacement handles the primary interaction,
        // but mask still adds immediate presence clearing
        color += vec3(mask * u_fogMaskStrength * 0.1);
        // Trails create subtle light traces in the shadow
        color += vec3(trail * u_fogTrailStrength * 0.05);
    }

    // Layer camera feed (if enabled).
    // u_cameraFill controls the minimum camera visibility:
    //   0 = camera only where person mask is detected (artistic mode)
    //   1 = camera fills the entire frame (camera test / debug mode)
    // Intermediate values blend between the two.
    if (u_showFeed > 0.5) {
        float camBlend = max(mask, u_cameraFill) * 0.8;
        color = mix(color, camera, camBlend);
    }

    // Overlay tint on person (color mode aware)
    if (u_showOverlay > 0.5) {
        vec4 overlayResult = computeOverlayColor(camUV, mask, trail, color);
        float overlayAlpha = max(mask, trail * 0.7) * u_opacity * overlayResult.a;
        color = mix(color, overlayResult.rgb, overlayAlpha);
    }

    gl_FragColor = vec4(color, 1.0);
}
