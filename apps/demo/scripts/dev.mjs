import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const agentBrowserEntry = require.resolve("agent-browser/bin/agent-browser.js");
const sessionId = process.env.AGENT_BROWSER_SESSION_ID ?? `browser-ui-demo-${process.pid}`;
const demoToken = process.env.BROWSER_UI_DEMO_TOKEN ?? randomUUID();
const sessionDirectory = await mkdtemp(join(tmpdir(), "browser-ui-demo-"));
const initialUrl = process.env.BROWSER_UI_DEMO_URL ?? "https://www.apple.com/mac/";
const port = Number.parseInt(process.env.BROWSER_UI_DEMO_PORT ?? process.env.PORT ?? "3000", 10);
const localDevelopmentOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address?.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const command = async (...args) => {
  const { stdout } = await execFileAsync(process.execPath, [
    agentBrowserEntry,
    "--session", sessionId,
    "--json",
    "--download-path", sessionDirectory,
    "--color-scheme", "light",
    ...args,
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  const envelope = JSON.parse(stdout.trim());
  if (envelope?.success === false) throw new Error(envelope.error ?? "agent-browser command failed");
  return envelope?.data ?? envelope;
};

let child;
let closing = false;
const cleanup = async () => {
  if (closing) return;
  closing = true;
  try { await command("close"); } catch {}
  await rm(sessionDirectory, { recursive: true, force: true }).catch(() => undefined);
};

try {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BROWSER_UI_DEMO_PORT must be a valid TCP port.");
  }
  process.stdout.write(`Opening real agent-browser session at ${initialUrl}\n`);
  await command("open", initialUrl);
  await command("set", "viewport", "1280", "800");
  const stream = await command("stream", "status");
  if (!stream.enabled || !stream.port) throw new Error("agent-browser did not expose a stream port");
  child = spawn("pnpm", ["exec", "next", "dev", "--port", String(port)], {
    env: {
      ...process.env,
      NEXT_DIST_DIR: `.next-dev-${port}`,
      NEXT_ALLOWED_DEV_ORIGINS: localDevelopmentOrigins.join(","),
      NEXT_PUBLIC_BROWSER_STREAM_URL: `ws://127.0.0.1:${stream.port}`,
      NEXT_PUBLIC_BROWSER_INITIAL_URL: initialUrl,
      NEXT_PUBLIC_BROWSER_DEMO_MODE: "live",
      NEXT_PUBLIC_BROWSER_DEMO_TOKEN: demoToken,
      BROWSER_UI_DEMO_TOKEN: demoToken,
      AGENT_BROWSER_ENTRY: agentBrowserEntry,
      AGENT_BROWSER_SESSION_ID: sessionId,
      AGENT_BROWSER_DOWNLOAD_PATH: sessionDirectory,
    },
    stdio: "inherit",
  });
  child.once("exit", async (code) => { await cleanup(); process.exit(code ?? 0); });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child?.kill(signal));
} catch (error) {
  await cleanup();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
