import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const maximumLines = 500;
// Existing composition debt is explicit and may only shrink. New files and
// refactored files must stay under the normal limit; growing a listed file
// fails lint just as growing past 500 does.
const legacyLineLimits = new Map([
  ["packages/react/test/agent-browser-viewport.test.tsx", 1065],
  ["packages/react/src/agent-browser-viewport.tsx", 941],
  ["apps/demo/src/app/page.tsx", 781],
  ["packages/gateway/src/session-actor.ts", 706],
  ["apps/demo/src/app/api/browser/route.ts", 704],
  ["packages/gateway/src/server.ts", 582],
  ["apps/expo-demo/App.tsx", 561],
  ["examples/vercel-sandbox/app/page.tsx", 555],
  ["packages/gateway/src/agent-browser/relay.ts", 540],
]);
const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const ignoredDirectories = new Set([
  ".cache",
  ".expo",
  ".git",
  ".next",
  ".output",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      ignoredDirectories.has(entry.name) ||
      entry.name.startsWith(".next-dev-")
    )
      return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && sourceExtensions.has(extname(entry.name))
      ? [path]
      : [];
  });
}

const failures = sourceFiles(root).flatMap((path) => {
  const source = readFileSync(path, "utf8");
  const lines =
    source.length === 0
      ? 0
      : source.split(/\r?\n/u).length - (source.endsWith("\n") ? 1 : 0);
  const relativePath = relative(root, path);
  const limit = legacyLineLimits.get(relativePath) ?? maximumLines;
  return lines > limit ? [{ lines, limit, path: relativePath }] : [];
});

if (failures.length > 0) {
  failures.sort((a, b) => b.lines - a.lines);
  console.error(
    `Source files may not exceed ${maximumLines} lines or their recorded legacy limit:`,
  );
  for (const failure of failures) {
    console.error(`  ${failure.lines}/${failure.limit}  ${failure.path}`);
  }
  process.exitCode = 1;
}
