import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

import { createBrowserSessionGateway } from "@browser-ui/gateway";
import { relayAgentBrowserSession } from "@browser-ui/gateway/agent-browser";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const agentBrowserEntry = require.resolve("agent-browser/bin/agent-browser.js");
const sessionName = `browser-ui-local-${process.pid}`;
const sourceToken = randomUUID();
const viewerToken = process.env.BROWSER_UI_VIEWER_TOKEN ?? randomUUID();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const bindHost = process.env.HOST ?? "0.0.0.0";
const lanAddress = firstLanAddress();
const publicOrigin =
  process.env.BROWSER_UI_PUBLIC_ORIGIN ??
  `http://${lanAddress ?? "127.0.0.1"}:${port}`;
const allowedRequestOrigins = (
  process.env.BROWSER_UI_ALLOWED_ORIGINS ??
  "http://localhost:55490,http://127.0.0.1:55490"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const initialUrl =
  process.env.BROWSER_UI_DEMO_URL ?? "https://www.apple.com/mac/";
let source;

const command = async (...args) => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [agentBrowserEntry, "--session", sessionName, "--json", ...args],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const envelope = JSON.parse(stdout.trim());
  if (envelope?.success === false)
    throw new Error(envelope.error ?? "agent-browser command failed");
  return envelope?.data ?? envelope;
};

const gateway = createBrowserSessionGateway({
  publicOrigin,
  allowedRequestOrigins,
  authenticate(request, action) {
    if (
      action.startsWith("source:") &&
      request.headers.authorization === `Bearer ${sourceToken}`
    ) {
      return { id: "local-source", kind: "service" };
    }
    if (
      action.startsWith("viewer:") &&
      request.headers.authorization === `Bearer ${viewerToken}`
    ) {
      return { id: "local-viewer", kind: "user" };
    }
    return null;
  },
  authorize: () => true,
});

try {
  await new Promise((resolve, reject) => {
    gateway.server.once("error", reject);
    gateway.server.listen(port, bindHost, resolve);
  });
  await command("open", initialUrl);
  await command("set", "viewport", "1280", "800");
  const stream = await command("stream", "status");
  if (!stream.enabled || !stream.port)
    throw new Error("agent-browser did not expose its stream.");
  source = await relayAgentBrowserSession({
    gatewayOrigin: `http://127.0.0.1:${port}`,
    streamUrl: `ws://127.0.0.1:${stream.port}`,
    title: "Agent browser",
    viewport: { width: 1280, height: 800 },
    authorize: () => ({ authorization: `Bearer ${sourceToken}` }),
  });
  const announcement = {
    version: 2,
    session_id: source.session.sessionId,
    gateway_origin: new URL(publicOrigin).origin,
    title: source.session.title,
    viewport: source.session.viewport,
  };
  process.stdout.write(`\nBrowser session ready.\n\n`);
  process.stdout.write(`BROWSER_UI_VIEWER_TOKEN=${viewerToken}\n\n`);
  process.stdout.write("```buzz:browser-session\n");
  process.stdout.write(`${JSON.stringify(announcement)}\n`);
  process.stdout.write("```\n\n");
  process.stdout.write(
    "Keep this process running while viewing the session.\n",
  );

  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
} finally {
  await source?.close().catch(() => undefined);
  await gateway.close().catch(() => undefined);
  await command("close").catch(() => undefined);
}

function firstLanAddress() {
  return Object.values(networkInterfaces())
    .flat()
    .find(
      (address) =>
        address?.family === "IPv4" &&
        !address.internal &&
        !address.address.startsWith("169.254."),
    )?.address;
}
