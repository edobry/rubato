precision highp float;
varying vec2 v_uv;

uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform vec2 u_texelSize;

void main() {
    // Pressure gradient (central differences)
    float pL = texture2D(u_pressure, v_uv + vec2(-u_texelSize.x, 0.0)).r * 2.0 - 1.0;
    float pR = texture2D(u_pressure, v_uv + vec2( u_texelSize.x, 0.0)).r * 2.0 - 1.0;
    float pU = texture2D(u_pressure, v_uv + vec2(0.0,  u_texelSize.y)).r * 2.0 - 1.0;
    float pD = texture2D(u_pressure, v_uv + vec2(0.0, -u_texelSize.y)).r * 2.0 - 1.0;

    vec2 gradP = vec2(pR - pL, pU - pD) * 0.5;

    // Subtract gradient from velocity
    vec2 vel = texture2D(u_velocity, v_uv).rg * 2.0 - 1.0;
    vel -= gradP;

    // Encode
    vel = clamp(vel, vec2(-1.0), vec2(1.0));
    gl_FragColor = vec4(vel * 0.5 + 0.5, 0.0, 1.0);
}
