import { getDemoSession, touchDemoSession, validateKey } from "../../../lib/sandbox-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { key?: unknown };
    validateKey(body.key);
    const { sandbox } = await getDemoSession(body.key);
    return Response.json({ expiresAt: await touchDemoSession(sandbox) });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Could not refresh the sandbox session";
}
