/**
 * The operating overlay injected *into* the WebView page.
 *
 * A native `WKWebView` composes above its React Native siblings on iOS, so an
 * RN overlay painted after the WebView can sit behind the page. Instead, the
 * overlay lives in the page: a fixed, maximum z-index container runs the
 * canonical `@browser-ui/shaders` operating shader on a WebGL canvas, with the
 * action pill and agent cursor as DOM nodes.
 *
 * It is a 1:1 port of the React package's overlay: the same class names, the
 * same DOM structure, and the same stylesheet (generated from
 * `packages/react/src/styles.css` into `@browser-ui/core`), so the two platforms
 * render identically and cannot drift. The scripts are idempotent: the install
 * form compiles the GLSL once and exposes `window.__browserUiOverlay.update`;
 * the update form pushes new state without resending the sources.
 */
import type {
  OperatingShaderDirection,
  OperatingShaderSpeed,
  OperatingShaderVariant,
} from "@browser-ui/shaders";
import { agentCursorPath, agentOverlayCss } from "@browser-ui/core";
import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVertexSource,
} from "@browser-ui/shaders";

import type { WebViewBrowserCursor } from "./driver";
import type { OperatingShaderConfig } from "./shader";

const OVERLAY_GLOBAL = "__browserUiOverlay";
const OVERLAY_VERSION = 3;

/** Shader selection with the variant defaults already resolved. */
export interface ResolvedOperatingShader {
  variant: OperatingShaderVariant;
  direction: OperatingShaderDirection;
  speed: OperatingShaderSpeed;
}

/** Everything the in-page overlay needs to paint one frame of agent state. */
export interface InPageOverlayConfig {
  operating: boolean;
  label: string;
  shader: ResolvedOperatingShader;
  cursor: WebViewBrowserCursor | null;
}

/** Resolve a shader config against the variant's declared defaults. */
export function resolveOperatingShader(
  config?: OperatingShaderConfig,
): ResolvedOperatingShader {
  const variant = config?.variant ?? "subtle";
  const meta = operatingShaderMeta[variant];
  return {
    variant,
    direction: config?.direction ?? meta.defaultDirection,
    speed: config?.speed ?? meta.defaultSpeed,
  };
}

const DIRECTION_VECTORS = JSON.stringify(
  Object.fromEntries(
    Object.entries(operatingShaderDirections).map(([id, definition]) => [
      id,
      definition.vector,
    ]),
  ),
);

const SPEED_DURATIONS = JSON.stringify(
  Object.fromEntries(
    Object.entries(operatingShaderSpeeds).map(([id, definition]) => [
      id,
      definition.durationSeconds,
    ]),
  ),
);

const VERTEX_SOURCE = JSON.stringify(operatingShaderVertexSource);
const FRAGMENT_SOURCES = JSON.stringify(operatingShaderFragmentSources);

/**
 * Build the idempotent install script. The first injection creates the overlay
 * and compiles the shader; later calls (after navigation, or from a busy page)
 * just re-apply `config` to the existing nodes.
 */
export function buildOverlayInstallScript(config: InPageOverlayConfig): string {
  return `(function () {
  var ID = "browser-ui-overlay";
  var config = ${JSON.stringify(config)};
  var overlayCss = ${JSON.stringify(agentOverlayCss)};
  var cursorPath = ${JSON.stringify(agentCursorPath)};
  var vertexSource = ${VERTEX_SOURCE};
  var fragmentSources = ${FRAGMENT_SOURCES};
  var directionVectors = ${DIRECTION_VECTORS};
  var speedDurations = ${SPEED_DURATIONS};

  var api = window.${OVERLAY_GLOBAL};
  if (api && api.version === ${OVERLAY_VERSION}) {
    api.update(config);
    return;
  }
  api = window.${OVERLAY_GLOBAL} = { version: ${OVERLAY_VERSION} };

  function style(node, values) {
    for (var key in values) node.style[key] = values[key];
  }
  function element(tag, values, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (values) style(node, values);
    return node;
  }
  function clamp01(value) {
    return Math.max(0, Math.min(1, typeof value === "number" ? value : 0));
  }
  function svgPath(d, className) {
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", className);
    return path;
  }

  var sheet = document.getElementById(ID + "-style");
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = ID + "-style";
    // The exact React stylesheet, generated into @browser-ui/core.
    sheet.textContent = overlayCss;
  }

  var root = document.getElementById(ID);
  if (!root) {
    root = element("div", {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      zIndex: "2147483647",
      // The stylesheet sets pointer-events:auto for the take-control overlay;
      // in-page we never want to eat the user's taps.
      pointerEvents: "none",
      overflow: "hidden"
    }, "bui-operating-overlay");
    root.id = ID;
    // The overlay lives inside the site's document, so without this the pill
    // inherits the page's font (often a serif). Force the platform UI stack.
    root.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    root.style.fontSynthesis = "none";

    root.appendChild(element("div", null, "bui-operating-fallback"));

    var canvas = element("canvas", null, "bui-operating-shader");
    canvas.id = ID + "-canvas";
    root.appendChild(canvas);

    var status = element("div", {
      pointerEvents: "none"
    }, "bui-operating-status");
    var shimmer = element("span", null, "bui-operating-shimmer");
    shimmer.setAttribute("role", "status");
    shimmer.id = ID + "-pill-text";
    status.appendChild(shimmer);
    root.appendChild(status);

    var cursor = element("div", {
      opacity: "0",
      pointerEvents: "none"
    }, "bui-agent-cursor");
    cursor.id = ID + "-cursor";
    cursor.appendChild(element("span", null, "bui-agent-cursor-glow"));
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.appendChild(svgPath(cursorPath, "bui-agent-cursor-outline"));
    svg.appendChild(svgPath(cursorPath, "bui-agent-cursor-fill"));
    cursor.appendChild(svg);
    var cursorLabel = element("span", {
      display: "none"
    }, "bui-agent-cursor-label");
    cursorLabel.id = ID + "-cursor-label";
    cursor.appendChild(cursorLabel);
    root.appendChild(cursor);

    if (document.documentElement) {
      document.documentElement.appendChild(sheet);
      document.documentElement.appendChild(root);
    }
    logInstall();
  }

  function logInstall() {
    if (api.installLogged) return;
    api.installLogged = true;
    console.log("[browser-ui] overlay installed");
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          browserUi: "overlay"
        }));
      }
    } catch (error) {}
  }

  var canvas = document.getElementById(ID + "-canvas");
  var cursor = document.getElementById(ID + "-cursor");
  var cursorLabel = document.getElementById(ID + "-cursor-label");

  api.root = root;
  api.canvas = canvas;
  api.cursor = cursor;
  api.pillText = document.getElementById(ID + "-pill-text");
  api.cursorLabel = cursorLabel;

  // The pill must survive a shader failure, so it is built and shown
  // independently of everything WebGL below.
  function logShader(ok, detail) {
    if (api.shaderLogged) return;
    api.shaderLogged = true;
    var message = "[browser-ui] shader " + (ok ? "ok" : "err") + " " + detail;
    if (ok) console.log(message);
    else console.warn(message);
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          browserUi: "shader",
          ok: ok,
          detail: String(detail)
        }));
      }
    } catch (error) {}
  }

  if (!api.gl) {
    try {
      api.gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: "low-power"
      });
    } catch (error) {
      api.gl = null;
      api.lastShaderError = String((error && error.message) || error);
    }
  }

  function compile(type, source) {
    var gl = api.gl;
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    api.lastShaderError = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    return null;
  }

  function buildProgram(variant) {
    var gl = api.gl;
    if (!gl) return null;
    var vertex = compile(gl.VERTEX_SHADER, vertexSource);
    if (!vertex) return null;
    var fragment = compile(gl.FRAGMENT_SHADER, fragmentSources[variant]);
    if (!fragment) {
      gl.deleteShader(vertex);
      return null;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      api.lastShaderError = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return null;
    }
    var position = gl.getAttribLocation(program, "a_position");
    var resolution = gl.getUniformLocation(program, "u_resolution");
    var time = gl.getUniformLocation(program, "u_time");
    var direction = gl.getUniformLocation(program, "u_direction");
    var speed = gl.getUniformLocation(program, "u_speed");
    var buffer = gl.createBuffer();
    if (position < 0 || resolution === null || time === null) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return null;
    }
    // One oversized triangle covers the viewport, matching the web renderer.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    return {
      program: program,
      vertex: vertex,
      fragment: fragment,
      buffer: buffer,
      resolution: resolution,
      time: time,
      direction: direction,
      speed: speed,
      variant: variant
    };
  }

  api.program = null;
  function disposeProgram() {
    var gl = api.gl;
    if (!gl || !api.program) return;
    gl.deleteBuffer(api.program.buffer);
    gl.deleteProgram(api.program.program);
    gl.deleteShader(api.program.vertex);
    gl.deleteShader(api.program.fragment);
    api.program = null;
  }
  function ensureProgram(variant) {
    if (!api.gl) {
      logShader(false, "no WebGL context");
      return false;
    }
    if (api.program && api.program.variant === variant) return true;
    disposeProgram();
    api.program = buildProgram(variant);
    if (!api.program) logShader(false, api.lastShaderError || variant);
    else logShader(true, variant);
    return api.program !== null;
  }
  api.frame = 0;
  api.startedAt = 0;
  function draw(timestamp) {
    var gl = api.gl;
    var program = api.program;
    if (!gl || !program || !config.operating) {
      api.frame = 0;
      return;
    }
    api.frame = requestAnimationFrame(draw);
    if (!api.startedAt) api.startedAt = timestamp;
    var rect = canvas.getBoundingClientRect();
    var scale = Math.min(window.devicePixelRatio || 1, 1.35);
    var width = Math.max(1, Math.round(rect.width * scale));
    var height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(program.resolution, canvas.width, canvas.height);
    gl.uniform1f(program.time, (timestamp - api.startedAt) / 1000);
    var vector = directionVectors[config.shader.direction] || directionVectors["left-to-right"];
    gl.uniform2f(program.direction, vector[0], vector[1]);
    gl.uniform1f(program.speed, 1 / (speedDurations[config.shader.speed] || 15));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function startShader() {
    if (api.frame || !api.program || !config.operating) return;
    api.startedAt = 0;
    api.frame = requestAnimationFrame(draw);
  }
  function stopShader() {
    if (!api.frame) return;
    cancelAnimationFrame(api.frame);
    api.frame = 0;
  }

  function applyCursor(state) {
    if (!state || state.visible === false) {
      cursor.classList.remove("bui-agent-cursor--visible");
      return;
    }
    var size = typeof state.size === "number" && state.size > 0 ? state.size : 32;
    cursor.style.setProperty("--bui-agent-cursor-x", clamp01(state.x) * 100 + "%");
    cursor.style.setProperty("--bui-agent-cursor-y", clamp01(state.y) * 100 + "%");
    cursor.style.setProperty("--bui-agent-cursor-size", size + "px");
    if (state.backgroundColor) {
      cursor.style.setProperty("--bui-agent-cursor-background", state.backgroundColor);
    }
    cursor.style.setProperty(
      "--bui-agent-cursor-glow-offset",
      size <= 32 ? "-3%" : size <= 64 ? "-2%" : "0%"
    );
    cursor.classList.toggle("bui-agent-cursor--light", state.variant === "light");
    cursor.classList.toggle("bui-agent-cursor--dark", state.variant !== "light");
    cursor.classList.toggle("bui-agent-cursor--pressed", Boolean(state.pressed));
    cursor.classList.toggle("bui-agent-cursor--typing", Boolean(state.typing));
    cursor.classList.add("bui-agent-cursor--visible");
    var label = state.label || "";
    if (cursorLabel) {
      cursorLabel.textContent = label;
      cursorLabel.style.display = label ? "" : "none";
    }
  }

  function ensureAttached() {
    var parent = document.documentElement;
    if (!parent) return;
    if (sheet.parentNode !== parent) parent.appendChild(sheet);
    if (root.parentNode !== parent) parent.appendChild(root);
  }

  api.update = function (next) {
    config = next;
    root.style.display = config.operating ? "block" : "none";
    root.setAttribute("data-shader-variant", config.shader.variant);
    if (api.pillText) api.pillText.textContent = config.label || "";
    applyCursor(config.cursor);
    if (config.operating && ensureProgram(config.shader.variant)) startShader();
    else stopShader();
    ensureAttached();
  };

  // Re-assert the overlay if a page or framework swap replaces the DOM. The
  // observer watches the document root, so it survives a replaced <body>.
  if (!api.observer && typeof MutationObserver !== "undefined") {
    api.observer = new MutationObserver(function () { ensureAttached(); });
    api.observer.observe(document.documentElement, { childList: true });
  }
  if (!api.visibilityBound) {
    api.visibilityBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopShader();
      else if (config.operating) startShader();
    });
  }

  ensureAttached();
  api.update(config);
})();true;`;
}

/** Build a small script that pushes new overlay state without resending GLSL. */
export function buildOverlayUpdateScript(config: InPageOverlayConfig): string {
  return `(function(){var api=window.${OVERLAY_GLOBAL};if(api&&api.update){api.update(${JSON.stringify(config)});}})();true;`;
}
