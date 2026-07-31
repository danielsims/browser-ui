import { getSandbox, type Process, type Sandbox as SandboxType } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

const GATEWAY_PORT = 8787;
const METADATA_PATH = "/workspace/.browser-ui-session.json";
const GATEWAY_ORIGIN_PATH = "/workspace/.browser-ui-gateway-origin";
const MODE_PATH = "/workspace/.browser-ui-mode";
const COMMAND_PATH = "/workspace/.browser-ui-agent-command";
const SESSION_KEY = /^[a-f0-9]{32}$/;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const BROWSER_LAUNCH_ARGS =
  "--no-sandbox,--disable-dev-shm-usage,--disable-gpu";

interface Env {
  AI: Ai;
  AI_MODEL?: string;
  ALLOW_LOCAL_SANDBOX_USAGE?: string;
  DEMO_ACCESS_CODE?: string;
  Sandbox: DurableObjectNamespace<SandboxType>;
}

interface SandboxMetadata {
  error?: string;
  gatewayOrigin?: string;
  sessionId?: string;
  title?: string;
  viewport?: { width: number; height: number };
}

interface DemoSession {
  expiresAt: string;
  gatewayOrigin: string;
  key: string;
  sessionId: string;
  title: string;
  viewport: { width: number; height: number };
}

interface AgentOutput {
  error?: string;
  success?: boolean;
  text?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    try {
      if (url.pathname === "/api/session" && request.method === "POST") {
        return await createSessionRoute(request, env);
      }
      if (url.pathname === "/api/session" && request.method === "DELETE") {
        return await deleteSessionRoute(request, env);
      }
      if (url.pathname === "/api/connection" && request.method === "POST") {
        return await connectionRoute(request, env);
      }
      if (url.pathname === "/api/control" && request.method === "POST") {
        return await controlRoute(request, env);
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await chatRoute(request, env);
      }
      if (url.pathname === "/api/activity" && request.method === "POST") {
        return await activityRoute(request, env);
      }
      if (
        url.pathname.startsWith("/api/ai-gateway/") &&
        url.pathname.endsWith("/v1/chat/completions") &&
        request.method === "POST"
      ) {
        return await aiGatewayRoute(request, env);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json({ error: message(error) }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function createSessionRoute(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      accessCode?: unknown;
      key?: unknown;
    };
    validateDeployment(request, env);
    await validateDemoAccess(body.accessCode, env);
    validateKey(body.key);
    const session = await createDemoSession(env, body.key, new URL(request.url).origin);
    return Response.json(session, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error: message(error),
        ...(error instanceof DemoAccessError ? { code: error.code } : {}),
      },
      { status: error instanceof DemoAccessError ? error.status : 500 },
    );
  }
}

async function deleteSessionRoute(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { key?: unknown };
    validateKey(body.key);
    const sandbox = demoSandbox(env, body.key);
    await sandbox.destroy();
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

async function connectionRoute(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      clientInstanceId?: unknown;
      key?: unknown;
    };
    validateKey(body.key);
    if (typeof body.clientInstanceId !== "string") {
      throw new Error("A client instance ID is required");
    }
    const { metadata } = await getDemoSession(env, body.key);
    const response = await gatewayRequest(
      env,
      body.key,
      metadata.gatewayOrigin,
      `/v1/sessions/${encodeURIComponent(metadata.sessionId)}/connections`,
      {
        clientInstanceId: body.clientInstanceId,
        frameEncodings: ["binary-jpeg", "json-base64"],
        intent: "observe",
      },
    );
    return copyJsonResponse(response);
  } catch (error) {
    return Response.json(
      { error: message(error) },
      { status: isEndedSession(error) ? 410 : 400 },
    );
  }
}

async function controlRoute(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      action?: unknown;
      clientInstanceId?: unknown;
      key?: unknown;
      leaseId?: unknown;
    };
    validateKey(body.key);
    if (body.action !== "acquire" && body.action !== "release") {
      throw new Error("Invalid control action");
    }
    if (typeof body.clientInstanceId !== "string") {
      throw new Error("A client instance ID is required");
    }

    const { metadata, sandbox } = await getDemoSession(env, body.key);
    if (body.action === "acquire") {
      await writeMode(sandbox, "human");
      const commandId = await readText(sandbox, COMMAND_PATH);
      if (commandId) {
        await sandbox.killProcess(commandId, "SIGTERM").catch(() => undefined);
        await writeText(sandbox, COMMAND_PATH, "");
      }
    }

    const response = await gatewayRequest(
      env,
      body.key,
      metadata.gatewayOrigin,
      `/v1/sessions/${encodeURIComponent(metadata.sessionId)}/control`,
      {
        action: body.action,
        clientInstanceId: body.clientInstanceId,
        ...(typeof body.leaseId === "string" ? { leaseId: body.leaseId } : {}),
      },
    );
    const result = (await response.json()) as {
      access?: { lease?: { id?: string } };
      error?: string;
    };
    if (response.ok && body.action === "release") {
      await writeMode(sandbox, "agent");
    }
    if (!response.ok && body.action === "acquire") {
      await writeMode(sandbox, "agent");
    }
    return Response.json(
      { ...result, leaseId: result.access?.lease?.id },
      { status: response.status },
    );
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

async function chatRoute(request: Request, env: Env): Promise<Response> {
  let active: { key: string; process: Process } | null = null;
  try {
    const body = (await request.json()) as { key?: unknown; prompt?: unknown };
    validateKey(body.key);
    if (
      typeof body.prompt !== "string" ||
      body.prompt.trim().length < 1 ||
      body.prompt.length > 2_000
    ) {
      throw new Error("Enter an instruction under 2,000 characters");
    }

    const key = body.key;
    const { sandbox } = await getDemoSession(env, key);
    if ((await readMode(sandbox)) === "human") {
      return Response.json(
        { error: "Return control to the agent before sending a message" },
        { status: 409 },
      );
    }
    if (await readText(sandbox, COMMAND_PATH)) {
      return Response.json(
        { error: "The agent is already working" },
        { status: 409 },
      );
    }

    const processId = `agent-${crypto.randomUUID()}`;
    const process = await sandbox.startProcess(
      `${shellQuote("/opt/browser-ui/node_modules/.bin/agent-browser")} --session browser-ui-demo --json chat ${shellQuote(body.prompt.trim())}`,
      {
        autoCleanup: false,
        cwd: "/opt/browser-ui",
        env: {
          AGENT_BROWSER_ARGS: BROWSER_LAUNCH_ARGS,
          AGENT_BROWSER_IDLE_TIMEOUT_MS: String(SESSION_IDLE_TIMEOUT_MS),
          AI_GATEWAY_API_KEY: await token(key, "ai"),
          AI_GATEWAY_MODEL: env.AI_MODEL?.trim() || DEFAULT_MODEL,
          AI_GATEWAY_URL: `${new URL(request.url).origin}/api/ai-gateway/${key}`,
        },
        processId,
        timeout: 270_000,
      },
    );
    active = { key, process };
    await writeText(sandbox, COMMAND_PATH, process.id);
    const exit = await process.waitForExit(270_000);
    const logs = await process.getLogs();
    await writeText(sandbox, COMMAND_PATH, "");
    active = null;

    const parsed = parseAgentOutput(logs.stdout.trim());
    if (parsed?.success === true) {
      return Response.json({ reply: parsed.text?.trim() || "Done." });
    }
    if (exit.exitCode !== 0) {
      if ((await readMode(sandbox)) === "human") {
        return Response.json({ canceled: true, reply: "Handed the browser to you." });
      }
      throw new Error(
        parsed?.error?.trim() ||
          logs.stderr.trim() ||
          "The browser agent stopped unexpectedly",
      );
    }
    if (!parsed) throw new Error("The browser agent returned an invalid response");
    throw new Error(parsed.error || "The browser agent failed");
  } catch (error) {
    if (active) {
      await active.process.kill("SIGTERM").catch(() => undefined);
      const sandbox = demoSandbox(env, active.key);
      await writeText(sandbox, COMMAND_PATH, "").catch(() => undefined);
    }
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

async function activityRoute(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { key?: unknown };
    validateKey(body.key);
    await getDemoSession(env, body.key);
    return Response.json({
      expiresAt: new Date(Date.now() + SESSION_IDLE_TIMEOUT_MS).toISOString(),
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

async function aiGatewayRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/ai-gateway\/([a-f0-9]{32})\/v1\/chat\/completions$/,
  );
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });
  const key = match[1];
  const expected = `Bearer ${await token(key, "ai")}`;
  if (request.headers.get("authorization") !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const result = await (
    env.AI as unknown as {
      run(model: string, input: Record<string, unknown>): Promise<unknown>;
    }
  ).run(model, toResponsesRequest(input));

  return Response.json(toChatCompletion(result, model), {
    headers: { "cache-control": "no-store" },
  });
}

async function createDemoSession(
  env: Env,
  key: string,
  requestOrigin: string,
): Promise<DemoSession> {
  const sandbox = demoSandbox(env, key);
  try {
    await writeText(sandbox, MODE_PATH, "agent");
    await writeText(sandbox, COMMAND_PATH, "");
    await writeText(sandbox, GATEWAY_ORIGIN_PATH, "");

    const gateway = await sandbox.startProcess("node /opt/browser-ui/worker.mjs", {
      autoCleanup: false,
      cwd: "/opt/browser-ui",
      env: {
        AGENT_BROWSER_ARGS: BROWSER_LAUNCH_ARGS,
        BROWSER_UI_ALLOWED_ORIGIN: requestOrigin,
        BROWSER_UI_SOURCE_TOKEN: await token(key, "source"),
        BROWSER_UI_VIEWER_TOKEN: await token(key, "viewer"),
      },
      processId: "browser-ui-gateway",
    });
    await gateway.waitForPort(GATEWAY_PORT, {
      path: "/health",
      status: 200,
      timeout: 180_000,
    });
    const tunnel = await sandbox.tunnels.get(GATEWAY_PORT);
    await writeText(sandbox, GATEWAY_ORIGIN_PATH, tunnel.url);
    const metadata = await waitForMetadata(sandbox, gateway);
    return sessionFrom(key, metadata);
  } catch (error) {
    await sandbox.destroy().catch(() => undefined);
    throw error;
  }
}

async function getDemoSession(
  env: Env,
  key: string,
): Promise<{
  metadata: Required<
    Pick<SandboxMetadata, "gatewayOrigin" | "sessionId" | "title" | "viewport">
  >;
  sandbox: SandboxType;
}> {
  const sandbox = demoSandbox(env, key);
  const gateway = await sandbox.getProcess("browser-ui-gateway");
  if (!gateway || (await gateway.getStatus()) !== "running") {
    throw new Error("The sandbox session has ended");
  }
  const metadata = await readMetadata(sandbox);
  if (
    !metadata.gatewayOrigin ||
    !metadata.sessionId ||
    !metadata.title ||
    !metadata.viewport
  ) {
    throw new Error(metadata.error ?? "Sandbox browser is not ready");
  }
  return {
    metadata: metadata as Required<
      Pick<SandboxMetadata, "gatewayOrigin" | "sessionId" | "title" | "viewport">
    >,
    sandbox,
  };
}

function demoSandbox(env: Env, key: string): SandboxType {
  return getSandbox(env.Sandbox, `browser-ui-${key}`, {
    containerTimeouts: {
      instanceGetTimeoutMS: 180_000,
      portReadyTimeoutMS: 180_000,
      waitIntervalMS: 300,
    },
    enableDefaultSession: false,
    normalizeId: true,
    sleepAfter: "10m",
    transport: "rpc",
  });
}

async function gatewayRequest(
  env: Env,
  key: string,
  gatewayOrigin: string,
  path: string,
  body: unknown,
): Promise<Response> {
  await getDemoSession(env, key);
  const request = () =>
    fetch(new URL(path, gatewayOrigin), {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${tokenCache.get(`viewer:${key}`) ?? ""}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  tokenCache.set(`viewer:${key}`, await token(key, "viewer"));
  let response = await request().catch(() => null);
  for (let attempt = 0; !response && attempt < 8; attempt += 1) {
    await delay(250 * (attempt + 1));
    response = await request().catch(() => null);
  }
  if (!response) throw new Error("Could not reach the sandbox browser");
  return response;
}

const tokenCache = new Map<string, string>();

async function readMetadata(sandbox: SandboxType): Promise<SandboxMetadata> {
  const value = await readText(sandbox, METADATA_PATH);
  if (!value) return {};
  return JSON.parse(value) as SandboxMetadata;
}

async function waitForMetadata(
  sandbox: SandboxType,
  gateway: Process,
): Promise<SandboxMetadata> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const metadata = await readMetadata(sandbox);
    if (metadata.error) throw new Error(metadata.error);
    if (
      metadata.gatewayOrigin &&
      metadata.sessionId &&
      metadata.title &&
      metadata.viewport
    ) {
      return metadata;
    }
    if ((await gateway.getStatus()) !== "running") break;
    await delay(1_000);
  }
  const logs = await gateway.getLogs().catch(() => ({ stdout: "", stderr: "" }));
  throw new Error(
    logs.stderr.trim() ||
      logs.stdout.trim() ||
      "Timed out while starting the sandbox browser",
  );
}

function sessionFrom(key: string, metadata: SandboxMetadata): DemoSession {
  if (
    !metadata.gatewayOrigin ||
    !metadata.sessionId ||
    !metadata.title ||
    !metadata.viewport
  ) {
    throw new Error("Sandbox browser returned incomplete metadata");
  }
  return {
    expiresAt: new Date(Date.now() + SESSION_IDLE_TIMEOUT_MS).toISOString(),
    gatewayOrigin: metadata.gatewayOrigin,
    key,
    sessionId: metadata.sessionId,
    title: metadata.title,
    viewport: metadata.viewport,
  };
}

async function readMode(sandbox: SandboxType): Promise<"agent" | "human"> {
  return (await readText(sandbox, MODE_PATH)) === "human" ? "human" : "agent";
}

function writeMode(
  sandbox: SandboxType,
  mode: "agent" | "human",
): Promise<void> {
  return writeText(sandbox, MODE_PATH, mode);
}

async function readText(sandbox: SandboxType, path: string): Promise<string> {
  const result = await sandbox
    .readFile(path, { encoding: "utf8" })
    .catch(() => null);
  return result && typeof result.content === "string" ? result.content.trim() : "";
}

async function writeText(
  sandbox: SandboxType,
  path: string,
  content: string,
): Promise<void> {
  await sandbox.writeFile(path, content, { encoding: "utf8" });
}

async function validateDemoAccess(
  accessCode: unknown,
  env: Env,
): Promise<void> {
  const expected = env.DEMO_ACCESS_CODE?.trim();
  if (!expected) {
    throw new DemoAccessError(
      "Set DEMO_ACCESS_CODE before using this deployment",
      503,
      "configuration_required",
    );
  }
  if (
    typeof accessCode !== "string" ||
    !(await sameSecret(accessCode, expected))
  ) {
    throw new DemoAccessError(
      "Incorrect deployment access code",
      401,
      "access_required",
    );
  }
}

function validateDeployment(request: Request, env: Env): void {
  const hostname = new URL(request.url).hostname;
  const local =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if (local && env.ALLOW_LOCAL_SANDBOX_USAGE !== "true") {
    throw new DemoAccessError(
      "Deploy your own copy to run this demo with your Cloudflare resources",
      412,
      "deployment_required",
    );
  }
}

function validateKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !SESSION_KEY.test(key)) {
    throw new Error("Invalid sandbox session key");
  }
}

async function token(
  key: string,
  audience: "ai" | "source" | "viewer",
): Promise<string> {
  validateKey(key);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${audience}:${key}`),
  );
  return base64Url(new Uint8Array(digest));
}

async function sameSecret(actual: string, expected: string): Promise<boolean> {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(actual)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toChatCompletion(result: unknown, model: string): unknown {
  if (
    result &&
    typeof result === "object" &&
    "choices" in result &&
    Array.isArray(result.choices)
  ) {
    return result;
  }
  const output = (result ?? {}) as {
    error?: { message?: unknown };
    output?: unknown;
    output_text?: unknown;
    response?: unknown;
    tool_calls?: unknown;
    usage?: Record<string, number>;
  };
  if (typeof output.error?.message === "string") {
    throw new Error(output.error.message);
  }

  const responseItems = Array.isArray(output.output) ? output.output : [];
  const toolCalls = [
    ...(Array.isArray(output.tool_calls) ? output.tool_calls : []),
    ...responseItems.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "function_call",
    ),
  ].map(normalizeToolCall);
  const responseText =
    typeof output.output_text === "string"
      ? output.output_text
      : responseItems
          .flatMap((item) => {
            const content =
              item && typeof item === "object"
                ? (item as { content?: unknown }).content
                : undefined;
            return Array.isArray(content) ? content : [];
          })
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              (item as { type?: unknown }).type === "output_text",
          )
          .map((item) => (item as { text?: unknown }).text)
          .filter((text): text is string => typeof text === "string")
          .join("");
  const usage = output.usage ?? {};
  return {
    choices: [
      {
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
        index: 0,
        message: {
          content:
            responseText ||
            (typeof output.response === "string" ? output.response : null),
          role: "assistant",
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    created: Math.floor(Date.now() / 1_000),
    id: `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`,
    model,
    object: "chat.completion",
    usage: {
      completion_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
      prompt_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}

function toResponsesRequest(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const instructions: string[] = [];
  const responseInput: unknown[] = [];

  for (const value of messages) {
    if (!value || typeof value !== "object") continue;
    const message = value as {
      content?: unknown;
      role?: unknown;
      tool_call_id?: unknown;
      tool_calls?: unknown;
    };
    const content = messageText(message.content);

    if (message.role === "system" || message.role === "developer") {
      if (content) instructions.push(content);
      continue;
    }
    if (message.role === "tool") {
      if (typeof message.tool_call_id === "string") {
        responseInput.push({
          call_id: message.tool_call_id,
          output: content,
          type: "function_call_output",
        });
      }
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;

    if (content) {
      responseInput.push({ content, role: message.role });
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      responseInput.push(
        ...message.tool_calls.map((call, index) =>
          toResponseFunctionCall(call, index),
        ),
      );
    }
  }

  const tools = Array.isArray(input.tools)
    ? input.tools.map(toResponseTool).filter((tool) => tool !== null)
    : undefined;

  return {
    input: responseInput,
    ...(instructions.length ? { instructions: instructions.join("\n\n") } : {}),
    max_output_tokens:
      input.max_completion_tokens ?? input.max_tokens ?? 2_048,
    ...(typeof input.parallel_tool_calls === "boolean"
      ? { parallel_tool_calls: input.parallel_tool_calls }
      : {}),
    ...(typeof input.temperature === "number"
      ? { temperature: input.temperature }
      : {}),
    ...(typeof input.top_p === "number" ? { top_p: input.top_p } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(input.tool_choice !== undefined
      ? { tool_choice: toResponseToolChoice(input.tool_choice) }
      : {}),
    stream: false,
  };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function toResponseTool(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const tool = value as {
    function?: {
      description?: unknown;
      name?: unknown;
      parameters?: unknown;
      strict?: unknown;
    };
    type?: unknown;
  };
  if (tool.type !== "function" || typeof tool.function?.name !== "string") {
    return null;
  }
  return {
    type: "function",
    name: tool.function.name,
    ...(typeof tool.function.description === "string"
      ? { description: tool.function.description }
      : {}),
    ...(tool.function.parameters && typeof tool.function.parameters === "object"
      ? { parameters: tool.function.parameters }
      : {}),
    ...(typeof tool.function.strict === "boolean"
      ? { strict: tool.function.strict }
      : {}),
  };
}

function toResponseToolChoice(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const choice = value as {
    function?: { name?: unknown };
    type?: unknown;
  };
  if (choice.type === "function" && typeof choice.function?.name === "string") {
    return { name: choice.function.name, type: "function" };
  }
  return value;
}

function toResponseFunctionCall(value: unknown, index: number): unknown {
  const call = normalizeToolCall(value, index) as {
    function: { arguments: string; name: string };
    id: string;
  };
  return {
    arguments: call.function.arguments,
    call_id: call.id,
    name: call.function.name,
    type: "function_call",
  };
}

function normalizeToolCall(value: unknown, index: number): unknown {
  const call = (value ?? {}) as {
    arguments?: unknown;
    call_id?: unknown;
    function?: { arguments?: unknown; name?: unknown };
    id?: unknown;
    name?: unknown;
    type?: unknown;
  };
  const argumentsValue = call.function?.arguments ?? call.arguments;
  const name = call.function?.name ?? call.name;
  return {
    function: {
      arguments:
        typeof argumentsValue === "string"
          ? argumentsValue
          : JSON.stringify(argumentsValue ?? {}),
      name: typeof name === "string" ? name : "unknown_tool",
    },
    id:
      typeof call.id === "string"
        ? call.id
        : typeof call.call_id === "string"
          ? call.call_id
        : `call_${index}_${crypto.randomUUID().slice(0, 8)}`,
    type: "function",
  };
}

function parseAgentOutput(output: string): AgentOutput | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AgentOutput) : null;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function copyJsonResponse(response: Response): Promise<Response> {
  return Response.json(await response.json(), { status: response.status });
}

function isEndedSession(error: unknown): boolean {
  return message(error).toLowerCase().includes("session has ended");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Cloudflare Sandbox request failed";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class DemoAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
