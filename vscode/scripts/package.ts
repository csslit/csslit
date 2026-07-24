import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createVSIX } from "@vscode/vsce";

// vsce follows the @csslit/typescript-plugin workspace symlink out into the whole monorepo, so
// install a real copy of the plugin under node_modules and package from this clean dist/ root
// instead. --install-links copies the built package rather than symlinking it; it is the same
// content published to npm as long as it is built from the same repo state. The npm-written
// node_modules lock is not wanted in the vsix.
execSync(
  "npm install ../packages/typescript-plugin --install-links --prefix dist --no-save --no-package-lock --ignore-scripts --omit=dev --offline",
  { stdio: "inherit" },
);
rmSync("dist/node_modules/.package-lock.json", { force: true });
const pluginVersion = JSON.parse(
  readFileSync("dist/node_modules/@csslit/typescript-plugin/package.json", "utf8"),
).version;

mkdirSync("dist/dist/licenses", { recursive: true });
copyFileSync("../node_modules/typescript/LICENSE", "dist/dist/licenses/typescript.txt");
copyFileSync("../node_modules/typescript/NOTICE.txt", "dist/dist/licenses/typescript-notice.txt");

copyFileSync("ARCHITECTURE.md", "dist/ARCHITECTURE.md");
copyFileSync("LICENSE", "dist/LICENSE");
copyFileSync("README.md", "dist/README.md");
copyFileSync("ThirdPartyNotices.txt", "dist/ThirdPartyNotices.txt");

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
manifest.dependencies = { "@csslit/typescript-plugin": pluginVersion };
writeFileSync("dist/package.json", JSON.stringify(manifest, null, 2) + "\n");

await createVSIX({
  cwd: resolve("dist"),
  packagePath: resolve("dist/csslit-vscode.vsix"),
  dependencies: true,
});
