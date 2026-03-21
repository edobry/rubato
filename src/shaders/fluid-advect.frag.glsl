precision mediump float;
varying vec2 v_uv;

uniform sampler2D u_field;     // field to advect (velocity RG or density R)
uniform sampler2D u_velocity;  // velocity field driving advection (RG, 0.5-centered)
uniform float u_dt;            // timestep
uniform float u_dissipation;   // per-step dissipation multiplier
uniform float u_source;        // source value to blend toward (0.5 for velocity, baseDensity for density)

void main() {
    // Read velocity at this position, decode from 0.5-centered
    vec2 vel = texture2D(u_velocity, v_uv).rg * 2.0 - 1.0;

    // Trace backwards in UV space
    // vel is in [-1,1] normalized range, dt scales the step
    vec2 prevUV = v_uv - vel * u_dt;

    // Clamp to prevent sampling outside bounds
    prevUV = clamp(prevUV, vec2(0.0), vec2(1.0));

    // Sample the field at the source position (bilinear interpolation via GPU)
    vec4 advected = texture2D(u_field, prevUV);

    // Blend toward source value: result = advected * dissipation + source * (1 - dissipation)
    vec4 result = advected * u_dissipation + vec4(u_source) * (1.0 - u_dissipation);

    gl_FragColor = result;
}
