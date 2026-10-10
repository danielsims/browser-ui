import type { ExpoWebGLRenderingContext, GLView } from "expo-gl";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";

import type {
  OperatingShaderDirection,
  OperatingShaderSpeed,
  OperatingShaderVariant,
} from "@browser-ui/shaders";
import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVertexSource,
} from "@browser-ui/shaders";

type ExpoGLView = typeof GLView;

/** Operating shader selection, mirroring the web package's prop shape. */
export interface OperatingShaderConfig {
  variant?: OperatingShaderVariant;
  direction?: OperatingShaderDirection;
  speed?: OperatingShaderSpeed;
}

function compileShader(
  gl: ExpoWebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn(
    "Browser UI operating shader compile error",
    gl.getShaderInfoLog(shader),
  );
  gl.deleteShader(shader);
  return null;
}

/**
 * Compile the canonical Browser UI shader for `variant` and paint it across the
 * whole surface. Returns a disposer, or `null` if the GL surface cannot run the
 * shader so the caller can fall back to the `Animated` overlay.
 */
function startShader(
  gl: ExpoWebGLRenderingContext,
  variant: OperatingShaderVariant,
  directionRef: RefObject<OperatingShaderDirection>,
  speedRef: RefObject<OperatingShaderSpeed>,
): (() => void) | null {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    operatingShaderVertexSource,
  );
  if (!vertexShader) return null;
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    operatingShaderFragmentSources[variant],
  );
  if (!fragmentShader) {
    gl.deleteShader(vertexShader);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(
      "Browser UI operating shader link error",
      gl.getProgramInfoLog(program),
    );
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  const position = gl.getAttribLocation(program, "a_position");
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const time = gl.getUniformLocation(program, "u_time");
  const directionUniform = gl.getUniformLocation(program, "u_direction");
  const speedUniform = gl.getUniformLocation(program, "u_speed");
  const buffer = gl.createBuffer();
  if (position < 0 || resolution === null || time === null) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  // One oversized triangle covers the viewport, matching the web renderer.
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.useProgram(program);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  let animationFrame = 0;
  let startedAt = 0;
  let running = true;

  const draw = (timestamp: number) => {
    if (!running) return;
    if (!startedAt) startedAt = timestamp;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(resolution, width, height);
    gl.uniform1f(time, (timestamp - startedAt) / 1_000);
    if (directionUniform !== null) {
      const [directionX, directionY] =
        operatingShaderDirections[directionRef.current].vector;
      gl.uniform2f(directionUniform, directionX, directionY);
    }
    if (speedUniform !== null) {
      gl.uniform1f(
        speedUniform,
        1 / operatingShaderSpeeds[speedRef.current].durationSeconds,
      );
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.endFrameEXP();
    animationFrame = requestAnimationFrame(draw);
  };
  animationFrame = requestAnimationFrame(draw);

  return () => {
    running = false;
    cancelAnimationFrame(animationFrame);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  };
}

/**
 * The Browser UI operating shader on an `expo-gl` surface. Loads `expo-gl`
 * lazily so it stays an optional peer, and reports back if the module or the
 * shader cannot start.
 */
export function ShaderLayer({
  config,
  onUnavailable,
}: {
  config: OperatingShaderConfig;
  onUnavailable: () => void;
}) {
  const [GLViewComponent, setGLViewComponent] = useState<ExpoGLView | null>(
    null,
  );
  const onUnavailableRef = useRef(onUnavailable);
  const variant = config.variant ?? "subtle";
  const meta = operatingShaderMeta[variant];
  const direction = config.direction ?? meta.defaultDirection;
  const speed = config.speed ?? meta.defaultSpeed;
  const directionRef = useRef(direction);
  const speedRef = useRef(speed);
  const contextRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    directionRef.current = direction;
    speedRef.current = speed;
  }, [direction, speed]);

  useEffect(() => {
    let cancelled = false;
    void import("expo-gl").then(
      (module) => {
        if (!cancelled) setGLViewComponent(() => module.GLView);
      },
      () => {
        if (!cancelled) onUnavailableRef.current();
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Recompile when the variant changes after the context exists; direction and
  // speed keep updating through their refs without a rebuild.
  useEffect(() => {
    const gl = contextRef.current;
    if (!gl) return;
    disposeRef.current?.();
    disposeRef.current = startShader(gl, variant, directionRef, speedRef);
    if (!disposeRef.current) onUnavailableRef.current();
  }, [variant]);

  useEffect(
    () => () => {
      disposeRef.current?.();
      disposeRef.current = null;
    },
    [],
  );

  if (!GLViewComponent) return null;
  return (
    <GLViewComponent
      onContextCreate={(gl) => {
        contextRef.current = gl;
        disposeRef.current = startShader(gl, variant, directionRef, speedRef);
        if (!disposeRef.current) onUnavailableRef.current();
      }}
      style={styles.fill}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});
