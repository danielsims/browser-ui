"use client";

import { useEffect, useRef } from "react";

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
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

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
  return shader;
}

export function BrowserOperatingShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) return;
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertexShader || !fragmentShader || !program) return;
    gl.attachShader(program, vertexShader); gl.attachShader(program, fragmentShader); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    const position = gl.getAttribLocation(program, "a_position");
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const buffer = gl.createBuffer();
    if (position < 0 || !resolution || !time || !buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0; let startedAt = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(rect.width * scale)); const height = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    };
    const draw = (timestamp: number) => {
      if (!startedAt) startedAt = timestamp; resize(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(resolution, canvas.width, canvas.height); gl.uniform1f(time, reducedMotion.matches ? 4 : (timestamp - startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3); if (!reducedMotion.matches) animationFrame = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(animationFrame); startedAt = 0; animationFrame = requestAnimationFrame(draw); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(restart);
    observer?.observe(canvas); reducedMotion.addEventListener("change", restart); restart();
    return () => { cancelAnimationFrame(animationFrame); observer?.disconnect(); reducedMotion.removeEventListener("change", restart); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader); };
  }, []);
  return <canvas ref={canvasRef} aria-hidden className="bui-operating-shader" />;
}

export interface BrowserOperatingOverlayProps {
  label?: string;
  onTakeControl?: () => void;
  takeControlLabel?: string;
}

export function BrowserOperatingOverlay({
  label = "Agent is operating this browser",
  onTakeControl,
  takeControlLabel = "Take control",
}: BrowserOperatingOverlayProps) {
  return <div
    aria-label={onTakeControl ? takeControlLabel : undefined}
    className="bui-operating-overlay"
    onClick={onTakeControl}
    onKeyDown={(event) => {
      if (!onTakeControl || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onTakeControl();
    }}
    role={onTakeControl ? "button" : undefined}
    tabIndex={onTakeControl ? 0 : undefined}
  >
    <div aria-hidden className="bui-operating-fallback" />
    <BrowserOperatingShader />
    <div className="bui-operating-status">
      <span className="bui-operating-shimmer" role="status">{label}</span>
    </div>
  </div>;
}
