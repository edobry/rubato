precision mediump float;
varying vec2 v_uv;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
    // Sample velocity neighbors
    vec2 vL = texture2D(u_velocity, v_uv + vec2(-u_texelSize.x, 0.0)).rg * 2.0 - 1.0;
    vec2 vR = texture2D(u_velocity, v_uv + vec2( u_texelSize.x, 0.0)).rg * 2.0 - 1.0;
    vec2 vU = texture2D(u_velocity, v_uv + vec2(0.0,  u_texelSize.y)).rg * 2.0 - 1.0;
    vec2 vD = texture2D(u_velocity, v_uv + vec2(0.0, -u_texelSize.y)).rg * 2.0 - 1.0;

    // Divergence = dVx/dx + dVy/dy (central differences)
    float div = ((vR.x - vL.x) + (vU.y - vD.y)) * 0.5;

    // Store divergence in R channel, encoded as 0.5-centered
    gl_FragColor = vec4(div * 0.5 + 0.5, 0.0, 0.0, 1.0);
}
