import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
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
      },
      dev: {
        command: "vp pack --watch",
      },
    },
  },
});
