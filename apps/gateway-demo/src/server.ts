import { createBrowserSessionGateway } from "@browser-ui/gateway";

const sourceToken = required("BROWSER_UI_SOURCE_TOKEN");
const viewerToken = required("BROWSER_UI_VIEWER_TOKEN");
const port = integer("PORT", 8787);
const host = process.env.HOST ?? "127.0.0.1";
const publicOrigin =
  process.env.BROWSER_UI_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
const allowedRequestOrigins = (
  process.env.BROWSER_UI_ALLOWED_ORIGINS ??
  "http://localhost:55490,http://127.0.0.1:55490"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const gateway = createBrowserSessionGateway({
  publicOrigin,
  allowedRequestOrigins,
  authenticate(request, action) {
    const authorization = request.headers.authorization;
    if (
      action.startsWith("source:") &&
      authorization === `Bearer ${sourceToken}`
    ) {
      return { id: "demo-source", kind: "service" };
    }
    if (
      action.startsWith("viewer:") &&
      authorization === `Bearer ${viewerToken}`
    ) {
      return { id: "demo-viewer", kind: "user" };
    }
    return null;
  },
  authorize: () => true,
});

gateway.server.listen(port, host, () => {
  process.stdout.write(
    `Browser session gateway listening at ${publicOrigin}\n`,
  );
});

const metricsTimer = setInterval(() => {
  const metrics = gateway.getMetrics();
  if (metrics.sourceFramesReceived > 0) {
    process.stdout.write(
      `${JSON.stringify({ type: "browser-session.metrics", ...metrics })}\n`,
    );
  }
}, 5_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(metricsTimer);
    void gateway.close();
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid port.`);
  }
  return value;
}
