import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "napi build --platform --esm --js index.js --dts index.d.ts -o dist -- -q",
        input: [{ auto: true }, "!dist/**"],
      },
      dev: {
        command: "napi watch --platform --esm --js index.js --dts index.d.ts -o dist",
      },
      release_napi_build_esm: {
        command: [
          "napi build --platform --esm --release --js index.js --dts index.d.ts -o dist -- -q",
          "node scripts/patch-loader.mjs",
        ],
        cache: false,
      },
      release_napi_build_windows: {
        command:
          "napi build --target x86_64-pc-windows-msvc --platform --esm --release --no-js -o artifacts/x86_64-pc-windows-msvc -- -q",
        cache: false,
      },
      release_napi_build_linux_gnu: {
        command:
          "napi build --target x86_64-unknown-linux-gnu --platform --release --no-js --cross-compile -o artifacts/x86_64-unknown-linux-gnu -- -q",
        cache: false,
      },
      release_napi_build_linux_musl: {
        command:
          "napi build --target x86_64-unknown-linux-musl --platform --release --no-js --cross-compile -o artifacts/x86_64-unknown-linux-musl -- -q",
        cache: false,
      },
      release_napi_build_wasi: {
        command:
          "napi build --target wasm32-wasip1-threads --platform --esm --release --js index.js --dts index.d.ts -o artifacts/wasm32-wasip1-threads -- -q",
        cache: false,
      },
      release: {
        command: [
          "napi create-npm-dirs",
          "napi artifacts --output-dir artifacts --build-output-dir artifacts/wasm32-wasip1-threads --npm-dir npm",
          "napi pre-publish --npm-dir npm --dry-run",
        ],
        dependsOn: [
          "release_napi_build_esm",
          "release_napi_build_windows",
          "release_napi_build_linux_gnu",
          "release_napi_build_linux_musl",
          "release_napi_build_wasi",
        ],
        cache: false,
      },
    },
  },
});
