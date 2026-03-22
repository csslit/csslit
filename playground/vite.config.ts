import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cssCompilePlugin } from '@csslit/vite-plugin';
import Inspect from 'vite-plugin-inspect';

export default defineConfig({
  plugins: [
    cssCompilePlugin(),
    react(),
    Inspect()
  ],
  build: {
    minify: false,
    cssMinify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
});
