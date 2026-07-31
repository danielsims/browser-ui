import { createDemoSession, deleteDemoSession, DemoAccessError, isSandboxNotFound, validateDemoAccess, validateKey } from "../../../lib/sandbox-session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { accessCode?: unknown; key?: unknown };
    validateDemoAccess(body.accessCode);
    validateKey(body.key);
    return Response.json(await createDemoSession(body.key, request.signal), { status: 201 });
  } catch (error) {
    return Response.json({
      error: message(error),
      ...(error instanceof DemoAccessError ? { code: error.code } : {}),
    }, { status: error instanceof DemoAccessError ? error.status : 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { key?: unknown; waitForCreation?: unknown };
    validateKey(body.key);
    if (body.waitForCreation === true) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await deleteDemoSession(body.key);
          return new Response(null, { status: 204 });
        } catch (error) {
          if (!isSandboxNotFound(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      return new Response(null, { status: 204 });
    }
    await deleteDemoSession(body.key);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isSandboxNotFound(error)) return new Response(null, { status: 204 });
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Sandbox request failed";
}
