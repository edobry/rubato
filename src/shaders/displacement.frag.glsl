precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_prevDisp;    // previous frame's displacement (RG, 0.5-centered)
uniform sampler2D u_velocity;    // velocity input from mask tracking (RG, 0.5-centered)
uniform float u_damping;         // per-frame displacement decay (0.98)
uniform float u_forceScale;      // velocity -> displacement scale (0.5)
uniform float u_diffusion;       // spatial spreading (0.15)
uniform float u_advection;       // self-advection strength (0.3)
uniform float u_creepSpeed;      // how fast displacement returns to zero (0.02)
uniform vec2 u_texelSize;        // 1/width, 1/height for neighbor sampling

void main() {
    // 1. Decode previous displacement from 0.5-centered encoding
    vec2 disp = texture2D(u_prevDisp, v_uv).rg * 2.0 - 1.0;

    // 2. Self-advection: sample previous displacement at offset UV
    //    This creates swirling/flowing momentum — displacement carries itself
    vec2 advectUV = v_uv - disp * u_advection * u_texelSize;
    disp = texture2D(u_prevDisp, advectUV).rg * 2.0 - 1.0;

    // 3. Decode velocity input
    vec2 vel = texture2D(u_velocity, v_uv).rg * 2.0 - 1.0;

    // 4. Inject forces from velocity field
    disp += vel * u_forceScale;

    // 5. Diffusion: blend with 4-neighbor average for spatial spreading
    vec2 dL = texture2D(u_prevDisp, v_uv + vec2(-u_texelSize.x, 0.0)).rg * 2.0 - 1.0;
    vec2 dR = texture2D(u_prevDisp, v_uv + vec2( u_texelSize.x, 0.0)).rg * 2.0 - 1.0;
    vec2 dU = texture2D(u_prevDisp, v_uv + vec2(0.0,  u_texelSize.y)).rg * 2.0 - 1.0;
    vec2 dD = texture2D(u_prevDisp, v_uv + vec2(0.0, -u_texelSize.y)).rg * 2.0 - 1.0;
    vec2 neighborAvg = (dL + dR + dU + dD) * 0.25;
    disp = mix(disp, neighborAvg, u_diffusion);

    // 6. Creep back toward zero (restoring force)
    disp -= disp * u_creepSpeed;

    // 7. Apply per-frame damping
    disp *= u_damping;

    // 8. Clamp to valid range
    disp = clamp(disp, vec2(-1.0), vec2(1.0));

    // 9. Encode back to 0.5-centered RGBA8
    gl_FragColor = vec4(disp * 0.5 + 0.5, 0.0, 1.0);
}
