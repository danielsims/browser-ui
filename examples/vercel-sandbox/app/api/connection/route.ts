import {
  gatewayRequest,
  getDemoSession,
  isSandboxNotFound,
  validateKey,
} from "../../../lib/sandbox-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      clientInstanceId?: unknown;
      key?: unknown;
    };
    validateKey(body.key);
    if (typeof body.clientInstanceId !== "string") {
      throw new Error("A client instance ID is required");
    }
    const { metadata } = await getDemoSession(body.key);
    const response = await gatewayRequest(
      body.key,
      `/v1/sessions/${encodeURIComponent(metadata.sessionId)}/connections`,
      {
        intent: "observe",
        clientInstanceId: body.clientInstanceId,
        frameEncodings: ["binary-jpeg", "json-base64"],
      },
    );
    const result: unknown = await response.json();
    return Response.json(result, { status: response.status });
  } catch (error) {
    return Response.json(
      {
        error: isSandboxNotFound(error)
          ? "The sandbox session has ended"
          : message(error),
      },
      { status: isSandboxNotFound(error) ? 410 : 400 },
    );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Connection request failed";
}
