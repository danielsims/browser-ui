import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const distDirectory = new URL("../dist/", import.meta.url);
const files = await readdir(distDirectory);
const generatedStyles = files.find((file) => /^styles-[\w-]+\.css$/.test(file));

if (!generatedStyles) throw new Error("tsup did not emit the Browser UI stylesheet.");

await copyFile(new URL(generatedStyles, distDirectory), new URL("styles.css", distDirectory));

for (const entrypoint of ["index.js", "index.cjs"]) {
  const entrypointUrl = new URL(entrypoint, distDirectory);
  const source = await readFile(entrypointUrl, "utf8");
  await writeFile(entrypointUrl, source.replaceAll(generatedStyles, "styles.css"));
}
