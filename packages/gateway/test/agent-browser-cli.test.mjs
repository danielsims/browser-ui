import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../dist/agent-browser/cli.js", import.meta.url),
);

test("ships a self-describing agent-browser source CLI", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  const version = execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });
  assert.match(help, /browser-ui-agent-browser-source/);
  assert.equal(version.trim(), "0.2.0");
});
