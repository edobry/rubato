precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_prevTrail;  // previous frame's trail buffer
uniform sampler2D u_motion;     // current frame's motion map

uniform float u_deposition;     // how much motion adds to trail
uniform float u_decay;          // multiplicative decay per frame

void main() {
    float prev = texture2D(u_prevTrail, v_uv).r;
    float motion = texture2D(u_motion, v_uv).r;

    // Accumulate: deposit motion energy, clamp to 1
    float trail = min(1.0, prev + motion * u_deposition);

    // Decay toward zero
    trail *= u_decay;

    // Clean up near-zero values (match CPU threshold of 0.005)
    trail = trail < 0.005 ? 0.0 : trail;

    gl_FragColor = vec4(trail, trail, trail, 1.0);
}
