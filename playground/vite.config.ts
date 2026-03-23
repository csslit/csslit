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
});
