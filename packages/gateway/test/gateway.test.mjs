import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";

import {
  decodeBrowserSessionBinaryFrame,
  encodeBrowserSessionBinaryFrame,
} from "@browser-ui/core";

import {
  createBrowserSessionGateway,
  OneTimeBrowserGatewayTickets,
} from "../dist/index.js";

test("tickets are short-lived and single-use", () => {
  const tickets = new OneTimeBrowserGatewayTickets(1_000);
  const issued = tickets.issue({
    role: "viewer",
    sessionId: "one",
    principalId: "viewer",
  });
  const protocols = ["browser-session.v1", issued.protocol];
  assert.equal(tickets.consume(protocols, "viewer")?.sessionId, "one");
  assert.equal(tickets.consume(protocols, "viewer"), null);
});

test("answers browser preflights only for allowed origins", async (context) => {
  let origin = "http://127.0.0.1";
  const gateway = createBrowserSessionGateway({
    publicOrigin: () => origin,
    allowedRequestOrigins: ["http://localhost:55490"],
    authenticate: () => null,
    authorize: () => false,
  });
  await new Promise((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve),
  );
  const address = gateway.server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  context.after(() => gateway.close());

  const allowed = await fetch(`${origin}/v1/sessions/example/connections`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:55490",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
      "access-control-request-private-network": "true",
    },
  });
  assert.equal(allowed.status, 204);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "http://localhost:55490",
  );
  assert.equal(
    allowed.headers.get("access-control-allow-private-network"),
    "true",
  );

  const denied = await fetch(`${origin}/v1/sessions/example/connections`, {
    method: "OPTIONS",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("terminates a session only with explicit authorization", async (context) => {
  let origin = "http://127.0.0.1";
  const gateway = createBrowserSessionGateway({
    publicOrigin: () => origin,
    authenticate(request, action) {
      if (
        action.startsWith("source:") &&
        request.headers.authorization === "Bearer source"
      ) {
        return { id: "source", kind: "service" };
      }
      if (
        action === "viewer:terminate" &&
        request.headers.authorization === "Bearer owner"
      ) {
        return { id: "owner", kind: "user" };
      }
      if (
        action === "viewer:observe" &&
        request.headers.authorization === "Bearer owner"
      ) {
        return { id: "owner", kind: "user" };
      }
      return null;
    },
    authorize: ({ capability }) =>
      capability === "observe" || capability === "terminate",
  });
  await new Promise((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve),
  );
  const address = gateway.server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  context.after(() => gateway.close());

  const created = await (
    await fetch(`${origin}/v1/sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer source",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "End me",
        viewport: { width: 1280, height: 800 },
      }),
    })
  ).json();
  const request = {
    version: 1,
    sessionId: created.session.sessionId,
    clientInstanceId: "owner_phone",
    reason: "user-ended",
  };
  const source = await openSocket(created.sourceConnection);
  const viewerResolution = await (
    await fetch(
      `${origin}/v1/sessions/${created.session.sessionId}/connections`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer owner",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          intent: "observe",
          clientInstanceId: "owner_phone",
        }),
      },
    )
  ).json();
  const viewer = await openSocket(viewerResolution.connection);
  const sourceClosed = new Promise((resolve) => source.once("close", resolve));
  const viewerClosed = new Promise((resolve) => viewer.once("close", resolve));

  const denied = await fetch(
    `${origin}/v1/sessions/${created.session.sessionId}/end`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  assert.equal(denied.status, 401);

  const ended = await fetch(
    `${origin}/v1/sessions/${created.session.sessionId}/end`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  assert.equal(ended.status, 200);
  const receipt = await ended.json();
  assert.equal(receipt.status, "ended");
  assert.equal(receipt.reason, "user-ended");
  await Promise.all([sourceClosed, viewerClosed]);

  const reconnect = await fetch(
    `${origin}/v1/sessions/${created.session.sessionId}/source-connections`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer source",
        "content-type": "application/json",
      },
    },
  );
  assert.equal(reconnect.status, 410);
});

test("fans one source out to view-only authenticated viewers", async (context) => {
  let origin = "http://127.0.0.1";
  const gateway = createBrowserSessionGateway({
    publicOrigin: () => origin,
    authenticate(request, action) {
      const token = request.headers.authorization;
      if (action.startsWith("source:") && token === "Bearer source-secret") {
        return { id: "source-one", kind: "service" };
      }
      if (action === "viewer:observe" && token === "Bearer viewer-secret") {
        return { id: "viewer-one", kind: "user" };
      }
      return null;
    },
    authorize: ({ capability }) => capability === "observe",
  });
  await new Promise((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve),
  );
  const address = gateway.server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  context.after(() => gateway.close());

  const unauthorized = await fetch(`${origin}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "No",
      viewport: { width: 1280, height: 800 },
    }),
  });
  assert.equal(unauthorized.status, 401);

  const createdResponse = await fetch(`${origin}/v1/sessions`, {
    method: "POST",
    headers: {
      authorization: "Bearer source-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: "Configure analytics",
      viewport: { width: 1280, height: 800 },
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const source = await openSocket(created.sourceConnection);

  const viewerConnection = async (clientInstanceId) => {
    const response = await fetch(
      `${origin}/v1/sessions/${created.session.sessionId}/connections`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer viewer-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ intent: "observe", clientInstanceId }),
      },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const [viewerOneResolution, viewerTwoResolution] = await Promise.all([
    viewerConnection("viewer_one"),
    viewerConnection("viewer_two"),
  ]);
  assert.deepEqual(viewerOneResolution.access.capabilities, ["observe"]);
  const viewerOne = await openSocket(viewerOneResolution.connection);
  const viewerTwo = await openSocket(viewerTwoResolution.connection);

  const frameOne = nextMessage(viewerOne, "frame");
  const frameTwo = nextMessage(viewerTwo, "frame");
  source.send(
    JSON.stringify({
      v: 1,
      type: "source.frame",
      codec: "image/jpeg",
      data: "/9gBAgP/2Q==",
      width: 1280,
      height: 800,
    }),
  );
  assert.equal((await frameOne).data, "/9gBAgP/2Q==");
  assert.equal((await frameTwo).sourceEpoch, (await frameOne).sourceEpoch);

  const binaryResolution = await (
    await fetch(
      `${origin}/v1/sessions/${created.session.sessionId}/connections`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer viewer-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          intent: "observe",
          clientInstanceId: "viewer_binary",
          frameEncodings: ["binary-jpeg"],
        }),
      },
    )
  ).json();
  assert.equal(binaryResolution.connection.frameEncoding, "binary-jpeg");
  const binaryViewer = await openSocket(binaryResolution.connection);
  const binaryFrame = nextBinaryMessage(binaryViewer, 2);
  const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  source.send(
    encodeBrowserSessionBinaryFrame(
      {
        v: 1,
        type: "frame",
        codec: "image/jpeg",
        width: 1280,
        height: 800,
        capturedAt: Date.now(),
        sourceEpoch: "adapter-epoch",
        frameSequence: 2,
        viewportRevision: 0,
        metadata: {
          deviceWidth: 1280,
          deviceHeight: 800,
          pageScaleFactor: 1,
          offsetTop: 0,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
        },
      },
      jpeg,
    ),
  );
  const decoded = decodeBrowserSessionBinaryFrame(await binaryFrame);
  assert.deepEqual(decoded?.jpeg, jpeg);

  const closed = new Promise((resolve) =>
    viewerOne.once("close", (code) => resolve(code)),
  );
  viewerOne.send(
    JSON.stringify({ v: 1, type: "input", event: { kind: "pointer" } }),
  );
  assert.equal(await closed, 1008);
  viewerTwo.close();
  binaryViewer.close();
  source.close();
  assert.equal(gateway.getMetrics().sourceFramesReceived, 2);
});

test("grants one viewer control and forwards only its validated input", async (context) => {
  let origin = "http://127.0.0.1";
  const gateway = createBrowserSessionGateway({
    publicOrigin: () => origin,
    authenticate(request, action) {
      const token = request.headers.authorization;
      if (action.startsWith("source:") && token === "Bearer source-secret") {
        return { id: "source-one", kind: "service" };
      }
      if (action.startsWith("viewer:") && token === "Bearer viewer-secret") {
        return { id: "viewer-one", kind: "user" };
      }
      return null;
    },
    authorize: () => true,
  });
  await new Promise((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve),
  );
  const address = gateway.server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  context.after(() => gateway.close());

  const created = await (
    await fetch(`${origin}/v1/sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer source-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Control",
        viewport: { width: 1280, height: 800 },
      }),
    })
  ).json();
  const source = await openSocket(created.sourceConnection);
  const connectViewer = async (clientInstanceId) => {
    const resolution = await (
      await fetch(
        `${origin}/v1/sessions/${created.session.sessionId}/connections`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer viewer-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ intent: "observe", clientInstanceId }),
        },
      )
    ).json();
    return openSocket(resolution.connection);
  };
  const viewer = await connectViewer("controller_one");
  const observer = await connectViewer("observer_two");

  const acquire = await fetch(
    `${origin}/v1/sessions/${created.session.sessionId}/control`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer viewer-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "acquire",
        clientInstanceId: "controller_one",
      }),
    },
  );
  assert.equal(acquire.status, 200);
  const acquired = await acquire.json();
  assert.equal(acquired.access.controllerId, "viewer-one");
  assert.ok(acquired.access.lease.id.startsWith("lease_"));

  const forwarded = nextMessage(source, "source.input");
  viewer.send(
    JSON.stringify({
      type: "input_mouse",
      eventType: "mousePressed",
      x: 640,
      y: 400,
      button: "left",
      clickCount: 1,
      modifiers: 0,
    }),
  );
  assert.equal((await forwarded).input.eventType, "mousePressed");

  const busy = await fetch(
    `${origin}/v1/sessions/${created.session.sessionId}/control`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer viewer-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "acquire",
        clientInstanceId: "observer_two",
      }),
    },
  );
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error, "control_busy");

  viewer.close();
  observer.close();
  source.close();
});

async function openSocket(connection) {
  const socket = new WebSocket(connection.url, connection.protocols);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function nextMessage(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      2_000,
    );
    const listener = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

function nextBinaryMessage(socket, frameSequence) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for binary frame")),
      2_000,
    );
    const listener = (data, isBinary) => {
      if (!isBinary) return;
      if (
        decodeBrowserSessionBinaryFrame(data)?.header.frameSequence !==
        frameSequence
      )
        return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(data);
    };
    socket.on("message", listener);
  });
}
