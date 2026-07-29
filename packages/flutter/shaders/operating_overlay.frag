#version 320 es

precision highp float;

#include <flutter/runtime_effect.glsl>

uniform vec2 u_resolution;
uniform float u_time;

out vec4 frag_color;

const float PI = 3.14159265359;

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(2.0 * PI * (c * t + d));
}

vec3 living_palette(float t, float time) {
  vec3 prism = palette(t, vec3(0.46, 0.88, 0.33), vec3(0.60, 0.58, 0.74), vec3(0.50), vec3(0.54, 0.22, 0.84));
  vec3 lagoon = palette(t, vec3(0.58, 0.64, 0.52), vec3(0.64, 0.30, 0.50), vec3(0.50), vec3(0.37, 0.66, 0.89));
  vec3 berry = palette(t, vec3(0.92, 0.36, 0.56), vec3(0.10, 0.14, 0.37), vec3(0.50), vec3(0.84, 0.11, 0.50));
  float phase = mod(time * 0.08, 3.0);
  if (phase < 1.0) return mix(prism, lagoon, smoothstep(0.0, 1.0, phase));
  if (phase < 2.0) return mix(lagoon, berry, smoothstep(1.0, 2.0, phase));
  return mix(berry, prism, smoothstep(2.0, 3.0, phase));
}

void main() {
  vec2 uv = FlutterFragCoord().xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float sweep = -0.25 + 1.5 * fract(u_time * 0.055);
  float ripple = 0.026 * sin(uv.y * 8.0 + u_time * 0.72) + 0.012 * sin(uv.y * 19.0 - u_time * 0.38);
  float distance_to_sweep = abs(uv.x - sweep - ripple);
  float core = exp(-distance_to_sweep * distance_to_sweep * 82.0);
  float bloom = exp(-distance_to_sweep * distance_to_sweep * 12.0);
  float texture = 0.72 + 0.28 * sin(uv.y * 16.0 + u_time * 0.84 + sin(uv.y * 5.0 - u_time * 0.3));
  vec2 glow_center = vec2(0.5 + 0.3 * sin(u_time * 0.17), 0.52 + 0.24 * cos(u_time * 0.13));
  vec2 glow_delta = (uv - glow_center) * vec2(aspect, 1.0);
  float ambient_glow = exp(-dot(glow_delta, glow_delta) * 3.8);
  float palette_position = uv.x * 0.74 + uv.y * 0.2 + ripple * 1.8 + u_time * 0.035;
  vec3 colour = living_palette(palette_position, u_time) * 0.5 + living_palette(palette_position - 0.16, u_time) * 0.25 + living_palette(palette_position + 0.16, u_time) * 0.25;
  vec3 ambient_colour = living_palette(palette_position + 0.38 + ambient_glow * 0.2, u_time);
  colour = mix(ambient_colour, colour, 0.45 + bloom * 0.55);
  colour *= 0.86 + core * texture * 0.3;
  float alpha = 0.028 + ambient_glow * 0.055 + bloom * 0.1 + core * 0.16;
  frag_color = vec4(colour * alpha, alpha);
}
