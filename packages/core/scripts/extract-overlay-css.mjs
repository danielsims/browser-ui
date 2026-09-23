/**
 * Generate `src/agent-overlay-css.ts` from the React package's stylesheet.
 *
 * The operating overlay and agent cursor are styled once, in the React package.
 * React Native injects its overlay into the WebView page and must look exactly
 * the same, so rather than re-implementing the CSS we extract the relevant rules
 * from `packages/react/src/styles.css` verbatim. Generated, never hand-edited, so
 * the two platforms cannot drift.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const stylesPath = fileURLToPath(
  new URL("../../react/src/styles.css", import.meta.url),
);
const outputPath = fileURLToPath(
  new URL("../src/agent-overlay-css.ts", import.meta.url),
);

const PREFIXES = [".bui-operating-", ".bui-agent-cursor"];
const KEYFRAMES = ["bui-operating-", "bui-cursor-"];

const css = await readFile(stylesPath, "utf8");

/** Walk the stylesheet, keeping whole top-level blocks that mention our classes. */
function extract(source) {
  const blocks = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open === -1) break;
    const prelude = source.slice(index, open);
    // Find the matching close brace for this block.
    let depth = 0;
    let cursor = open;
    while (cursor < source.length) {
      if (source[cursor] === "{") depth += 1;
      else if (source[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      cursor += 1;
    }
    const block = source.slice(index, cursor + 1);
    if (wanted(prelude, block)) blocks.push(block.trim());
    index = cursor + 1;
  }
  return blocks.join("\n");
}

function wanted(prelude, block) {
  const selector = prelude.trim();
  if (PREFIXES.some((prefix) => selector.includes(prefix))) return true;
  if (selector.startsWith("@keyframes")) {
    return KEYFRAMES.some((name) => selector.includes(name));
  }
  if (selector.startsWith("@media")) {
    return PREFIXES.some((prefix) => block.includes(prefix));
  }
  return false;
}

const extracted = extract(css);
if (!extracted.includes(".bui-operating-status")) {
  throw new Error("Overlay CSS extraction failed: no operating rules found.");
}
if (!extracted.includes(".bui-agent-cursor > svg")) {
  throw new Error("Overlay CSS extraction failed: no cursor rules found.");
}

const contents = `/**
 * GENERATED, do not edit. Produced from packages/react/src/styles.css by
 * scripts/extract-overlay-css.mjs so the React and React Native overlays share
 * one stylesheet. Run \`pnpm --filter @browser-ui/core sync:overlay-css\`.
 */
export const agentOverlayCss = ${JSON.stringify(extracted)};
`;

await writeFile(outputPath, contents);
console.log(
  `Wrote ${outputPath} (${extracted.length} bytes, ${extracted.split("\n").length} lines).`,
);
