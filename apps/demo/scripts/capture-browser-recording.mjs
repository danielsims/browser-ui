import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  options.set(process.argv[index], process.argv[index + 1]);

const workflowId = options.get("--workflow");
const endpoint = options.get("--endpoint");
const sessionId = options.get("--session");
const output = options.get("--output");

if (!workflowId || !endpoint || !sessionId || !output) {
  throw new Error(
    "Usage: node capture-browser-recording.mjs --workflow <id> --endpoint <demo-url> --session <agent-browser-session> --output <preview.mp4>",
  );
}

const outputDirectory = dirname(output);
const outputName = basename(output, ".mp4");
const stagingDirectory = join(outputDirectory, `.${outputName}-${Date.now()}`);
const stagingVideo = join(stagingDirectory, `${outputName}.mp4`);
const stagingTimeline = join(stagingDirectory, `${outputName}.timeline.json`);
const targetTimeline = join(outputDirectory, `${outputName}.timeline.json`);
const timeline = [];
const captureId = randomUUID();
let captureStartedAt = 0;
let captureActive = false;
let completed = false;
let capturedFrames = 0;
let cdp;
let encoder;
let latestFrame;
let encodedFrames = 0;
let encodeQueue = Promise.resolve();
const outputFrameRate = 24;

const elapsed = () =>
  Math.max(0, Math.round(performance.now() - captureStartedAt));
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function appendFrame(frame) {
  if (!encoder.stdin.write(frame)) await once(encoder.stdin, "drain");
  encodedFrames += 1;
}

async function holdLastFrameUntil(milliseconds) {
  if (!latestFrame) return;
  const expectedFrames = Math.round((milliseconds / 1000) * outputFrameRate);
  while (encodedFrames < expectedFrames) await appendFrame(latestFrame);
}

async function agentCommand(...args) {
  const child = spawn(
    "pnpm",
    ["exec", "agent-browser", "--session", sessionId, "--json", ...args],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];
  const errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const [code] = await once(child, "exit");
  if (code !== 0)
    throw new Error(
      Buffer.concat(errors).toString("utf8") || "agent-browser command failed",
    );
  const envelope = JSON.parse(Buffer.concat(output).toString("utf8").trim());
  if (envelope.success === false)
    throw new Error(envelope.error ?? "agent-browser command failed");
  return envelope.data;
}

await mkdir(stagingDirectory, { recursive: true });

try {
  const { cdpUrl } = await agentCommand("get", "cdp-url");
  cdp = new WebSocket(cdpUrl);
  await once(cdp, "open");
  let requestId = 0;
  const pending = new Map();
  const command = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      cdp.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  cdp.addEventListener("message", async ({ data }) => {
    const message = JSON.parse(
      typeof data === "string" ? data : await data.text(),
    );
    if (message.id) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
      return;
    }
    if (message.method !== "Page.screencastFrame") return;
    const { sessionId: frameSessionId, params } = message;
    void command(
      "Page.screencastFrameAck",
      { sessionId: params.sessionId },
      frameSessionId,
    ).catch(() => undefined);
    if (!captureActive) return;
    const capturedAt = elapsed();
    const frame = Buffer.from(params.data, "base64");
    capturedFrames += 1;
    encodeQueue = encodeQueue.then(async () => {
      await holdLastFrameUntil(capturedAt);
      latestFrame = frame;
    });
  });

  const { targetInfos } = await command("Target.getTargets");
  const target = targetInfos.find(
    (candidate) =>
      candidate.type === "page" && candidate.url.startsWith("http"),
  );
  if (!target)
    throw new Error("Could not find the active agent-browser page target");
  const { sessionId: pageSessionId } = await command("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });

  encoder = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      // Sample Chrome's variable-rate screencast on a wall-clock 24 FPS cadence.
      // Encoding every incoming frame makes the video outrun its event timeline.
      "-f",
      "image2pipe",
      "-framerate",
      "24",
      "-c:v",
      "mjpeg",
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      stagingVideo,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  await command(
    "Page.startScreencast",
    {
      format: "jpeg",
      quality: 88,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    },
    pageSessionId,
  );

  const demoToken = process.env.BROWSER_UI_DEMO_TOKEN;
  if (!demoToken)
    throw new Error(
      "Set BROWSER_UI_DEMO_TOKEN in both dev:live and capture processes.",
    );
  const eventsResponse = await fetch(
    `${endpoint}/api/browser?token=${encodeURIComponent(demoToken)}`,
  );
  if (!eventsResponse.body)
    throw new Error("The demo event stream is unavailable");
  const reader = eventsResponse.body.getReader();
  const consumeEvents = (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    let currentCursor;
    let runId;
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";
      for (const message of messages) {
        const line = message
          .split("\n")
          .find((candidate) => candidate.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.workflowId !== workflowId) continue;
        if (event.type === "start" && event.captureId === captureId) {
          runId = event.runId;
          captureStartedAt = performance.now();
          captureActive = true;
        }
        if (!captureActive || event.runId !== runId) continue;
        if (event.type === "cursor" && event.cursor) {
          currentCursor = event.cursor;
          timeline.push({ at: elapsed(), agentCursor: currentCursor });
        }
        if (event.type === "cursor-state" && currentCursor) {
          currentCursor = {
            ...currentCursor,
            pressed: event.pressed,
            typing: event.typing,
          };
          timeline.push({ at: elapsed(), agentCursor: currentCursor });
        }
        if (event.type === "step" && event.label)
          timeline.push({ at: elapsed(), operatingLabel: event.label });
        if (event.type === "complete" || event.type === "error") {
          completed = true;
          captureActive = false;
        }
      }
    }
  })();

  const response = await fetch(`${endpoint}/api/browser`, {
    body: JSON.stringify({ action: "run-workflow", workflowId, captureId }),
    headers: {
      "content-type": "application/json",
      "x-browser-ui-demo-token": demoToken,
    },
    method: "POST",
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Workflow capture failed");
  await consumeEvents;
  await reader.cancel().catch(() => undefined);
  await wait(250);
  await encodeQueue;
  await holdLastFrameUntil(elapsed());
  await command("Page.stopScreencast", {}, pageSessionId);
  encoder.stdin.end();
  const [encoderExitCode] = await once(encoder, "exit");
  if (encoderExitCode !== 0)
    throw new Error("ffmpeg could not encode the browser recording");
  if (!capturedFrames)
    throw new Error("Chrome did not produce any screencast frames");
  await writeFile(stagingTimeline, `${JSON.stringify(timeline, null, 2)}\n`);
  await rename(stagingVideo, output);
  await rename(stagingTimeline, targetTimeline);
  process.stdout.write(
    `Captured ${capturedFrames} real Chrome frames to ${output}\n`,
  );
} finally {
  cdp?.close();
  await rm(stagingDirectory, { recursive: true, force: true });
}
