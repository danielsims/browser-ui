import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) options.set(process.argv[index], process.argv[index + 1]);

const workflowId = options.get("--workflow");
const streamUrl = options.get("--stream");
const endpoint = options.get("--endpoint") ?? "http://localhost:64947";
const outputDirectory = options.get("--output");
const framesPerSecond = Number(options.get("--fps") ?? 6);

if (!workflowId || !streamUrl || !outputDirectory || !Number.isFinite(framesPerSecond) || framesPerSecond < 1) {
  throw new Error("Usage: node capture-stream-replay.mjs --workflow <id> --stream <ws-url> --output <directory> [--endpoint <url>] [--fps <number>]");
}

const stagingDirectory = `${outputDirectory}.staging-${Date.now()}`;
const framesDirectory = join(stagingDirectory, "frames");
const events = [];
const frames = [];
let captureStartedAt = 0;
let lastFrameAt = Number.NEGATIVE_INFINITY;
let frameNumber = 0;
let completed = false;
let streamClosed = false;
const pendingWrites = new Set();

await mkdir(framesDirectory, { recursive: true });

const elapsed = () => Math.max(0, Math.round(performance.now() - captureStartedAt));
const socket = new WebSocket(streamUrl);
socket.addEventListener("message", ({ data }) => {
  const write = (async () => {
    if (!captureStartedAt || streamClosed) return;
    const payload = typeof data === "string" ? data : await data.text();
    let message;
    try { message = JSON.parse(payload); } catch { return; }
    if (message.type !== "frame") return;
    const at = elapsed();
    if (at - lastFrameAt < 1000 / framesPerSecond) return;
    lastFrameAt = at;
    const filename = `${String(frameNumber).padStart(5, "0")}.jpg`;
    frameNumber += 1;
    await writeFile(join(framesDirectory, filename), Buffer.from(message.data, "base64"));
    frames.push({ at, src: `frames/${filename}` });
  })();
  pendingWrites.add(write);
  void write.finally(() => pendingWrites.delete(write));
});
socket.addEventListener("error", () => { streamClosed = true; });

const demoToken = process.env.BROWSER_UI_DEMO_TOKEN;
if (!demoToken) throw new Error("Set BROWSER_UI_DEMO_TOKEN in both dev:live and capture processes.");
const sseResponse = await fetch(`${endpoint}/api/browser?token=${encodeURIComponent(demoToken)}`);
if (!sseResponse.body) throw new Error("The demo event stream is unavailable");
const reader = sseResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const consumeEvents = (async () => {
  while (!completed) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      const line = message.split("\n").find((candidate) => candidate.startsWith("data: "));
      if (!line) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.workflowId !== workflowId) continue;
      if (event.type === "start") captureStartedAt = performance.now();
      if (event.type === "complete" || event.type === "error") completed = true;
      if (!captureStartedAt || !["cursor", "cursor-state", "step"].includes(event.type)) continue;
      events.push({ at: elapsed(), event });
    }
  }
})();

try {
  const response = await fetch(`${endpoint}/api/browser`, {
    body: JSON.stringify({ action: "run-workflow", workflowId }),
    headers: {
      "content-type": "application/json",
      "x-browser-ui-demo-token": demoToken,
    },
    method: "POST",
  });
  if (!response.ok) throw new Error((await response.text()) || "Workflow capture failed");
  await consumeEvents;
  await Promise.all(pendingWrites);
  if (!frames.length) throw new Error("agent-browser did not emit any replay frames");
  await writeFile(join(stagingDirectory, "manifest.json"), `${JSON.stringify({ duration: elapsed(), events, frames }, null, 2)}\n`);
  await rename(stagingDirectory, outputDirectory);
  process.stdout.write(`Captured ${frames.length} frames to ${relative(process.cwd(), outputDirectory)}\n`);
} finally {
  completed = true;
  streamClosed = true;
  socket.close();
  await reader.cancel().catch(() => undefined);
  await rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined);
}
