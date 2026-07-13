# @csslit/transform

Native and WebAssembly transforms used internally by `@csslit/vite-plugin`.

Most users should install `@csslit/core` and `@csslit/vite-plugin` instead of using this package directly. See the [project README](https://github.com/csslit/csslit#readme) for details.

Release artifacts are built with napi-rs for Windows x64, Linux x64 glibc, Linux x64 musl, and `wasm32-wasip1-threads`. The generated loader prefers a matching native package and falls back to WASI on unsupported platforms. Linux cross-compilation requires [Zig](https://ziglang.org/download/) on `PATH`.

Run the complete local release build with `vp run -w release`, which builds every publishable package in the workspace. The underscore-prefixed `_napi_build_*` tasks are internal to this package and named after the napi-rs build they run. The release tasks only build, assemble, and validate packages; they never publish them.
