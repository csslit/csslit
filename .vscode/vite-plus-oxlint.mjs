// npm links `node_modules/.bin/oxlint` to upstream Oxlint instead of Vite+'s
// config-aware LSP wrapper. `oxc.path.oxlint` points here because VS Code must
// launch the extensionless Vite+ wrapper through Node on Windows.
// https://github.com/voidzero-dev/vite-plus/issues/1482
// oxlint-disable-next-line import/extensions -- The Vite+ executable is intentionally extensionless.
import "../node_modules/vite-plus/bin/oxlint";
