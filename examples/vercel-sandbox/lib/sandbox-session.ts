import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { SANDBOX_PACKAGE_JSON, SANDBOX_WORKER_SOURCE } from "./worker-source";

const GATEWAY_PORT = 8787;
const SANDBOX_ROOT = "/vercel/sandbox";
const METADATA_PATH = `${SANDBOX_ROOT}/.browser-ui-session.json`;
const MODE_PATH = `${SANDBOX_ROOT}/.browser-ui-mode`;
const COMMAND_PATH = `${SANDBOX_ROOT}/.browser-ui-agent-command`;
const SESSION_LOCK_PATH = `${SANDBOX_ROOT}/.browser-ui-session-lock`;
const ACTIVITY_LOCK_PATH = `${SANDBOX_ROOT}/.browser-ui-activity-lock`;
const SESSION_KEY = /^[a-f0-9]{32}$/;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface SandboxMetadata {
  error?: string;
  sessionId?: string;
  title?: string;
  viewport?: { width: number; height: number };
}

export interface DemoSession {
  expiresAt?: string;
  gatewayOrigin: string;
  key: string;
  sessionId: string;
  title: string;
  viewport: { width: number; height: number };
}

export async function createDemoSession(key: string, signal?: AbortSignal): Promise<DemoSession> {
  if (!isHostedDeployment() && process.env.ALLOW_LOCAL_SANDBOX_USAGE !== "true") {
    throw new DemoAccessError(
      "Deploy your own copy to run this demo with your Vercel resources",
      412,
      "deployment_required",
    );
  }
  validateKey(key);
  const sandbox = await Sandbox.create({
    name: sandboxName(key),
    runtime: "node24",
    timeout: SESSION_IDLE_TIMEOUT_MS,
    ports: [GATEWAY_PORT],
    persistent: false,
    resources: { vcpus: 2 },
    tags: { app: "browser-ui-demo" },
    signal,
  });
  const abort = () => void sandbox.delete().catch(() => undefined);
  signal?.addEventListener("abort", abort, { once: true });

  try {
    if (signal?.aborted) throw new Error("Sandbox creation was canceled");
    await sandbox.writeFiles([
      { path: "package.json", content: Buffer.from(SANDBOX_PACKAGE_JSON) },
      { path: "worker.mjs", content: Buffer.from(SANDBOX_WORKER_SOURCE) },
    ]);
    await runChecked(sandbox, "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"]);
    await runChecked(sandbox, "./node_modules/.bin/agent-browser", ["install", "--with-deps"]);
    await sandbox.fs.writeFile(MODE_PATH, "agent");

    const worker = await sandbox.runCommand({
      cmd: "node",
      args: ["worker.mjs"],
      cwd: SANDBOX_ROOT,
      detached: true,
      env: {
        BROWSER_UI_GATEWAY_ORIGIN: sandbox.domain(GATEWAY_PORT),
        BROWSER_UI_SOURCE_TOKEN: token(key, "source"),
        BROWSER_UI_VIEWER_TOKEN: token(key, "viewer"),
      },
    });
    const metadata = await waitForMetadata(sandbox, worker);
    const expiresAt = await touchDemoSession(sandbox);
    return sessionFrom(sandbox, key, metadata, expiresAt);
  } catch (error) {
    await sandbox.delete().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function getDemoSandbox(key: string): Promise<Sandbox> {
  validateKey(key);
  return Sandbox.get({ name: sandboxName(key), resume: false });
}

export async function getDemoSession(key: string): Promise<{
  metadata: Required<Pick<SandboxMetadata, "sessionId" | "title" | "viewport">>;
  sandbox: Sandbox;
}> {
  const sandbox = await getDemoSandbox(key);
  const metadata = await readMetadata(sandbox);
  if (!metadata.sessionId || !metadata.title || !metadata.viewport) {
    throw new Error(metadata.error ?? "Sandbox browser is not ready");
  }
  return { metadata: metadata as Required<Pick<SandboxMetadata, "sessionId" | "title" | "viewport">>, sandbox };
}

export async function deleteDemoSession(key: string): Promise<void> {
  const sandbox = await getDemoSandbox(key);
  await sandbox.delete();
}

export async function touchDemoSession(sandbox: Sandbox): Promise<string | undefined> {
  return withSandboxLock(sandbox, ACTIVITY_LOCK_PATH, async () => {
    const fresh = await Sandbox.get({ name: sandbox.name, resume: false });
    const expiresAt = fresh.expiresAt?.getTime();
    if (!expiresAt) return undefined;
    const extension = Date.now() + SESSION_IDLE_TIMEOUT_MS - expiresAt;
    if (extension > 30_000) await fresh.extendTimeout(extension);
    return fresh.expiresAt?.toISOString();
  });
}

export function withSessionLock<T>(sandbox: Sandbox, operation: () => Promise<T>): Promise<T> {
  return withSandboxLock(sandbox, SESSION_LOCK_PATH, operation);
}

export async function gatewayRequest(
  key: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const { sandbox } = await getDemoSession(key);
  return fetch(new URL(path, sandbox.domain(GATEWAY_PORT)), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token(key, "viewer")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function readMode(sandbox: Sandbox): Promise<"agent" | "human"> {
  const value = await sandbox.fs.readFile(MODE_PATH, "utf8").catch(() => "agent");
  return value.trim() === "human" ? "human" : "agent";
}

export async function writeMode(sandbox: Sandbox, mode: "agent" | "human"): Promise<void> {
  await sandbox.fs.writeFile(MODE_PATH, mode);
}

export async function readAgentCommand(sandbox: Sandbox): Promise<string | null> {
  const value = await sandbox.fs.readFile(COMMAND_PATH, "utf8").catch(() => "");
  return value.trim() || null;
}

export async function writeAgentCommand(sandbox: Sandbox, commandId: string): Promise<void> {
  await sandbox.fs.writeFile(COMMAND_PATH, commandId);
}

export async function clearAgentCommand(sandbox: Sandbox, commandId: string): Promise<void> {
  if (await readAgentCommand(sandbox) === commandId) {
    await sandbox.fs.writeFile(COMMAND_PATH, "");
  }
}

export function validateKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !SESSION_KEY.test(key)) {
    throw new Error("Invalid sandbox session key");
  }
}

export function validateDemoAccess(accessCode: unknown): void {
  if (!isHostedDeployment()) return;
  const expected = process.env.DEMO_ACCESS_CODE?.trim();
  if (!expected) throw new DemoAccessError("Set DEMO_ACCESS_CODE before using this deployment", 503, "configuration_required");
  if (typeof accessCode !== "string" || !sameSecret(accessCode, expected)) {
    throw new DemoAccessError("Incorrect deployment access code", 401, "access_required");
  }
}

export function aiProxyToken(key: string): string {
  validateKey(key);
  return token(key, "ai");
}

export function isSandboxNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("response" in error)) return false;
  return (error as { response?: { status?: unknown } }).response?.status === 404;
}

function sandboxName(key: string): string {
  return `browser-ui-${key}`;
}

function token(key: string, audience: "ai" | "source" | "viewer"): string {
  return createHash("sha256").update(`${audience}:${key}`).digest("base64url");
}

function isHostedDeployment(): boolean {
  return process.env.VERCEL === "1" && !!process.env.VERCEL_REGION && (
    process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview"
  );
}

function sameSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export class DemoAccessError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

async function runChecked(sandbox: Sandbox, cmd: string, args: string[]): Promise<void> {
  const result = await sandbox.runCommand({ cmd, args, cwd: SANDBOX_ROOT });
  if (result.exitCode === 0) return;
  const detail = (await result.stderr()).trim() || (await result.stdout()).trim();
  throw new Error(detail || `${cmd} failed with exit code ${result.exitCode}`);
}

async function withSandboxLock<T>(
  sandbox: Sandbox,
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + 5_000;
  const owner = randomUUID();
  while (true) {
    try {
      await sandbox.fs.mkdir(path);
      await sandbox.fs.writeFile(`${path}/owner`, owner);
      break;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const stats = await sandbox.fs.stat(path).catch(() => null);
      if (stats && Date.now() - stats.mtimeMs > 30_000) {
        await sandbox.fs.rm(path, { force: true, recursive: true }).catch(() => undefined);
      }
      if (Date.now() >= deadline) throw new Error("The sandbox is busy. Try again.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await operation();
  } finally {
    const currentOwner = await sandbox.fs.readFile(`${path}/owner`, "utf8").catch(() => "");
    if (currentOwner.trim() === owner) {
      await sandbox.fs.rm(path, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

async function readMetadata(sandbox: Sandbox): Promise<SandboxMetadata> {
  const contents = await sandbox.readFileToBuffer({ path: METADATA_PATH });
  if (!contents) return {};
  return JSON.parse(contents.toString("utf8")) as SandboxMetadata;
}

async function waitForMetadata(
  sandbox: Sandbox,
  worker: Awaited<ReturnType<Sandbox["getCommand"]>>,
): Promise<SandboxMetadata> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const metadata = await readMetadata(sandbox);
    if (metadata.error) throw new Error(metadata.error);
    if (metadata.sessionId && metadata.title && metadata.viewport) return metadata;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await worker.kill("SIGTERM").catch(() => undefined);
  const result = await worker.wait();
  const detail = (await result.stderr()).trim();
  throw new Error(detail || "Timed out while starting the sandbox browser");
}

function sessionFrom(
  sandbox: Sandbox,
  key: string,
  metadata: SandboxMetadata,
  expiresAt = sandbox.expiresAt?.toISOString(),
): DemoSession {
  if (!metadata.sessionId || !metadata.title || !metadata.viewport) {
    throw new Error("Sandbox browser returned incomplete metadata");
  }
  return {
    key,
    sessionId: metadata.sessionId,
    gatewayOrigin: sandbox.domain(GATEWAY_PORT),
    title: metadata.title,
    viewport: metadata.viewport,
    ...(expiresAt ? { expiresAt } : {}),
  };
}
