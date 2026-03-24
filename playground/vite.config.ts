import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { cssCompilePlugin } from "@csslit/vite-plugin";

export default defineConfig({
  plugins: [cssCompilePlugin(), react()],
  build: {
    minify: false,
    cssMinify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  css: {
    devSourcemap: true,
  },
  run: {
    tasks: {
      build: {
        command: "vp build",
        dependsOn: ["@csslit/vite-plugin#build", "csslit#build"],
      },
      dev: {
        command: "vp dev",
        dependsOn: ["@csslit/vite-plugin#build", "csslit#build"],
      },
      preview: {
        command: "vp preview",
        dependsOn: ["@csslit/vite-plugin#build", "csslit#build"],
      },
    },
  },
});
