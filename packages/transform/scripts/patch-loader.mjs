// Adapted from oxc-parser's loader patch, which inserts a WebContainer fallback
// into the napi-rs generated loader after each build:
// https://github.com/oxc-project/oxc/blob/main/napi/parser/scripts/patch.js
// Only the loader path and fallback location differ; the appended re-exports in
// the original do not apply here. Must run directly after `napi build`
// regenerates the loader, with the package root as the working directory.

import fs from "node:fs";

const filename = "./dist/index.js";
let data = fs.readFileSync(filename, "utf-8");

data = data.replace(
  "\nif (!nativeBinding) {",
  (s) =>
    `
if (!nativeBinding && globalThis.process?.versions?.["webcontainer"]) {
  try {
    nativeBinding = require('../webcontainer-fallback.cjs');
  } catch (err) {
    loadErrors.push(err)
  }
}
` + s,
);

fs.writeFileSync(filename, data);
