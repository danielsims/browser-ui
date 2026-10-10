import { getSnapshot, subscribe } from "../../../../server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function frame(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function GET(request: Request) {
  if (process.env.NODE_ENV === "production")
    return new Response("Not available", { status: 404 });

  let unsubscribe: (() => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (ping) clearInterval(ping);
      };
      const snapshot = getSnapshot();
      if (snapshot) {
        // Send metadata first, then replay the log once as ordered events, so a
        // late joiner matches a live viewer without duplicate entries.
        controller.enqueue(
          frame({ type: "snapshot", session: { ...snapshot, events: [] } }),
        );
        for (const event of snapshot.events)
          controller.enqueue(frame({ type: "event", event }));
      } else {
        controller.enqueue(frame({ type: "snapshot", session: null }));
      }
      unsubscribe = subscribe((event) => {
        try {
          controller.enqueue(frame({ type: "event", event }));
        } catch {
          cleanup();
        }
      });
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
