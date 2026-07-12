import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "eval-runtime": "src/eval-runtime.ts",
      index: "src/index.ts",
    },
    dts: {
      tsgo: true,
    },
    format: "esm",
    fixedExtension: false,
    sourcemap: true,
    exports: false,
  },
  run: {
    tasks: {
      build: {
        command: "vp pack -l silent",
        dependsOn: ["@csslit/rust-transformer#build"],
        env: ["CSSLIT_RELEASE"],
      },
      dev: {
        command: "vp pack --watch",
        dependsOn: ["@csslit/rust-transformer#dev"],
      },
    },
  },
});
