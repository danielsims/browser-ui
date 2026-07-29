#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { relayAgentBrowserSession } from "./relay.js";

await loadLaunchConfig();

if (!process.argv.includes("--foreground")) {
  await launchDetachedSource();
  process.exit(0);
}

const gatewayOrigin = required("BROWSER_UI_GATEWAY_ORIGIN");
const publicOrigin =
  process.env.BROWSER_UI_PUBLIC_ORIGIN?.trim() || gatewayOrigin;
const streamUrl = required("AGENT_BROWSER_STREAM_URL");
const sourceToken = required("BROWSER_UI_SOURCE_TOKEN");
const title = process.env.BROWSER_UI_SESSION_TITLE ?? "Agent browser session";
const width = integer("BROWSER_UI_VIEWPORT_WIDTH", 1280);
const height = integer("BROWSER_UI_VIEWPORT_HEIGHT", 800);
const agentBrowserCli = process.env.BROWSER_UI_AGENT_BROWSER_CLI?.trim();
const agentBrowserNamespace = process.env.BROWSER_UI_AGENT_BROWSER_NAMESPACE?.trim();
const agentBrowserSession = process.env.BROWSER_UI_AGENT_BROWSER_SESSION?.trim();
const navigationConfigured =
  agentBrowserCli && agentBrowserNamespace && agentBrowserSession;

const source = await relayAgentBrowserSession({
  gatewayOrigin,
  streamUrl,
  title,
  viewport: { width, height },
  authorize: () => ({ authorization: `Bearer ${sourceToken}` }),
  navigate: navigationConfigured
    ? (direction) => runAgentBrowserNavigation(
        agentBrowserCli,
        agentBrowserNamespace,
        agentBrowserSession,
        direction,
      )
    : undefined,
});

const descriptor = JSON.stringify({
  version: 2,
  session_id: source.session.sessionId,
  gateway_origin: origin(publicOrigin),
  title: source.session.title,
  viewport: source.session.viewport,
});
const descriptorFile = process.env.BROWSER_UI_SOURCE_DESCRIPTOR_FILE;
if (descriptorFile) await writeFile(descriptorFile, `${descriptor}\n`, "utf8");
process.stdout.write(`${descriptor}\n`);

await new Promise<void>((resolve) => {
  const stop = () => resolve();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
});
await source.close();

async function launchDetachedSource(): Promise<void> {
  if (process.platform === "darwin") {
    process.stdout.write(`${await launchWithLaunchd()}\n`);
    return;
  }

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--foreground"], {
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stdout = child.stdout;
  if (!stdout) throw new Error("Could not capture detached source output.");

  const descriptor = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the detached source descriptor."));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      stdout.removeListener("data", onData);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Detached source exited before startup (code ${code ?? "unknown"}).`));
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      cleanup();
      resolve(output.slice(0, newline));
    };
    child.once("error", onError);
    child.once("exit", onExit);
    stdout.on("data", onData);
  });

  const payload = JSON.parse(descriptor) as { version?: unknown };
  if (payload.version !== 2) throw new Error("Detached source returned an invalid descriptor.");
  stdout.destroy();
  child.unref();
  process.stdout.write(`${descriptor}\n`);
}

async function launchWithLaunchd(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "browser-ui-source-"));
  const descriptorFile = join(directory, "descriptor.json");
  const errorFile = join(directory, "error.log");
  const configFile = join(directory, "launch.json");
  const label = `com.browser-ui.source.${randomUUID()}`;
  const launchEnvironment = Object.fromEntries([
    "AGENT_BROWSER_STREAM_URL",
    "BROWSER_UI_GATEWAY_ORIGIN",
    "BROWSER_UI_PUBLIC_ORIGIN",
    "BROWSER_UI_SOURCE_TOKEN",
    "BROWSER_UI_SESSION_TITLE",
    "BROWSER_UI_VIEWPORT_WIDTH",
    "BROWSER_UI_VIEWPORT_HEIGHT",
    "BROWSER_UI_AGENT_BROWSER_CLI",
    "BROWSER_UI_AGENT_BROWSER_NAMESPACE",
    "BROWSER_UI_AGENT_BROWSER_SESSION",
  ].flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
  await writeFile(configFile, JSON.stringify({
    environment: {
      ...launchEnvironment,
      BROWSER_UI_SOURCE_DESCRIPTOR_FILE: descriptorFile,
    },
  }), { encoding: "utf8", mode: 0o600 });
  const submitted = spawn("/bin/launchctl", [
    "submit",
    "-l",
    label,
    "-o",
    "/dev/null",
    "-e",
    errorFile,
    "--",
    process.execPath,
    fileURLToPath(import.meta.url),
    "--launch-config",
    configFile,
    "--foreground",
  ], {
    stdio: "ignore",
  });
  const submittedCode = await new Promise<number | null>((resolve, reject) => {
    submitted.once("error", reject);
    submitted.once("exit", resolve);
  });
  if (submittedCode !== 0) {
    await rm(directory, { force: true, recursive: true });
    throw new Error(`launchctl could not start the source worker (code ${submittedCode ?? "unknown"}).`);
  }

  try {
    let descriptor: string;
    try {
      descriptor = await waitForDescriptor(descriptorFile);
    } catch (error) {
      const details = await readFile(errorFile, "utf8").catch(() => "");
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${details ? `\n${details.trim()}` : ""}`,
      );
    }
    const payload = JSON.parse(descriptor) as { version?: unknown };
    if (payload.version !== 2) throw new Error("Detached source returned an invalid descriptor.");
    return descriptor;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function runAgentBrowserNavigation(
  executable: string,
  namespace: string,
  session: string,
  direction: "back" | "forward",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [
      "--namespace",
      namespace,
      "--session",
      session,
      "--json",
      direction,
    ], { stdio: "ignore" });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`agent-browser ${direction} timed out.`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`agent-browser ${direction} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function loadLaunchConfig(): Promise<void> {
  const index = process.argv.indexOf("--launch-config");
  if (index === -1) return;
  const path = process.argv[index + 1];
  if (!path) throw new Error("--launch-config requires a path.");
  const decoded = JSON.parse(await readFile(path, "utf8")) as {
    environment?: Record<string, unknown>;
  };
  await rm(path, { force: true });
  for (const [name, value] of Object.entries(decoded.environment ?? {})) {
    if (typeof value === "string") process.env[name] = value;
  }
}

async function waitForDescriptor(path: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const descriptor = (await readFile(path, "utf8")).trim();
      if (descriptor) return descriptor;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the launchd source descriptor.");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > 8192) {
    throw new Error(`${name} must be an integer from 1 to 8192.`);
  }
  return value;
}

function origin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error(
      "BROWSER_UI_PUBLIC_ORIGIN must be an HTTP origin without credentials, path, query, or fragment.",
    );
  }
  return url.origin;
}
