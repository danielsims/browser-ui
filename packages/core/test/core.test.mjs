import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  browserControlState,
  browserKeyboardInput,
  canSendBrowserInput,
  describeAgentBrowserCommand,
  mapContainedPointToViewport,
  parseAgentBrowserMessage,
} from "../dist/index.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../../flutter/test/fixtures/protocol/messages.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("maps contained points and rejects letterboxing", () => {
  const container = { width: 400, height: 400 };
  const viewport = { width: 400, height: 200 };
  assert.equal(
    mapContainedPointToViewport({ x: 200, y: 50 }, container, viewport),
    null,
  );
  assert.deepEqual(
    mapContainedPointToViewport({ x: 200, y: 200 }, container, viewport),
    { x: 200, y: 100 },
  );
});

test("parses supported agent-browser messages tolerantly", () => {
  assert.deepEqual(
    parseAgentBrowserMessage(
      JSON.stringify({
        type: "status",
        connected: true,
        screencasting: true,
        viewportWidth: 1280,
        viewportHeight: 800,
        engine: "chrome",
        futureField: "ignored",
      }),
    )?.type,
    "status",
  );
  assert.equal(
    parseAgentBrowserMessage({ type: "status", connected: true }),
    null,
  );
  assert.equal(parseAgentBrowserMessage({ type: "future-message" }), null);
});

test("describes browser commands without exposing entered values", () => {
  assert.equal(
    describeAgentBrowserCommand("open", {
      url: "https://example.com/private?token=secret",
    }),
    "Opening example.com",
  );
  assert.equal(
    describeAgentBrowserCommand("fill", {
      selector: "#password",
      value: "hunter2",
    }),
    "Entering text",
  );
  assert.equal(describeAgentBrowserCommand("snapshot", {}), "Reading the page");
});

test("matches the shared agent-browser protocol fixtures", () => {
  for (const fixture of fixtures.agentBrowserMessages) {
    const message = parseAgentBrowserMessage(fixture.message);
    assert.equal(message !== null, fixture.valid, fixture.name);
    if (message) assert.equal(message.type, fixture.kind, fixture.name);
  }
});

test("maps punctuation and modifiers to browser keyboard input", () => {
  assert.deepEqual(
    browserKeyboardInput(
      {
        altKey: false,
        code: "Slash",
        ctrlKey: true,
        key: "?",
        metaKey: false,
        shiftKey: true,
      },
      "keyDown",
    ),
    {
      type: "input_keyboard",
      eventType: "keyDown",
      key: "?",
      code: "Slash",
      text: "?",
      windowsVirtualKeyCode: 191,
      modifiers: 10,
    },
  );
});

test("derives presentation state without pretending to authorize", () => {
  const owner = { id: "one", displayName: "One", kind: "user" };
  const friend = { id: "two", displayName: "Two", kind: "user" };
  assert.equal(
    browserControlState({
      owner,
      viewer: friend,
      visibility: "channel",
      capabilities: ["observe", "control"],
      controller: owner,
    }),
    "controlled-by-other",
  );
  assert.equal(
    canSendBrowserInput({
      owner,
      viewer: friend,
      visibility: "channel",
      capabilities: ["observe", "control"],
      controller: friend,
      lease: {
        id: "lease-one",
        holder: friend,
        expiresAt: "2999-07-28T12:00:00.000Z",
        renewable: true,
      },
    }),
    true,
  );
  assert.equal(
    canSendBrowserInput({
      owner,
      viewer: friend,
      visibility: "channel",
      capabilities: ["observe", "control"],
      controller: friend,
    }),
    false,
  );
  assert.equal(
    canSendBrowserInput({
      owner,
      viewer: friend,
      visibility: "channel",
      capabilities: ["observe", "control"],
      controller: friend,
      lease: {
        id: "expired-lease",
        holder: friend,
        expiresAt: "2000-01-01T00:00:00.000Z",
        renewable: false,
      },
    }),
    false,
  );
});
