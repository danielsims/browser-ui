import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readlinkSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  ShopPhase,
  ShopProgressEvent,
  ShopSessionSnapshot,
} from "../lib/events";
import { shopViewport } from "../lib/events";
import { parseShopLine } from "./progress";

const execFileAsync = promisify(execFile);
const READY_TIMEOUT_MS = 120_000;

interface InternalSession {
  id: string;
  recipe: string;
  phase: ShopPhase;
  streamUrl: string | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  events: ShopProgressEvent[];
  child: ChildProcessWithoutNullStreams | null;
  agentSession: string;
  seq: number;
  stderr: string;
}

const globalRoot = globalThis as typeof globalThis & {
  __browserUiShopSession?: InternalSession;
};

// Listeners live for the process, not for a session. The page connects its
// EventSource before any session exists, so a session-scoped subscriber set
// meant a live viewer never received events — only a refresh replayed them.
const listeners = new Set<(event: ShopProgressEvent) => void>();

function current(): InternalSession | null {
  return globalRoot.__browserUiShopSession ?? null;
}

export function getSnapshot(): ShopSessionSnapshot | null {
  const session = current();
  if (!session) return null;
  return {
    id: session.id,
    recipe: session.recipe,
    phase: session.phase,
    viewport: shopViewport,
    streamUrl: session.streamUrl,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    error: session.error,
    events: session.events,
  };
}

export function subscribe(
  listener: (event: ShopProgressEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(
  session: InternalSession,
  event: Omit<ShopProgressEvent, "seq" | "at">,
): void {
  const next: ShopProgressEvent = {
    ...event,
    seq: session.seq++,
    at: Date.now(),
  };
  session.events.push(next);
  for (const listener of listeners) listener(next);
}

function resolveAgentBrowserEntry(): string {
  if (process.env.SHOP_AGENT_BROWSER_ENTRY)
    return process.env.SHOP_AGENT_BROWSER_ENTRY;
  const requireFromApp = createRequire(
    join(/* turbopackIgnore: true */ process.cwd(), "package.json"),
  );
  return requireFromApp.resolve("agent-browser/bin/agent-browser.js");
}

async function agentBrowser(
  sessionId: string,
  args: string[],
): Promise<unknown> {
  const entry = resolveAgentBrowserEntry();
  const { stdout } = await execFileAsync(
    process.execPath,
    [entry, "--session", sessionId, "--json", ...args],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const envelope = JSON.parse(stdout.trim()) as {
    success?: boolean;
    data?: unknown;
    error?: string;
  };
  if (envelope.success === false)
    throw new Error(envelope.error ?? "agent-browser command failed");
  return envelope.data ?? envelope;
}

function jevDirectory(): string {
  if (process.env.SHOP_JEV_DIR) return resolve(process.env.SHOP_JEV_DIR);
  // apps/shop -> browser-ui -> Development -> jev-browser-use
  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "../../../jev-browser-use",
  );
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() =>
        port ? resolvePort(port) : reject(new Error("No free port")),
      );
    });
  });
}

/** Best-effort release of a stale persistent Chrome profile. */
function releaseProfile(profileDir: string): void {
  const lock = join(profileDir, "SingletonLock");
  try {
    const target = readlinkSync(lock);
    const pid = /-(\d+)$/u.exec(target)?.[1];
    if (pid) process.kill(Number(pid), "SIGTERM");
  } catch {
    // No lock, or not ours to kill.
  }
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    rmSync(join(profileDir, name), { force: true });
  }
}

async function closeAgentSession(sessionId: string): Promise<void> {
  await agentBrowser(sessionId, ["close"]).catch(() => undefined);
}

/** Device pixel ratio for the streamed view: 2 keeps a retina-crisp picture. */
function streamScale(): number {
  const value = Number(process.env.SHOP_STREAM_SCALE ?? 2);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

/**
 * Ask agent-browser to emulate a device pixel ratio for the session. The stream's
 * JPEG quality is fixed in the agent-browser binary, so extra pixels are the only
 * lever that makes the delivered picture sharper.
 */
async function applyStreamQuality(sessionId: string): Promise<void> {
  await agentBrowser(sessionId, [
    "set",
    "viewport",
    String(shopViewport.width),
    String(shopViewport.height),
    String(streamScale()),
  ]).catch(() => undefined);
}

interface CdpSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

/**
 * Park the browser window off the top of the screen so it never pops up over the
 * user's work. It must stay *visible* (normal, not minimised) or the compositor
 * stops and the stream freezes on one frame.
 */
async function parkWindow(cdpPort: number): Promise<void> {
  try {
    const version = (await (
      await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
    ).json()) as { webSocketDebuggerUrl?: string };
    const targets = (await (
      await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
    ).json()) as { id: string; type: string }[];
    const page = targets.find((target) => target.type === "page") ?? targets[0];
    const WS = (
      globalThis as unknown as { WebSocket?: new (url: string) => CdpSocket }
    ).WebSocket;
    if (!version.webSocketDebuggerUrl || !page || !WS) return;
    const socket = new WS(version.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map<number, (value: unknown) => void>();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
      };
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)?.(message.result);
        pending.delete(message.id);
      }
    };
    const send = (method: string, params: object = {}) =>
      new Promise<unknown>((resolve) => {
        const next = ++id;
        pending.set(next, resolve);
        socket.send(JSON.stringify({ id: next, method, params }));
      });
    await new Promise<void>((resolve) => {
      socket.onopen = resolve;
    });
    const info = (await send("Browser.getWindowForTarget", {
      targetId: page.id,
    })) as {
      windowId?: number;
    };
    if (info.windowId !== undefined) {
      // Off the top of the screen. It must stay full size: the screencast
      // follows the window size, so shrinking it would blur the stream.
      await send("Browser.setWindowBounds", {
        windowId: info.windowId,
        bounds: { left: 0, top: -32000, windowState: "normal" },
      });
    }
    socket.close();
  } catch {
    // Non-fatal.
  }
}

async function attachStream(
  sessionId: string,
  cdpPort: number,
): Promise<string> {
  await agentBrowser(sessionId, ["connect", String(cdpPort)]);
  let status = (await agentBrowser(sessionId, ["stream", "status"])) as {
    enabled?: boolean;
    port?: number;
  };
  if (!status.enabled || !status.port) {
    await agentBrowser(sessionId, ["stream", "enable"]).catch(() => undefined);
    status = (await agentBrowser(sessionId, ["stream", "status"])) as {
      enabled?: boolean;
      port?: number;
    };
  }
  if (!status.port)
    throw new Error("agent-browser did not expose a stream port");
  return `ws://127.0.0.1:${status.port}`;
}

function waitForReady(session: InternalSession): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const child = session.child;
    if (!child) {
      rejectReady(new Error("Runner did not start"));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(
        new Error("Timed out waiting for the browser to become ready"),
      );
    }, READY_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      child?.removeListener("exit", onExit);
      listeners.delete(listener);
    }
    function onReady() {
      if (settled) return;
      settled = true;
      cleanup();
      resolveReady();
    }
    function onExit(code: number | null) {
      if (settled) return;
      settled = true;
      cleanup();
      rejectReady(
        new Error(
          session.stderr.trim() ||
            `Shop runner exited early (code ${code ?? "?"})`,
        ),
      );
    }
    function listener(event: ShopProgressEvent) {
      if (event.kind === "ready") onReady();
    }

    child.once("exit", onExit);
    if (session.events.some((event) => event.kind === "ready")) onReady();
    else listeners.add(listener);
  });
}

/**
 * A dev server can restart (or a session can fail) and leave an engine holding
 * the Chrome profile, which makes every later launch hang. Clear them first.
 */
async function killOrphans(): Promise<void> {
  for (const pattern of ["10-woolworths-shop", "Google Chrome for Testing"]) {
    await execFileAsync("pkill", ["-f", pattern]).catch(() => undefined);
  }
}

export async function startSession(
  recipe: string,
  deliveryPref: "free" | "asap" = "free",
): Promise<ShopSessionSnapshot> {
  await endSession();
  await killOrphans();
  const id = randomUUID();
  const agentSession = `browser-ui-shop-${id.slice(0, 8)}`;
  const directory = jevDirectory();
  const profileDir = join(directory, ".profiles", "woolworths");
  if (!existsSync(directory)) {
    throw new Error(`Shop engine not found at ${directory}. Set SHOP_JEV_DIR.`);
  }

  const session: InternalSession = {
    id,
    recipe,
    phase: "starting",
    streamUrl: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    events: [],
    child: null,
    agentSession,
    seq: 0,
    stderr: "",
  };
  globalRoot.__browserUiShopSession = session;
  emit(session, { kind: "info", label: "Waking up the browser" });

  await closeAgentSession(agentSession);
  releaseProfile(profileDir);
  const cdpPort = await freePort();

  const child = spawn(
    process.env.SHOP_BUN_BIN ?? "bun",
    ["run", "src/tests/10-woolworths-shop.ts", recipe],
    {
      cwd: directory,
      env: {
        ...process.env,
        SESSION_GATE: "1",
        CDP_PORT: String(cdpPort),
        SESSION_VIEWPORT_W: String(shopViewport.width),
        SESSION_VIEWPORT_H: String(shopViewport.height),
        SESSION_DPR: String(streamScale()),
        SESSION_BACKGROUND: "1",
        DELIVERY_PREF: deliveryPref,
        SHOP: recipe,
        HEADED: "1",
        REVIEW_MS: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  session.child = child;

  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseShopLine(line);
      if (parsed) {
        emit(session, parsed);
        if (
          parsed.kind === "item" ||
          parsed.kind === "search" ||
          parsed.kind === "add"
        )
          session.phase = "shopping";
        if (parsed.kind === "done") {
          session.phase = "done";
          session.finishedAt = Date.now();
        }
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    session.stderr = (session.stderr + chunk).slice(-4000);
  });
  child.once("exit", (code) => {
    if (session.phase === "done" || session.phase === "error") return;
    session.phase = "error";
    session.finishedAt = Date.now();
    session.error =
      session.stderr.trim() || `Shop runner exited (code ${code ?? "?"})`;
    emit(session, {
      kind: "error",
      label: "Shopping stopped",
      detail: session.error,
    });
  });

  try {
    await waitForReady(session);
    // Park it before anything else so the window is off-screen as early as possible.
    await parkWindow(cdpPort);
    session.streamUrl = await attachStream(agentSession, cdpPort);
    await applyStreamQuality(agentSession);
    session.phase = "planning";
    emit(session, { kind: "info", label: "Planning your list" });
    child.stdin.write("GO\n");
  } catch (error) {
    session.phase = "error";
    session.error = error instanceof Error ? error.message : String(error);
    emit(session, {
      kind: "error",
      label: "Could not start the session",
      detail: session.error,
    });
    await endSession();
    throw error;
  }

  const snapshot = getSnapshot();
  if (!snapshot) throw new Error("Session disappeared");
  return snapshot;
}

export async function endSession(): Promise<void> {
  const session = current();
  if (!session) return;
  const child = session.child;
  if (child?.exitCode === null) {
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child.kill("SIGCONT");
    child.kill("SIGTERM");
  }
  await closeAgentSession(session.agentSession);
  globalRoot.__browserUiShopSession = undefined;
}

export function takeControl(): ShopSessionSnapshot | null {
  const session = current();
  if (!session?.child) return getSnapshot();
  session.child.kill("SIGSTOP");
  session.phase = "human";
  emit(session, { kind: "info", label: "You have control" });
  return getSnapshot();
}

export function resumeAgent(): ShopSessionSnapshot | null {
  const session = current();
  if (!session?.child) return getSnapshot();
  session.child.kill("SIGCONT");
  session.phase = "shopping";
  emit(session, { kind: "info", label: "Agent resumed" });
  return getSnapshot();
}
