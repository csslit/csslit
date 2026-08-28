const { createRequire } = require("node:module");
const { resolve } = require("node:path");

const localRequire = createRequire(resolve(__dirname, "../package.json"));
require("vue-tsc").run(localRequire.resolve("typescript/lib/tsc"));
