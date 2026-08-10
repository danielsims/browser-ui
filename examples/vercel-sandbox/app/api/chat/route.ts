import {
  aiProxyToken,
  clearAgentCommand,
  getDemoSession,
  readAgentCommand,
  readMode,
  touchDemoSession,
  validateKey,
  withSessionLock,
  writeAgentCommand,
} from "../../../lib/sandbox-session";

export const runtime = "nodejs";
export const maxDuration = 300;
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

export async function POST(request: Request) {
  let active: { commandId: string; key: string } | null = null;
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
    const prompt = body.prompt.trim();
    const { sandbox } = await getDemoSession(key);
    await touchDemoSession(sandbox).catch(() => undefined);
    const launch = await withSessionLock(sandbox, async () => {
      if ((await readMode(sandbox)) === "human") {
        return {
          error: "Return control to the agent before sending a message",
        } as const;
      }
      if (await readAgentCommand(sandbox)) {
        return { error: "The agent is already working" } as const;
      }
      const command = await sandbox.runCommand({
        cmd: "./node_modules/.bin/agent-browser",
        args: ["--session", "browser-ui-demo", "--json", "chat", prompt],
        cwd: "/vercel/sandbox",
        detached: true,
        timeoutMs: 270_000,
        env: {
          AGENT_BROWSER_IDLE_TIMEOUT_MS: String(10 * 60 * 1000),
          AI_GATEWAY_API_KEY: aiProxyToken(key),
          AI_GATEWAY_MODEL:
            firstNonEmpty(process.env.AI_GATEWAY_MODEL?.trim()) ??
            DEFAULT_MODEL,
          AI_GATEWAY_URL: new URL(
            `/api/ai-gateway/${key}`,
            firstNonEmpty(process.env.AI_GATEWAY_PROXY_ORIGIN?.trim()) ??
              request.url,
          )
            .toString()
            .replace(/\/$/, ""),
        },
      });
      active = { commandId: command.cmdId, key };
      await writeAgentCommand(sandbox, command.cmdId);
      return { command } as const;
    });
    if ("error" in launch)
      return Response.json({ error: launch.error }, { status: 409 });
    const { command } = launch;
    const result = await command.wait();
    await touchDemoSession(sandbox).catch(() => undefined);
    await clearAgentCommand(sandbox, command.cmdId).catch(() => undefined);
    active = null;
    const output = (await result.stdout()).trim();
    const parsed = parseAgentOutput(output);
    if (parsed?.success === true) {
      return Response.json({
        reply: firstNonEmpty(parsed.text?.trim()) ?? "Done.",
      });
    }
    if (result.exitCode !== 0) {
      if ((await readMode(sandbox).catch(() => "agent")) === "human") {
        return Response.json({
          canceled: true,
          reply: "Handed the browser to you.",
        });
      }
      const detail = firstNonEmpty(
        parsed?.error?.trim(),
        (await result.stderr()).trim(),
      );
      throw new Error(
        firstNonEmpty(detail, "The browser agent stopped unexpectedly"),
      );
    }
    if (!parsed)
      throw new Error("The browser agent returned an invalid response");
    throw new Error(firstNonEmpty(parsed.error, "The browser agent failed"));
  } catch (error) {
    const current = active as { commandId: string; key: string } | null;
    if (current) {
      const { sandbox } = await getDemoSession(current.key).catch(() => ({
        sandbox: null,
      }));
      if (sandbox) {
        const command = await sandbox
          .getCommand(current.commandId)
          .catch(() => null);
        await command?.kill("SIGTERM").catch(() => undefined);
        await clearAgentCommand(sandbox, current.commandId).catch(
          () => undefined,
        );
      }
    }
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Chat request failed";
}

function firstNonEmpty(
  ...values: (null | string | undefined)[]
): string | undefined {
  for (const value of values) {
    if (value) return value;
  }
  return undefined;
}

function parseAgentOutput(
  output: string,
): { error?: string; success?: boolean; text?: string } | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
