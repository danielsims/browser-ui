import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_SESSION_PROTOCOL,
  createHttpBrowserSessionResolver,
  normalizeGatewayOrigin,
  parseBrowserSourceMessage,
  parseBrowserViewerMessage,
} from "../dist/index.js";

test("parses bounded source frames and rejects input-shaped viewer messages", () => {
  assert.equal(parseBrowserSourceMessage({
    v: 1,
    type: "source.frame",
    codec: "image/jpeg",
    data: "aGVsbG8=",
    width: 1280,
    height: 800,
  })?.type, "source.frame");
  assert.equal(parseBrowserSourceMessage({
    v: 1,
    type: "source.frame",
    codec: "image/jpeg",
    data: "x".repeat(20),
    width: 1280,
    height: 800,
  }, { maximumEncodedFrameLength: 10 }), null);
  assert.equal(parseBrowserViewerMessage({
    v: 1,
    type: "input",
    event: { kind: "pointer" },
  }), null);
  assert.deepEqual(parseBrowserViewerMessage({
    type: "input_navigation",
    direction: "back",
  }), {
    type: "input_navigation",
    direction: "back",
  });
  assert.equal(parseBrowserViewerMessage({
    type: "input_navigation",
    direction: "reload",
  }), null);
});

test("requires a clean HTTP gateway origin", () => {
  assert.equal(normalizeGatewayOrigin("https://sessions.example.com"), "https://sessions.example.com");
  assert.throws(() => normalizeGatewayOrigin("https://sessions.example.com/path"));
  assert.throws(() => normalizeGatewayOrigin("wss://sessions.example.com"));
});

test("resolves a fresh authenticated connection", async () => {
  let request;
  const resolver = createHttpBrowserSessionResolver({
    gatewayOrigin: "https://sessions.example.com",
    authorize: ({ body }) => ({ authorization: `Signed ${body.length}` }),
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        session: {
          version: 1,
          sessionId: "session-one",
          title: "Test",
          status: "live",
          viewport: { width: 1280, height: 800 },
          createdAt: "2026-07-28T12:00:00.000Z",
        },
        access: { capabilities: ["observe"], sensitive: false },
        connection: {
          url: "wss://sessions.example.com/v1/view",
          protocols: [BROWSER_SESSION_PROTOCOL, "ticket.once"],
          expiresAt: "2026-07-28T12:00:30.000Z",
          frameEncoding: "json-base64",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const resolution = await resolver({
    sessionId: "session-one",
    intent: "observe",
    clientInstanceId: "client-one",
  });
  assert.equal(resolution.connection.protocols[0], BROWSER_SESSION_PROTOCOL);
  assert.equal(request.url, "https://sessions.example.com/v1/sessions/session-one/connections");
  assert.match(request.init.headers.authorization, /^Signed /);
});
