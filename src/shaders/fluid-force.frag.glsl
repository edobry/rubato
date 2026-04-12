precision highp float;
varying vec2 v_uv;

uniform sampler2D u_velocity;      // current velocity field (RG, 0.5-centered)
uniform sampler2D u_mask;          // segmentation mask (R channel, 0-1)
uniform sampler2D u_motion;        // motion map (R channel, 0-1)
uniform float u_forceScale;        // how strongly mask pushes fluid
uniform float u_dt;
uniform vec2 u_maskTexelSize;      // 1/maskWidth, 1/maskHeight

void main() {
    // Read current velocity
    vec2 vel = texture2D(u_velocity, v_uv).rg * 2.0 - 1.0;

    // Flip Y for mask sampling (mask is in video space, fluid is in GL space)
    vec2 maskUV = vec2(v_uv.x, 1.0 - v_uv.y);

    // Sample mask and neighbors to compute gradient (edge normal)
    float maskC = texture2D(u_mask, maskUV).r;
    float maskL = texture2D(u_mask, maskUV + vec2(-u_maskTexelSize.x, 0.0)).r;
    float maskR = texture2D(u_mask, maskUV + vec2( u_maskTexelSize.x, 0.0)).r;
    float maskU = texture2D(u_mask, maskUV + vec2(0.0,  u_maskTexelSize.y)).r;
    float maskD = texture2D(u_mask, maskUV + vec2(0.0, -u_maskTexelSize.y)).r;

    // Gradient of mask = direction pointing INTO the mask
    // We want forces pointing OUTWARD (away from body into shadow)
    vec2 grad = vec2(maskR - maskL, maskU - maskD) * 0.5;

    // Force = outward from body boundary, scaled by edge strength
    // Negative gradient = outward direction
    vec2 force = -grad * u_forceScale;

    // Amplify force where motion is detected (moving body pushes harder)
    float motion = texture2D(u_motion, maskUV).r;
    force *= (1.0 + motion * 3.0);

    // Direct repulsion force — where mask IS, push outward
    // This creates the "body displaces shadow" effect even without movement
    if (maskC > 0.1) {
        float edgeStrength = length(grad);
        if (edgeStrength > 0.001) {
            force += -normalize(grad) * maskC * u_forceScale * 0.5;
        }
    }

    // Add force to velocity
    vel += force * u_dt;

    // Encode back to 0.5-centered
    vel = clamp(vel, vec2(-1.0), vec2(1.0));
    gl_FragColor = vec4(vel * 0.5 + 0.5, 0.0, 1.0);
}
