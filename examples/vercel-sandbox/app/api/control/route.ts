import {
  clearAgentCommand,
  gatewayRequest,
  getDemoSession,
  readAgentCommand,
  touchDemoSession,
  validateKey,
  withSessionLock,
  writeMode,
} from "../../../lib/sandbox-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    const { metadata, sandbox } = await getDemoSession(body.key);
    await touchDemoSession(sandbox).catch(() => undefined);
    if (body.action === "acquire") {
      await withSessionLock(sandbox, async () => {
        await writeMode(sandbox, "human");
        try {
          const commandId = await readAgentCommand(sandbox);
          if (commandId) {
            const command = await sandbox.getCommand(commandId);
            await command.kill("SIGTERM");
            await clearAgentCommand(sandbox, commandId);
          }
        } catch (error) {
          await writeMode(sandbox, "agent");
          throw error;
        }
      });
    }
    const response = await gatewayRequest(
      body.key,
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
      await withSessionLock(sandbox, () => writeMode(sandbox, "agent"));
    }
    if (!response.ok && body.action === "acquire")
      await writeMode(sandbox, "agent");
    return Response.json(
      {
        ...result,
        leaseId: result.access?.lease?.id,
      },
      { status: response.status },
    );
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Control request failed";
}
