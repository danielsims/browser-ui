import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const versionFile = resolve(process.argv[2] ?? ".nvmrc");
const expected = readFileSync(versionFile, "utf8").trim().replace(/^v/, "");
const actual = process.versions.node;

if (actual !== expected) {
  throw new Error(
    `Browser UI requires Node ${expected}; running ${actual} from ${process.execPath}`,
  );
}

process.stdout.write(
  `Node ${actual} (${process.arch}) from ${process.execPath}\n`,
);
