import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import { createBrowserSessionGateway } from "@browser-ui/gateway";
import { decodeBrowserSessionBinaryFrame } from "@browser-ui/core";
import { relayAgentBrowserSession } from "@browser-ui/gateway/agent-browser";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const agentBrowserEntry = require.resolve("agent-browser/bin/agent-browser.js");
const sessionName = `browser-ui-benchmark-${process.pid}`;
const durationMs = Number.parseInt(process.env.BROWSER_UI_BENCHMARK_MS ?? "10000", 10);
const sourceToken = randomUUID();
const viewerToken = randomUUID();
let source;
let gateway;
let pageServer;
let viewer;

const command = async (...args) => {
  const { stdout } = await execFileAsync(process.execPath, [
    agentBrowserEntry,
    "--session",
    sessionName,
    "--json",
    ...args,
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  const envelope = JSON.parse(stdout.trim());
  if (envelope?.success === false) throw new Error(envelope.error ?? "agent-browser command failed");
  return envelope?.data ?? envelope;
};

try {
  pageServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080b12;color:white;font:600 64px system-ui}
      body{display:grid;place-items:center}
      #orb{position:absolute;width:320px;height:320px;border-radius:50%;filter:blur(12px);background:linear-gradient(135deg,#67e8f9,#8b5cf6,#f43f5e)}
      #count{position:relative;text-shadow:0 2px 20px #000}
    </style><div id="orb"></div><div id="count">0</div><script>
      const start=performance.now(),orb=document.querySelector('#orb'),count=document.querySelector('#count');
      function frame(now){const t=(now-start)/1000;orb.style.transform='translate('+Math.sin(t*2.3)*360+'px,'+Math.cos(t*1.7)*180+'px) rotate('+t*90+'deg)';count.textContent=Math.floor(t*1000);requestAnimationFrame(frame)}requestAnimationFrame(frame)
    </script>`);
  });
  await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
  const pageAddress = pageServer.address();
  if (!pageAddress || typeof pageAddress === "string") throw new Error("Failed to start benchmark page.");

  await command("open", `http://127.0.0.1:${pageAddress.port}`);
  await command("set", "viewport", "1280", "800");
  const stream = await command("stream", "status");
  if (!stream.enabled || !stream.port) throw new Error("agent-browser did not expose its stream.");

  let gatewayOrigin = "http://127.0.0.1";
  gateway = createBrowserSessionGateway({
    publicOrigin: () => gatewayOrigin,
    authenticate(request, action) {
      if (action.startsWith("source:") && request.headers.authorization === `Bearer ${sourceToken}`) {
        return { id: "benchmark-source", kind: "service" };
      }
      if (action === "viewer:observe" && request.headers.authorization === `Bearer ${viewerToken}`) {
        return { id: "benchmark-viewer", kind: "user" };
      }
      return null;
    },
    authorize: () => true,
  });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const gatewayAddress = gateway.server.address();
  if (!gatewayAddress || typeof gatewayAddress === "string") throw new Error("Failed to start gateway.");
  gatewayOrigin = `http://127.0.0.1:${gatewayAddress.port}`;

  source = await relayAgentBrowserSession({
    gatewayOrigin,
    streamUrl: `ws://127.0.0.1:${stream.port}`,
    title: "Live transport benchmark",
    viewport: { width: 1280, height: 800 },
    authorize: () => ({ authorization: `Bearer ${sourceToken}` }),
  });
  const connectionResponse = await fetch(
    `${gatewayOrigin}/v1/sessions/${source.session.sessionId}/connections`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${viewerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        intent: "observe",
        clientInstanceId: "benchmark_viewer",
        frameEncodings: ["binary-jpeg"],
      }),
    },
  );
  if (!connectionResponse.ok) throw new Error(`Viewer resolution failed: ${connectionResponse.status}`);
  const resolution = await connectionResponse.json();
  viewer = new WebSocket(resolution.connection.url, resolution.connection.protocols, {
    perMessageDeflate: false,
  });
  await new Promise((resolve, reject) => {
    viewer.once("open", resolve);
    viewer.once("error", reject);
  });

  const ages = [];
  const sizes = [];
  const sequences = [];
  viewer.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const frame = decodeBrowserSessionBinaryFrame(data);
    if (!frame) return;
    ages.push(Math.max(0, Date.now() - frame.header.capturedAt));
    sizes.push(frame.jpeg.byteLength);
    sequences.push(frame.header.frameSequence);
  });
  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const elapsedMs = Date.now() - startedAt;
  if (sequences.length < 2) throw new Error("Benchmark did not receive enough frames.");
  for (let index = 1; index < sequences.length; index += 1) {
    if (sequences[index] <= sequences[index - 1]) throw new Error("Frame sequence regressed.");
  }
  const report = {
    durationMs: elapsedMs,
    frames: sequences.length,
    framesPerSecond: round(sequences.length / (elapsedMs / 1000)),
    frameAgeMs: summary(ages),
    jpegBytes: summary(sizes),
    source: source.getMetrics(),
    gateway: gateway.getMetrics(),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  viewer?.close();
  await source?.close().catch(() => undefined);
  await gateway?.close().catch(() => undefined);
  if (pageServer?.listening) await new Promise((resolve) => pageServer.close(resolve));
  await command("close").catch(() => undefined);
}

function summary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
    average: round(sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length)),
  };
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
