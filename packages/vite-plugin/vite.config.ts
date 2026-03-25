import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: {
      tsgo: true,
    },
    format: "esm",
    fixedExtension: false,
    sourcemap: true,
    exports: true,
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
