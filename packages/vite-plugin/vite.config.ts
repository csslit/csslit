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
    exports: {
      exclude: ["eval-runtime"],
    },
  },
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: ["@csslit/rust-transformer#build"],
      },
      dev: {
        command: "vp pack --watch",
        dependsOn: ["@csslit/rust-transformer#dev"],
      },
    },
  },
});
