import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
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
      },
      dev: {
        command: "vp pack --watch",
      },
    },
  },
});
