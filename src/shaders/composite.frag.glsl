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

vec2 getCameraUV() {
    vec2 uv = u_cropOffset + v_uv * u_cropScale;
    if (u_mirror > 0.5) {
        uv.x = u_cropOffset.x + u_cropScale.x - (uv.x - u_cropOffset.x);
    }
    return uv;
}

void main() {
    // Sample all layers
    vec4 fogColor = texture2D(u_fog, v_uv);
    vec2 camUV = getCameraUV();
    vec4 cameraColor = texture2D(u_camera, camUV);
    float mask = texture2D(u_mask, camUV).r;
    float trail = texture2D(u_trail, camUV).r;

    // Start with fog as the base
    vec3 color = fogColor.rgb;

    // Fog interaction: silhouette parts the fog
    color *= 1.0 - mask * u_fogMaskStrength;

    // Fog interaction: trails modulate fog brightness
    color *= 1.0 + trail * u_fogTrailStrength;

    // Blend camera feed where person is (if enabled)
    if (u_showFeed > 0.5) {
        // Camera shows everywhere, fog shows through mask gaps
        color = mix(cameraColor.rgb, color, 1.0 - mask * u_showOverlay);
        // Actually: show camera everywhere, then fog interaction on top
        color = cameraColor.rgb;
        // Re-apply fog interaction on top of camera
        vec3 fogInteraction = fogColor.rgb;
        fogInteraction *= 1.0 - mask * u_fogMaskStrength;
        fogInteraction *= 1.0 + trail * u_fogTrailStrength;
        // Blend: where there's no person, show camera. Where there is, modulate.
        color = mix(color, fogInteraction, (1.0 - mask) * 0.5);
    }

    // Overlay: tint person regions with overlay color
    if (u_showOverlay > 0.5) {
        vec3 overlayTint = u_overlayColor * mask;
        color = mix(color, overlayTint, mask * u_opacity);

        // Trail overlay
        vec3 trailTint = u_overlayColor * trail;
        color = mix(color, trailTint, trail * u_opacity * 0.7);
    }

    gl_FragColor = vec4(color, 1.0);
}
