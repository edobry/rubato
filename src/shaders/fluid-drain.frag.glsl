/**
 * Density drain pass.
 * Zeros out density where the dancer's body is present, treating the body
 * as a solid obstacle. This is the primary mechanism for "pushing" shadow —
 * the body creates voids, and fluid dynamics handle how shadow flows back in.
 */
precision mediump float;
varying vec2 v_uv;

uniform sampler2D u_density;
uniform sampler2D u_mask;
uniform float u_drainStrength;   // how aggressively body clears density (0-1)

void main() {
    float density = texture2D(u_density, v_uv).r;

    // Flip Y for mask sampling (mask is in video space, fluid is in GL space)
    vec2 maskUV = vec2(v_uv.x, 1.0 - v_uv.y);
    float mask = texture2D(u_mask, maskUV).r;

    // Drain density where body is present — body is a solid obstacle
    density *= (1.0 - mask * u_drainStrength);

    gl_FragColor = vec4(density, 0.0, 0.0, 1.0);
}
