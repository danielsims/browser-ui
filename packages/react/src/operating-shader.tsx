"use client";

import { memo, useEffect, useRef } from "react";
import {
  operatingShaderDirectionIds,
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeedIds,
  operatingShaderSpeeds,
  operatingShaderVariants,
  operatingShaderVertexSource,
  type OperatingShaderDirection,
  type OperatingShaderSpeed,
  type OperatingShaderVariant,
} from "@browser-ui/shaders";

export const browserOperatingShaderVariants = operatingShaderVariants;
export type BrowserOperatingShaderVariant = OperatingShaderVariant;
export const browserOperatingShaderDirections = operatingShaderDirectionIds;
export type BrowserOperatingShaderDirection = OperatingShaderDirection;
export const browserOperatingShaderSpeeds = operatingShaderSpeedIds;
export type BrowserOperatingShaderSpeed = OperatingShaderSpeed;

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
  const meta = operatingShaderMeta[variant];
  const fragmentSource = operatingShaderFragmentSources[variant];
  const resolvedDirection = direction ?? meta.defaultDirection;
  const resolvedSpeed = speed ?? meta.defaultSpeed;
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

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, operatingShaderVertexSource);
    if (!vertexShader) return;
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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
        const [directionX, directionY] = operatingShaderDirections[directionRef.current].vector;
        gl.uniform2f(directionUniform, directionX, directionY);
      }
      if (speedUniform !== null) {
        gl.uniform1f(speedUniform, 1 / operatingShaderSpeeds[speedRef.current].durationSeconds);
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
  }, [fragmentSource]);

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
