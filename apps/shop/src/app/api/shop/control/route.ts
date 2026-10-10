import { NextResponse } from "next/server";

import {
  endSession,
  resumeAgent,
  takeControl,
} from "../../../../server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production")
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  switch (body.action) {
    case "take":
      return NextResponse.json({ session: takeControl() });
    case "resume":
      return NextResponse.json({ session: resumeAgent() });
    case "end":
      await endSession();
      return NextResponse.json({ session: null });
    default:
      return NextResponse.json(
        { error: "Unsupported action" },
        { status: 400 },
      );
  }
}
