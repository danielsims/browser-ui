"use client";

import { memo, useEffect, useRef } from "react";

export const browserOperatingShaderVariants = ["subtle", "prism", "pulse", "tide"] as const;
export type BrowserOperatingShaderVariant = (typeof browserOperatingShaderVariants)[number];

export const browserOperatingShaderDirections = [
  "left-to-right",
  "right-to-left",
  "top-to-bottom",
  "bottom-to-top",
  "top-left-to-bottom-right",
  "top-right-to-bottom-left",
  "bottom-left-to-top-right",
  "bottom-right-to-top-left",
] as const;
export type BrowserOperatingShaderDirection = (typeof browserOperatingShaderDirections)[number];

export const browserOperatingShaderSpeeds = ["slow", "fast"] as const;
export type BrowserOperatingShaderSpeed = (typeof browserOperatingShaderSpeeds)[number];

export interface BrowserOperatingShaderOptions {
  /** Visual treatment. The existing Browser UI shader remains the default. */
  variant?: BrowserOperatingShaderVariant;
  /** Sweep direction for Prism, Pulse, and Tide. */
  direction?: BrowserOperatingShaderDirection;
  /** Slow is a 15-second cycle; fast is a 7-second cycle. */
  speed?: BrowserOperatingShaderSpeed;
}

export interface BrowserOperatingShaderProps extends BrowserOperatingShaderOptions {
  className?: string;
}

type DirectionVector = readonly [x: number, y: number];
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

interface ShaderDefinition {
  defaultDirection: BrowserOperatingShaderDirection;
  defaultSpeed: BrowserOperatingShaderSpeed;
  fragmentShader: string;
}

const directionVectors: Record<BrowserOperatingShaderDirection, DirectionVector> = {
  "left-to-right": [1, 0],
  "right-to-left": [-1, 0],
  "top-to-bottom": [0, -1],
  "bottom-to-top": [0, 1],
  "top-left-to-bottom-right": [1, -1],
  "top-right-to-bottom-left": [-1, -1],
  "bottom-left-to-top-right": [1, 1],
  "bottom-right-to-top-left": [-1, 1],
};

const speedDurations: Record<BrowserOperatingShaderSpeed, number> = {
  slow: 15,
  fast: 7,
};

const vertexShaderSource = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

// The original Browser UI shader is intentionally preserved as the default.
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

const sweepShaderPreamble = `
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

function glslVector(vector: ColourVector) {
  return `vec3(${vector.map((value) => value.toFixed(3)).join(", ")})`;
}

function createSweepShader(options: SweepShaderOptions) {
  return `${sweepShaderPreamble}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 direction = normalize(u_direction);
  vec2 perpendicular = vec2(-direction.y, direction.x);
  float directionExtent = abs(direction.x) + abs(direction.y);
  float perpendicularExtent = abs(perpendicular.x) + abs(perpendicular.y);
  float axis = dot(uv - 0.5, direction) / directionExtent + 0.5;
  float cross = dot(uv - 0.5, perpendicular) / perpendicularExtent + 0.5;
  float cycle = fract(u_time * u_speed + ${options.offset.toFixed(3)});
  float position = cycle;
  float wave = (
      sin(cross * 6.0 + u_time * 0.46) * 0.022
    + sin(cross * 13.0 - u_time * 0.3 + 1.4) * 0.012
    + sin(cross * 21.0 + u_time * 0.2 + 2.6) * 0.005
  ) * ${options.waveAmount.toFixed(3)};
  float primaryDistance = (axis - position) - wave;
  // Wrapped copies remain exactly one viewport apart, keeping both edges
  // softly present through the loop boundary instead of exposing a dead gap.
  vec3 distances = vec3(primaryDistance, primaryDistance - 1.0, primaryDistance + 1.0);
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

const shaderDefinitions: Record<BrowserOperatingShaderVariant, ShaderDefinition> = {
  subtle: {
    defaultDirection: "left-to-right",
    defaultSpeed: "slow",
    fragmentShader: subtleFragmentShader,
  },
  prism: {
    defaultDirection: "left-to-right",
    defaultSpeed: "slow",
    fragmentShader: createSweepShader({
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
  },
  pulse: {
    defaultDirection: "left-to-right",
    defaultSpeed: "fast",
    fragmentShader: createSweepShader({
      ...pulseMovement,
      brightness: 1.16,
      offset: 0.4,
      paletteA: [0.68, 0.25, 0.46],
      paletteB: [0.33, 0.24, 0.38],
      paletteC: [1, 0.82, 0.94],
      paletteD: [0.04, 0.35, 0.58],
    }),
  },
  tide: {
    defaultDirection: "top-left-to-bottom-right",
    defaultSpeed: "fast",
    fragmentShader: createSweepShader({
      ...pulseMovement,
      brightness: 1.22,
      offset: 0.72,
      paletteA: [0.22, 0.54, 0.55],
      paletteB: [0.22, 0.42, 0.39],
      paletteC: [0.86, 1.02, 0.82],
      paletteD: [0.48, 0.2, 0.05],
    }),
  },
};

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("Browser UI operating shader compile error", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

export const BrowserOperatingShader = memo(function BrowserOperatingShader({
  className,
  direction,
  speed,
  variant = "subtle",
}: BrowserOperatingShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const definition = shaderDefinitions[variant];
  const resolvedDirection = direction ?? definition.defaultDirection;
  const resolvedSpeed = speed ?? definition.defaultSpeed;
  const directionRef = useRef(resolvedDirection);
  const redrawRef = useRef<() => void>(() => undefined);
  const speedRef = useRef(resolvedSpeed);
  directionRef.current = resolvedDirection;
  speedRef.current = resolvedSpeed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    if (!vertexShader) return;
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, definition.fragmentShader);
    if (!fragmentShader) {
      gl.deleteShader(vertexShader);
      return;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("Browser UI operating shader link error", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    const position = gl.getAttribLocation(program, "a_position");
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const directionUniform = gl.getUniformLocation(program, "u_direction");
    const speedUniform = gl.getUniformLocation(program, "u_speed");
    const buffer = gl.createBuffer();
    if (position < 0 || resolution === null || time === null || !buffer) {
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let startedAt = 0;
    let visible = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 1.35);
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };

    const draw = (timestamp: number) => {
      if (!startedAt) startedAt = timestamp;
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, reducedMotion.matches ? 5 : (timestamp - startedAt) / 1_000);
      if (directionUniform !== null) {
        const [directionX, directionY] = directionVectors[directionRef.current];
        gl.uniform2f(directionUniform, directionX, directionY);
      }
      if (speedUniform !== null) {
        gl.uniform1f(speedUniform, 1 / speedDurations[speedRef.current]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reducedMotion.matches && visible && !document.hidden) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const redraw = () => {
      cancelAnimationFrame(animationFrame);
      if (visible && !document.hidden) animationFrame = requestAnimationFrame(draw);
    };
    redrawRef.current = redraw;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redraw);
    const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      redraw();
    }, { rootMargin: "120px" });
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener("resize", redraw);
    intersectionObserver?.observe(canvas);
    reducedMotion.addEventListener("change", redraw);
    document.addEventListener("visibilitychange", redraw);
    redraw();

    return () => {
      redrawRef.current = () => undefined;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", redraw);
      intersectionObserver?.disconnect();
      reducedMotion.removeEventListener("change", redraw);
      document.removeEventListener("visibilitychange", redraw);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, [definition.fragmentShader]);

  useEffect(() => {
    redrawRef.current();
  }, [resolvedDirection, resolvedSpeed]);

  return <canvas
    aria-hidden
    className={["bui-operating-shader", className].filter(Boolean).join(" ")}
    data-direction={resolvedDirection}
    data-speed={resolvedSpeed}
    data-variant={variant}
    ref={canvasRef}
  />;
});
