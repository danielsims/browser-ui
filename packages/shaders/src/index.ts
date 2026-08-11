export const operatingShaderVariants = ["subtle", "prism", "pulse", "tide"] as const;
export type OperatingShaderVariant = (typeof operatingShaderVariants)[number];

type DirectionVector = readonly [x: number, y: number];

export const operatingShaderDirectionIds = [
  "left-to-right",
  "right-to-left",
  "top-to-bottom",
  "bottom-to-top",
  "top-left-to-bottom-right",
  "top-right-to-bottom-left",
  "bottom-left-to-top-right",
  "bottom-right-to-top-left",
] as const;
export type OperatingShaderDirection = (typeof operatingShaderDirectionIds)[number];

export interface OperatingShaderDirectionDefinition {
  label: string;
  vector: DirectionVector;
}

export const operatingShaderDirections = {
  "left-to-right": { label: "Left to right", vector: [1, 0] },
  "right-to-left": { label: "Right to left", vector: [-1, 0] },
  "top-to-bottom": { label: "Top to bottom", vector: [0, -1] },
  "bottom-to-top": { label: "Bottom to top", vector: [0, 1] },
  "top-left-to-bottom-right": { label: "Top left to bottom right", vector: [1, -1] },
  "top-right-to-bottom-left": { label: "Top right to bottom left", vector: [-1, -1] },
  "bottom-left-to-top-right": { label: "Bottom left to top right", vector: [1, 1] },
  "bottom-right-to-top-left": { label: "Bottom right to top left", vector: [-1, 1] },
} as const satisfies Record<OperatingShaderDirection, OperatingShaderDirectionDefinition>;

export const operatingShaderSpeedIds = ["slow", "fast"] as const;
export type OperatingShaderSpeed = (typeof operatingShaderSpeedIds)[number];

export interface OperatingShaderSpeedDefinition {
  durationSeconds: number;
  label: string;
}

export const operatingShaderSpeeds = {
  slow: { durationSeconds: 15, label: "Slow · 15s" },
  fast: { durationSeconds: 7, label: "Fast · 7s" },
} as const satisfies Record<OperatingShaderSpeed, OperatingShaderSpeedDefinition>;

export interface OperatingShaderMeta {
  accent: string;
  defaultDirection: OperatingShaderDirection;
  defaultSpeed: OperatingShaderSpeed;
  name: string;
  note: string;
}

export const operatingShaderMeta = {
  subtle: {
    name: "Subtle",
    note: "The original Browser UI shader, unchanged",
    accent: "#2f6bff",
    defaultDirection: "left-to-right",
    defaultSpeed: "slow",
  },
  prism: {
    name: "Prism",
    note: "A concentrated spectrum shimmer with a slower default",
    accent: "#ff45d4",
    defaultDirection: "left-to-right",
    defaultSpeed: "slow",
  },
  pulse: {
    name: "Pulse",
    note: "A vivid rose pulse with a faster, more kinetic rhythm",
    accent: "#ef3f93",
    defaultDirection: "left-to-right",
    defaultSpeed: "fast",
  },
  tide: {
    name: "Tide",
    note: "The Pulse movement rendered in electric cyan, blue, and green",
    accent: "#00a99d",
    defaultDirection: "top-left-to-bottom-right",
    defaultSpeed: "fast",
  },
} as const satisfies Record<OperatingShaderVariant, OperatingShaderMeta>;

export const operatingShaderVertexSource = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const subtleFragmentShader = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
const float PI = 3.14159265359;

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(2.0 * PI * (c * t + d));
}

vec3 livingPalette(float t, float time) {
  vec3 prism = palette(t, vec3(0.46, 0.88, 0.33), vec3(0.60, 0.58, 0.74), vec3(0.50), vec3(0.54, 0.22, 0.84));
  vec3 lagoon = palette(t, vec3(0.58, 0.64, 0.52), vec3(0.64, 0.30, 0.50), vec3(0.50), vec3(0.37, 0.66, 0.89));
  vec3 berry = palette(t, vec3(0.92, 0.36, 0.56), vec3(0.10, 0.14, 0.37), vec3(0.50), vec3(0.84, 0.11, 0.50));
  float phase = mod(time * 0.08, 3.0);
  if (phase < 1.0) return mix(prism, lagoon, smoothstep(0.0, 1.0, phase));
  if (phase < 2.0) return mix(lagoon, berry, smoothstep(1.0, 2.0, phase));
  return mix(berry, prism, smoothstep(2.0, 3.0, phase));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float sweep = -0.25 + 1.5 * fract(u_time * 0.055);
  float ripple = 0.026 * sin(uv.y * 8.0 + u_time * 0.72) + 0.012 * sin(uv.y * 19.0 - u_time * 0.38);
  float distanceToSweep = abs(uv.x - sweep - ripple);
  float core = exp(-distanceToSweep * distanceToSweep * 82.0);
  float bloom = exp(-distanceToSweep * distanceToSweep * 12.0);
  float texture = 0.72 + 0.28 * sin(uv.y * 16.0 + u_time * 0.84 + sin(uv.y * 5.0 - u_time * 0.3));
  vec2 glowCenter = vec2(0.5 + 0.3 * sin(u_time * 0.17), 0.52 + 0.24 * cos(u_time * 0.13));
  vec2 glowDelta = (uv - glowCenter) * vec2(aspect, 1.0);
  float ambientGlow = exp(-dot(glowDelta, glowDelta) * 3.8);
  float palettePosition = uv.x * 0.74 + uv.y * 0.2 + ripple * 1.8 + u_time * 0.035;
  vec3 colour = livingPalette(palettePosition, u_time) * 0.5 + livingPalette(palettePosition - 0.16, u_time) * 0.25 + livingPalette(palettePosition + 0.16, u_time) * 0.25;
  vec3 ambientColour = livingPalette(palettePosition + 0.38 + ambientGlow * 0.2, u_time);
  colour = mix(ambientColour, colour, 0.45 + bloom * 0.55);
  colour *= 0.86 + core * texture * 0.3;
  float alpha = 0.028 + ambientGlow * 0.055 + bloom * 0.1 + core * 0.16;
  gl_FragColor = vec4(colour * alpha, alpha);
}
`;

const common = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_direction;
uniform float u_speed;
const float PI = 3.14159265359;

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(2.0 * PI * (c * t + d));
}
`;

type ColourVector = readonly [red: number, green: number, blue: number];

interface SweepShaderOptions {
  brightness: number;
  crestTightness: number;
  offset: number;
  paletteA: ColourVector;
  paletteB: ColourVector;
  paletteC: ColourVector;
  paletteD: ColourVector;
  pulseStrength: number;
  tightness: number;
  waveAmount: number;
}

function glslVector(vector: ColourVector) {
  return `vec3(${vector.map((value) => value.toFixed(3)).join(", ")})`;
}

function createSweepShader(options: SweepShaderOptions) {
  return `${common}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 direction = normalize(u_direction);
  vec2 perpendicular = vec2(-direction.y, direction.x);
  float directionExtent = abs(direction.x) + abs(direction.y);
  float perpendicularExtent = abs(perpendicular.x) + abs(perpendicular.y);
  float axis = dot(uv - 0.5, direction) / directionExtent + 0.5;
  float cross = dot(uv - 0.5, perpendicular) / perpendicularExtent + 0.5;
  float rawCycle = u_time * u_speed + ${options.offset.toFixed(3)};
  float cycle = fract(rawCycle);
  // Keep consecutive sweeps exactly one viewport apart so the outgoing and
  // incoming edges remain visible together at the loop boundary.
  const float loopSpan = 1.0;
  float position = cycle;
  float wave = (
      sin(cross * 6.0 + u_time * 0.46) * 0.022
    + sin(cross * 13.0 - u_time * 0.3 + 1.4) * 0.012
    + sin(cross * 21.0 + u_time * 0.2 + 2.6) * 0.005
  ) * ${options.waveAmount.toFixed(3)};
  float primaryDistance = (axis - position) - wave;
  vec3 distances = vec3(primaryDistance, primaryDistance - loopSpan, primaryDistance + loopSpan);
  vec3 bodyLayers = exp(-distances * distances * ${options.tightness.toFixed(1)});
  vec3 crestLayers = exp(-distances * distances * ${options.crestTightness.toFixed(1)});
  vec3 trailLayers = step(distances, vec3(0.0)) * exp(distances * 6.4);
  float body = min(dot(bodyLayers, vec3(1.0)), 1.0);
  float crest = min(dot(crestLayers, vec3(1.0)), 1.0);
  float trail = min(dot(trailLayers, vec3(1.0)), 1.0);
  float slope = dot(-2.0 * distances * ${options.tightness.toFixed(1)} * bodyLayers, vec3(1.0));
  vec2 normalSlope = -direction * slope * 0.2;
  vec3 normal = normalize(vec3(normalSlope, 1.0));
  vec3 halfVector = normalize(vec3(0.32, 0.48, 1.8));
  float specular = pow(max(dot(normal, halfVector), 0.0), 68.0);
  float fresnel = pow(1.0 - max(normal.z, 0.0), 2.6);
  float phase = dot(normal.xy, vec2(0.42, 0.34)) + axis * 1.22 + cross * 0.28 + u_time * 0.04;
  vec3 colour = palette(
    phase,
    ${glslVector(options.paletteA)},
    ${glslVector(options.paletteB)},
    ${glslVector(options.paletteC)},
    ${glslVector(options.paletteD)}
  );
  colour = pow(max(colour, 0.0), vec3(0.76)) * ${options.brightness.toFixed(3)};
  float easedPulse = 0.86 - 0.14 * cos(2.0 * PI * cycle);
  float temporalPulse = mix(1.0, easedPulse, ${options.pulseStrength.toFixed(3)});
  float alpha = (body * 0.29 + crest * 0.12 + trail * 0.045 + fresnel * body * 0.07) * temporalPulse;
  vec3 highlight = vec3(0.94, 0.98, 1.0) * specular * crest * 0.22 * temporalPulse;
  gl_FragColor = vec4(colour * alpha + highlight, min(alpha + specular * crest * 0.1, 0.62));
}`;
}

const pulseMovement = {
  crestTightness: 92,
  pulseStrength: 1,
  tightness: 14.5,
  waveAmount: 0.82,
} as const;

export const operatingShaderFragmentSources: Record<OperatingShaderVariant, string> = {
  subtle: subtleFragmentShader,
  prism: createSweepShader({
    brightness: 1.2,
    crestTightness: 96,
    offset: 0,
    paletteA: [0.52, 0.52, 0.52],
    paletteB: [0.5, 0.5, 0.5],
    paletteC: [1, 1, 1],
    paletteD: [0, 0.33, 0.67],
    pulseStrength: 0,
    tightness: 14,
    waveAmount: 0.9,
  }),
  pulse: createSweepShader({
    ...pulseMovement,
    brightness: 1.16,
    offset: 0.4,
    paletteA: [0.68, 0.25, 0.46],
    paletteB: [0.33, 0.24, 0.38],
    paletteC: [1, 0.82, 0.94],
    paletteD: [0.04, 0.35, 0.58],
  }),
  tide: createSweepShader({
    ...pulseMovement,
    brightness: 1.22,
    offset: 0.72,
    paletteA: [0.22, 0.54, 0.55],
    paletteB: [0.22, 0.42, 0.39],
    paletteC: [0.86, 1.02, 0.82],
    paletteD: [0.48, 0.2, 0.05],
  }),
};
