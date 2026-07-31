import assert from "node:assert/strict";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { decodeBrowserSessionBinaryFrame } from "@browser-ui/core";

import { createBrowserSessionGateway } from "../dist/index.js";
import { relayAgentBrowserSession, validateLoopbackStreamUrl } from "../dist/agent-browser/index.js";

test("only accepts private loopback agent-browser sockets", () => {
  assert.equal(validateLoopbackStreamUrl("ws://127.0.0.1:9223"), "ws://127.0.0.1:9223/");
  assert.throws(() => validateLoopbackStreamUrl("wss://sessions.example.com/source"));
  assert.throws(() => validateLoopbackStreamUrl("ws://192.168.1.20:9223"));
});

test("relays a real binary frame from one local source to a remote viewer", async (context) => {
  const local = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => local.once("listening", resolve));
  const localAddress = local.address();
  assert.ok(localAddress && typeof localAddress === "object");
  let resolveLocalInput;
  const localInput = new Promise((resolve) => {
    resolveLocalInput = resolve;
  });
  let resolveNavigation;
  const navigation = new Promise((resolve) => {
    resolveNavigation = resolve;
  });
  let localSocket;
  local.on("connection", (socket) => {
    localSocket = socket;
    socket.on("message", (data) => resolveLocalInput(JSON.parse(data.toString())));
    socket.send(JSON.stringify({
      type: "status",
      connected: true,
      screencasting: true,
      viewportWidth: 1280,
      viewportHeight: 800,
    }));
    socket.send(JSON.stringify({
      type: "frame",
      data: "/9gBAgP/2Q==",
      metadata: {
        deviceWidth: 1280,
        deviceHeight: 800,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    }));
  });

  let origin = "http://127.0.0.1";
  const gateway = createBrowserSessionGateway({
    publicOrigin: () => origin,
    authenticate(request, action) {
      if (action.startsWith("source:") && request.headers.authorization === "Bearer source") {
        return { id: "source", kind: "service" };
      }
      if (action.startsWith("viewer:") && request.headers.authorization === "Bearer viewer") {
        return { id: "viewer", kind: "user" };
      }
      return null;
    },
    authorize: () => true,
  });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const gatewayAddress = gateway.server.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === "object");
  origin = `http://127.0.0.1:${gatewayAddress.port}`;

  const source = await relayAgentBrowserSession({
    gatewayOrigin: origin,
    streamUrl: `ws://127.0.0.1:${localAddress.port}`,
    title: "E2E",
    viewport: { width: 1280, height: 800 },
    authorize: () => ({ authorization: "Bearer source" }),
    navigate: async (direction) => resolveNavigation(direction),
  });
  context.after(async () => {
    await source.close();
    await gateway.close();
    await new Promise((resolve) => local.close(resolve));
  });

  const response = await fetch(
    `${origin}/v1/sessions/${source.session.sessionId}/connections`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer viewer",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        intent: "observe",
        clientInstanceId: "binary_viewer",
        frameEncodings: ["binary-jpeg"],
      }),
    },
  );
  assert.equal(response.status, 200);
  const resolution = await response.json();
  const viewer = new WebSocket(resolution.connection.url, resolution.connection.protocols);
  const frame = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for relayed frame")), 2_000);
    viewer.on("message", (data, isBinary) => {
      if (!isBinary) return;
      clearTimeout(timeout);
      resolve(data);
    });
    viewer.on("error", reject);
  });
  const decoded = decodeBrowserSessionBinaryFrame(frame);
  assert.equal(decoded?.header.width, 1280);
  assert.deepEqual(
    decoded?.jpeg,
    Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]),
  );
  assert.equal(source.getMetrics().framesPublished, 1);
  assert.equal(gateway.getMetrics().sourceFramesReceived, 1);

  const latestBurstFrame = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for latest burst frame")), 3_000);
    const listener = (data, isBinary) => {
      if (!isBinary) return;
      const next = decodeBrowserSessionBinaryFrame(data);
      if (next?.jpeg[2] !== 11) return;
      clearTimeout(timeout);
      viewer.off("message", listener);
      resolve(next);
    };
    viewer.on("message", listener);
  });
  viewer._socket.pause();
  const frameBody = Buffer.alloc(512 * 1024, 1);
  for (let index = 0; index < 12; index += 1) {
    frameBody[0] = index;
    localSocket.send(JSON.stringify({
      type: "frame",
      data: Buffer.concat([Buffer.from([0xff, 0xd8]), frameBody, Buffer.from([0xff, 0xd9])]).toString("base64"),
      metadata: {
        deviceWidth: 1280,
        deviceHeight: 800,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    }));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  viewer._socket.resume();
  await latestBurstFrame;
  assert.ok(
    source.getMetrics().framesDropped > 0 || gateway.getMetrics().viewerFramesDropped > 0,
    "expected stale burst frames to be dropped",
  );

  const control = await fetch(
    `${origin}/v1/sessions/${source.session.sessionId}/control`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer viewer",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "acquire", clientInstanceId: "binary_viewer" }),
    },
  );
  assert.equal(control.status, 200);
  viewer.send(JSON.stringify({
    type: "input_mouse",
    eventType: "mousePressed",
    x: 640,
    y: 400,
    button: "left",
    clickCount: 1,
    modifiers: 0,
  }));
  assert.equal((await localInput).eventType, "mousePressed");
  viewer.send(JSON.stringify({
    type: "input_navigation",
    direction: "back",
  }));
  assert.equal(await navigation, "back");
  viewer.close();
});

test("resolves a fresh local stream URL after the agent-browser stream restarts", async () => {
  const firstLocal = await localStream(1);
  let currentLocal = firstLocal;
  let origin = "http://127.0.0.1";
  const gateway = createBrowserSessionGateway({
    publicOrigin: () => origin,
    authenticate(request, action) {
      if (action.startsWith("source:") && request.headers.authorization === "Bearer source") {
        return { id: "source", kind: "service" };
      }
      if (action.startsWith("viewer:") && request.headers.authorization === "Bearer viewer") {
        return { id: "viewer", kind: "user" };
      }
      return null;
    },
    authorize: () => true,
  });
  await new Promise((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  const gatewayAddress = gateway.server.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === "object");
  origin = `http://127.0.0.1:${gatewayAddress.port}`;

  let source;
  let viewer;
  let secondLocal;
  try {
    source = await relayAgentBrowserSession({
      gatewayOrigin: origin,
      resolveStreamUrl: () => currentLocal.url,
      title: "Recovering stream",
      viewport: { width: 1280, height: 800 },
      authorize: () => ({ authorization: "Bearer source" }),
      reconnectInitialDelayMs: 10,
      reconnectMaximumDelayMs: 20,
    });
    const response = await fetch(
      `${origin}/v1/sessions/${source.session.sessionId}/connections`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer viewer",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          intent: "observe",
          clientInstanceId: "recovering_viewer",
          frameEncodings: ["binary-jpeg"],
        }),
      },
    );
    assert.equal(response.status, 200);
    const resolution = await response.json();
    viewer = new WebSocket(resolution.connection.url, resolution.connection.protocols);
    await frameWithMarker(viewer, 1);

    secondLocal = await localStream(2);
    currentLocal = secondLocal;
    firstLocal.disconnect();

    await frameWithMarker(viewer, 2);
    assert.ok(source.getMetrics().localReconnects > 0);
  } finally {
    viewer?.close();
    await source?.close();
    await gateway.close();
    await firstLocal.close();
    await secondLocal?.close();
  }
});

async function localStream(marker) {
  const clients = new Set();
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  server.on("connection", (socket) => {
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
    socket.send(JSON.stringify({
      type: "status",
      connected: true,
      screencasting: true,
      viewportWidth: 1280,
      viewportHeight: 800,
    }));
    socket.send(JSON.stringify({
      type: "frame",
      data: Buffer.from([0xff, 0xd8, marker, 0xff, 0xd9]).toString("base64"),
      metadata: {
        deviceWidth: 1280,
        deviceHeight: 800,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    }));
  });
  return {
    url: `ws://127.0.0.1:${address.port}`,
    disconnect() {
      for (const client of clients) client.close();
    },
    close() {
      for (const client of clients) client.terminate();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function frameWithMarker(viewer, marker) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for stream marker ${marker}`)),
      2_000,
    );
    const listener = (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeBrowserSessionBinaryFrame(data);
      if (decoded?.jpeg[2] !== marker) return;
      clearTimeout(timeout);
      viewer.off("message", listener);
      resolve(decoded);
    };
    viewer.on("message", listener);
    viewer.on("error", reject);
  });
}
