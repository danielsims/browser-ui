import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../dist/agent-browser/cli.js", import.meta.url),
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("ships a self-describing agent-browser source CLI", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  const version = execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });
  assert.match(help, /browser-ui-agent-browser-source/);
  assert.equal(version.trim(), packageJson.version);
});
