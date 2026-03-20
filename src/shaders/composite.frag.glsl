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

// Fog interaction
uniform float u_fogMaskStrength;   // how much silhouette parts the fog (0-1)
uniform float u_fogTrailStrength;  // how much trails modulate fog brightness

vec2 getCameraUV(vec2 baseUV) {
    vec2 uv = u_cropOffset + baseUV * u_cropScale;
    if (u_mirror > 0.5) {
        uv.x = u_cropOffset.x + u_cropScale.x - (uv.x - u_cropOffset.x);
    }
    return uv;
}

void main() {
    // Flip Y for video/mask textures (WebGL origin is bottom-left, video is top-left)
    vec2 flippedUV = vec2(v_uv.x, 1.0 - v_uv.y);

    // Sample fog (rendered in WebGL space, no flip needed)
    vec3 fog = texture2D(u_fog, v_uv).rgb;

    // Sample camera-space textures (Y-flipped for video/mask coordinate space)
    vec2 camUV = getCameraUV(flippedUV);
    vec3 camera = texture2D(u_camera, camUV).rgb;
    float mask = texture2D(u_mask, camUV).r;
    float trail = texture2D(u_trail, camUV).r;

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

    // Overlay tint on person
    if (u_showOverlay > 0.5) {
        float overlayAlpha = max(mask, trail * 0.7) * u_opacity;
        color = mix(color, u_overlayColor, overlayAlpha);
    }

    gl_FragColor = vec4(color, 1.0);
}
