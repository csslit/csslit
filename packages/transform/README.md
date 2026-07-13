# @csslit/transform

Native and WebAssembly transforms used internally by `@csslit/vite-plugin`.

Most users should install `@csslit/core` and `@csslit/vite-plugin` instead of using this package directly. See the [project README](https://github.com/csslit/csslit#readme) for details.

Native builds are provided for Windows x64, Linux x64 glibc, and Linux x64 musl, with a `wasm32-wasip1-threads` WebAssembly build as the fallback. The loader prefers a matching native package and falls back to WASI on unsupported platforms.
