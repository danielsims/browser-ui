import path from "node:path";

const workspaceDirectories = [
  "apps/demo",
  "apps/expo-demo",
  "apps/gateway-demo",
  "examples/vercel-sandbox",
  "packages/core",
  "packages/gateway",
  "packages/react",
  "packages/react-native",
];

const quote = (value) => JSON.stringify(value);

function formatFiles(files) {
  return `prettier --write --ignore-unknown ${files.map(quote).join(" ")}`;
}

function lintWorkspaceFiles(files) {
  const root = process.cwd();

  return workspaceDirectories.flatMap((directory) => {
    const workspaceRoot = path.join(root, directory);
    const workspaceFiles = files
      .filter((file) => file.startsWith(`${workspaceRoot}${path.sep}`))
      .map((file) => path.relative(workspaceRoot, file));

    if (workspaceFiles.length === 0) return [];

    return `pnpm --dir ${quote(directory)} exec eslint --fix --no-warn-ignored --flag unstable_native_nodejs_ts_config ${workspaceFiles.map(quote).join(" ")}`;
  });
}

export default {
  "*": formatFiles,
  "*.{cjs,js,jsx,mjs,ts,tsx}": lintWorkspaceFiles,
};
