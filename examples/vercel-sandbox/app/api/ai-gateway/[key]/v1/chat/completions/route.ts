import { aiProxyToken, getDemoSession, validateKey } from "../../../../../../../lib/sandbox-session";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const MAXIMUM_REQUEST_BYTES = 2 * 1024 * 1024;

export async function POST(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await context.params;
    validateKey(key);
    if (request.headers.get("authorization") !== `Bearer ${aiProxyToken(key)}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    await getDemoSession(key);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAXIMUM_REQUEST_BYTES) throw new Error("AI request is too large");
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > MAXIMUM_REQUEST_BYTES) throw new Error("AI request is too large");
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const apiKey = process.env.AI_GATEWAY_API_KEY?.trim()
      || request.headers.get("x-vercel-oidc-token")?.trim()
      || process.env.VERCEL_OIDC_TOKEN?.trim();
    if (!apiKey) throw new Error("AI Gateway authentication is not configured");
    const upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        accept: request.headers.get("accept") ?? "text/event-stream",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        model: process.env.AI_GATEWAY_MODEL?.trim() || DEFAULT_MODEL,
      }),
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      },
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "AI Gateway request failed";
}
