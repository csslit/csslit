# @csslit/rust-transformer

Native and WebAssembly transforms used internally by `@csslit/vite-plugin`.

Most users should install `csslit` and `@csslit/vite-plugin` instead of using this package directly. See the [project README](https://github.com/csslit/csslit#readme) for details.

Release artifacts are built with napi-rs for Windows x64, Linux x64 glibc, Linux x64 musl, and `wasm32-wasip1-threads`. The generated loader prefers a matching native package and falls back to WASI on unsupported platforms. Linux cross-compilation requires [Zig](https://ziglang.org/download/) on `PATH`.

Run the complete local release build with `vp run @csslit/rust-transformer#release`. The `release_napi_*` tasks it depends on are named after the napi-rs command they run and can be invoked individually. The release task only builds, assembles, and validates packages; it never publishes them.
