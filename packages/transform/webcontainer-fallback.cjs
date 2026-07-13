// Adapted from oxc-parser's WebContainer fallback, which downloads the matching
// WASI binding package on demand instead of using a postinstall hook:
// https://github.com/oxc-project/oxc/blob/main/napi/parser/src-js/webcontainer-fallback.cjs
// Only the package and binding names differ from the original. This file only runs
// inside StackBlitz WebContainers (guarded in the patched loader), where /tmp and
// pnpm are always available.

const fs = require("node:fs");
const childProcess = require("node:child_process");

const pkg = JSON.parse(fs.readFileSync(require.resolve("./package.json"), "utf-8"));
const { version } = pkg;
const baseDir = `/tmp/csslit-transform-${version}`;
const bindingEntry = `${baseDir}/node_modules/@csslit/transform-wasm32-wasi/csslit-transformer.wasi.cjs`;

if (!fs.existsSync(bindingEntry)) {
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.mkdirSync(baseDir, { recursive: true });
  const bindingPkg = `@csslit/transform-wasm32-wasi@${version}`;
  console.log(`[csslit] Downloading ${bindingPkg} on WebContainer...`);
  childProcess.execFileSync("pnpm", ["i", bindingPkg], {
    cwd: baseDir,
    stdio: "inherit",
  });
}

module.exports = require(bindingEntry);
