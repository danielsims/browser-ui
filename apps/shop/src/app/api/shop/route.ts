import { NextResponse } from "next/server";

import { endSession, getSnapshot, startSession } from "../../../server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function localOnly() {
  return process.env.NODE_ENV !== "production";
}

export function GET() {
  if (!localOnly())
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  return NextResponse.json({ session: getSnapshot() });
}

export async function POST(request: Request) {
  if (!localOnly())
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  try {
    const body = (await request.json()) as {
      recipe?: unknown;
      deliveryPref?: unknown;
    };
    const recipe = typeof body.recipe === "string" ? body.recipe.trim() : "";
    if (!recipe) {
      return NextResponse.json(
        { error: "Tell us what you're cooking" },
        { status: 400 },
      );
    }
    const deliveryPref = body.deliveryPref === "asap" ? "asap" : "free";
    const session = await startSession(recipe, deliveryPref);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start the session",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  if (!localOnly())
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  await endSession();
  return NextResponse.json({ session: null });
}
