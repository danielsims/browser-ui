export const SANDBOX_PACKAGE_JSON = JSON.stringify({
  name: "browser-ui-sandbox-runtime",
  private: true,
  type: "module",
  dependencies: {
    "@browser-ui/gateway": "^0.2.0",
    "agent-browser": "0.33.1",
  },
}, null, 2);

export const SANDBOX_WORKER_SOURCE = String.raw`
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createBrowserSessionGateway } from "@browser-ui/gateway";
import { relayAgentBrowserSession } from "@browser-ui/gateway/agent-browser";

const execFileAsync = promisify(execFile);
const agentBrowser = "/vercel/sandbox/node_modules/.bin/agent-browser";
const gatewayOrigin = required("BROWSER_UI_GATEWAY_ORIGIN");
const sourceToken = required("BROWSER_UI_SOURCE_TOKEN");
const viewerToken = required("BROWSER_UI_VIEWER_TOKEN");
const metadataPath = "/vercel/sandbox/.browser-ui-session.json";
const sessionName = "browser-ui-demo";
let source;

const command = async (...args) => {
  const result = await execFileAsync(agentBrowser, [
    "--session",
    sessionName,
    "--idle-timeout",
    "10m",
    "--json",
    ...args,
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  const envelope = JSON.parse(result.stdout.trim());
  if (envelope?.success === false) {
    throw new Error(envelope.error || "agent-browser command failed");
  }
  return envelope?.data ?? envelope;
};

const gateway = createBrowserSessionGateway({
  publicOrigin: gatewayOrigin,
  authenticate(request, action) {
    const authorization = request.headers.authorization;
    if (action.startsWith("source:") && authorization === "Bearer " + sourceToken) {
      return { id: "sandbox-source", kind: "service" };
    }
    if (action.startsWith("viewer:") && authorization === "Bearer " + viewerToken) {
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

  await command("open", "https://example.com");
  await command("set", "viewport", "1280", "800");
  const stream = await command("stream", "status");
  if (!stream.enabled || !stream.port) {
    throw new Error("agent-browser did not expose its stream");
  }

  source = await relayAgentBrowserSession({
    gatewayOrigin: "http://127.0.0.1:8787",
    streamUrl: "ws://127.0.0.1:" + stream.port,
    title: "Sandbox browser",
    viewport: { width: 1280, height: 800 },
    authorize: () => ({ authorization: "Bearer " + sourceToken }),
    maximumBufferedBytes: 0,
    navigate: async (direction) => {
      await command(direction);
    },
  });

  await writeFile(metadataPath, JSON.stringify({
    sessionId: source.session.sessionId,
    title: source.session.title,
    viewport: source.session.viewport,
  }));

  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
} catch (error) {
  await writeFile(metadataPath, JSON.stringify({
    error: error instanceof Error ? error.message : "Sandbox worker failed",
  })).catch(() => undefined);
  throw error;
} finally {
  await source?.close().catch(() => undefined);
  await gateway.close().catch(() => undefined);
  await command("close").catch(() => undefined);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}
`;
