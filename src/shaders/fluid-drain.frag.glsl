/**
 * Energy cultivation pass.
 * Body presence slowly gathers light energy (reduces shadow density).
 * Stillness cultivates faster; motion lets the fluid sim disperse
 * the gathered energy outward through the shadow field.
 */
precision mediump float;
varying vec2 v_uv;

uniform sampler2D u_density;
uniform sampler2D u_mask;
uniform sampler2D u_motion;
uniform float u_cultivationRate;  // how fast body gathers energy (0.01-0.05)

void main() {
    float density = texture2D(u_density, v_uv).r;

    // Flip Y for mask sampling (mask is in video space, fluid is in GL space)
    vec2 maskUV = vec2(v_uv.x, 1.0 - v_uv.y);
    float mask = texture2D(u_mask, maskUV).r;
    float motion = texture2D(u_motion, maskUV).r;

    // Stillness cultivates more, motion cultivates less
    // (motion's energy goes into velocity forces instead)
    float stillness = 1.0 - smoothstep(0.0, 0.15, motion);
    float cultivation = mask * u_cultivationRate * (0.3 + 0.7 * stillness);

    // Reduce density = gather light energy
    density -= cultivation;
    density = clamp(density, 0.0, 1.0);

    gl_FragColor = vec4(density, 0.0, 0.0, 1.0);
}
