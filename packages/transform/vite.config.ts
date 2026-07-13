import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "napi build --platform --esm --js index.js --dts index.d.ts -o dist -- -q",
        input: [{ auto: true }, "!dist/**"],
        output: ["dist/**"],
      },
      dev: {
        command: "napi watch --platform --esm --js index.js --dts index.d.ts -o dist",
      },
      clean: {
        command: [clean("dist"), clean("artifacts"), clean("npm"), clean("*.{node,wasm}")],
        cache: false,
      },
      _napi_build_esm: {
        command: [
          "napi build --platform --esm --release --js index.js --dts index.d.ts -o dist -- -q",
          "node scripts/patch-loader.mjs",
        ],
        dependsOn: ["clean"],
        cache: false,
      },
      _napi_build_windows: {
        command:
          "napi build --target x86_64-pc-windows-msvc --platform --esm --release --no-js -o artifacts/x86_64-pc-windows-msvc -- -q",
        dependsOn: ["clean"],
        cache: false,
      },
      _napi_build_linux_gnu: {
        command:
          "napi build --target x86_64-unknown-linux-gnu --platform --release --no-js --cross-compile -o artifacts/x86_64-unknown-linux-gnu -- -q",
        dependsOn: ["clean"],
        cache: false,
      },
      _napi_build_linux_musl: {
        command:
          "napi build --target x86_64-unknown-linux-musl --platform --release --no-js --cross-compile -o artifacts/x86_64-unknown-linux-musl -- -q",
        dependsOn: ["clean"],
        cache: false,
      },
      _napi_build_wasi: {
        command:
          "napi build --target wasm32-wasip1-threads --platform --esm --release --js index.js --dts index.d.ts -o artifacts/wasm32-wasip1-threads -- -q",
        dependsOn: ["clean"],
        cache: false,
      },
      release: {
        command: [
          "napi create-npm-dirs",
          "napi artifacts --output-dir artifacts --build-output-dir artifacts/wasm32-wasip1-threads --npm-dir npm",
          "napi pre-publish --npm-dir npm --dry-run",
        ],
        dependsOn: [
          "clean",
          "_napi_build_esm",
          "_napi_build_windows",
          "_napi_build_linux_gnu",
          "_napi_build_linux_musl",
          "_napi_build_wasi",
        ],
        cache: false,
      },
    },
  },
});
