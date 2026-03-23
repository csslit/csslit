import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "napi build --platform --esm --release -o dist",
      },
      dev: {
        command: "napi watch --platform --esm -o dist",
      },
    },
  },
});
