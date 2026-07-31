import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createBrowserSessionGateway } from "@browser-ui/gateway";
import { relayAgentBrowserSession } from "@browser-ui/gateway/agent-browser";

const execFileAsync = promisify(execFile);
const agentBrowser = "/opt/browser-ui/node_modules/.bin/agent-browser";
const sourceToken = required("BROWSER_UI_SOURCE_TOKEN");
const viewerToken = required("BROWSER_UI_VIEWER_TOKEN");
const allowedOrigin = required("BROWSER_UI_ALLOWED_ORIGIN");
const metadataPath = "/workspace/.browser-ui-session.json";
const gatewayOriginPath = "/workspace/.browser-ui-gateway-origin";
const cursorScriptPath = "/workspace/browser-ui-cursor.js";
const cursorPrefix = "__BROWSER_UI_AGENT_CURSOR__";
const sessionName = "browser-ui-demo";
const streamPort = 9223;
const viewport = { width: 1280, height: 800 };
const cursorScript =
  "(() => { let pending = null; let frame = 0; const emit = (x, y, pressed, typing) => { pending = { x, y, pressed, typing }; if (frame) return; frame = requestAnimationFrame(() => { frame = 0; if (!pending) return; console.debug('" +
  cursorPrefix +
  "' + JSON.stringify(pending)); pending = null; }); }; document.addEventListener('pointermove', (event) => emit(event.clientX, event.clientY, event.buttons > 0, false), true); document.addEventListener('pointerdown', (event) => emit(event.clientX, event.clientY, true, false), true); document.addEventListener('pointerup', (event) => emit(event.clientX, event.clientY, false, false), true); document.addEventListener('focusin', (event) => { const rect = event.target?.getBoundingClientRect?.(); if (rect) emit(rect.x + rect.width / 2, rect.y + rect.height / 2, false, true); }, true); })();";

let publicGatewayOrigin = "";
let source;

const command = async (...args) => {
  const result = await execFileAsync(
    agentBrowser,
    ["--session", sessionName, "--json", ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_IDLE_TIMEOUT_MS: String(10 * 60 * 1000),
        AGENT_BROWSER_STREAM_PORT: String(streamPort),
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  const envelope = JSON.parse(result.stdout.trim());
  if (envelope?.success === false) {
    throw new Error(envelope.error || "agent-browser command failed");
  }
  return envelope?.data ?? envelope;
};

const resolveStreamUrl = async () => {
  let stream = await command("stream", "status");
  if (!stream.enabled || !stream.port) {
    stream = await command("stream", "enable", "--port", String(streamPort));
  }
  if (!stream.enabled || !stream.port) {
    throw new Error("agent-browser did not expose its stream");
  }
  return `ws://127.0.0.1:${stream.port}`;
};

const agentCursorFromConsole = ({ text }) => {
  const marker = text.indexOf(cursorPrefix);
  if (marker < 0) return null;
  try {
    const value = JSON.parse(text.slice(marker + cursorPrefix.length));
    if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) return null;
    return {
      x: Math.max(0, Math.min(1, value.x / viewport.width)),
      y: Math.max(0, Math.min(1, value.y / viewport.height)),
      pressed: value.pressed === true,
      typing: value.typing === true,
      visible: true,
      variant: "dark",
      size: 32,
    };
  } catch {
    return null;
  }
};

const gateway = createBrowserSessionGateway({
  publicOrigin: () => publicGatewayOrigin,
  allowedRequestOrigins: [allowedOrigin],
  authenticate(request, action) {
    const authorization = request.headers.authorization;
    if (
      action.startsWith("source:") &&
      authorization === `Bearer ${sourceToken}`
    ) {
      return { id: "sandbox-source", kind: "service" };
    }
    if (
      action.startsWith("viewer:") &&
      authorization === `Bearer ${viewerToken}`
    ) {
      return { id: "sandbox-viewer", kind: "user" };
    }
    return null;
  },
  authorize: () => true,
  controlLeaseLifetimeMs: 15 * 60 * 1000,
  maximumBufferedBytes: 256 * 1024,
});

try {
  await new Promise((resolve, reject) => {
    gateway.server.once("error", reject);
    gateway.server.listen(8787, "0.0.0.0", resolve);
  });

  publicGatewayOrigin = await waitForGatewayOrigin();
  await writeFile(cursorScriptPath, cursorScript);
  await command("--init-script", cursorScriptPath, "open", "https://www.cloudflare.com");
  await command(
    "set",
    "viewport",
    String(viewport.width),
    String(viewport.height),
  );
  const streamUrl = await resolveStreamUrl();

  source = await relayAgentBrowserSession({
    gatewayOrigin: "http://127.0.0.1:8787",
    streamUrl,
    resolveStreamUrl,
    agentCursorFromConsole,
    title: "Sandbox browser",
    viewport,
    authorize: () => ({ authorization: `Bearer ${sourceToken}` }),
    maximumBufferedBytes: 0,
    navigate: async (direction) => {
      await command(direction);
    },
  });

  await writeFile(
    metadataPath,
    JSON.stringify({
      gatewayOrigin: publicGatewayOrigin,
      sessionId: source.session.sessionId,
      title: source.session.title,
      viewport: source.session.viewport,
    }),
  );

  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
} catch (error) {
  await writeFile(
    metadataPath,
    JSON.stringify({
      error: error instanceof Error ? error.message : "Sandbox worker failed",
    }),
  ).catch(() => undefined);
  throw error;
} finally {
  await source?.close().catch(() => undefined);
  await gateway.close().catch(() => undefined);
  await command("close").catch(() => undefined);
}

async function waitForGatewayOrigin() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const value = await readFile(gatewayOriginPath, "utf8").catch(() => "");
    if (value.trim()) return new URL(value.trim()).origin;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out while configuring the browser gateway");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
