precision highp float;
varying vec2 v_uv;

uniform sampler2D u_pressure;    // previous iteration's pressure (R, 0.5-centered)
uniform sampler2D u_divergence;  // divergence field (R, 0.5-centered)
uniform vec2 u_texelSize;

void main() {
    // Sample pressure neighbors (decode from 0.5-centered)
    float pL = texture2D(u_pressure, v_uv + vec2(-u_texelSize.x, 0.0)).r * 2.0 - 1.0;
    float pR = texture2D(u_pressure, v_uv + vec2( u_texelSize.x, 0.0)).r * 2.0 - 1.0;
    float pU = texture2D(u_pressure, v_uv + vec2(0.0,  u_texelSize.y)).r * 2.0 - 1.0;
    float pD = texture2D(u_pressure, v_uv + vec2(0.0, -u_texelSize.y)).r * 2.0 - 1.0;

    // Divergence at this cell
    float div = texture2D(u_divergence, v_uv).r * 2.0 - 1.0;

    // Jacobi iteration: p = (pL + pR + pU + pD - div) / 4
    float pressure = (pL + pR + pU + pD - div) * 0.25;

    // Encode to 0.5-centered
    gl_FragColor = vec4(pressure * 0.5 + 0.5, 0.0, 0.0, 1.0);
}
