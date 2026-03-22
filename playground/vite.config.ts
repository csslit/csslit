import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cssCompilePlugin } from '@csslit/vite-plugin';

export default defineConfig({
  plugins: [
    cssCompilePlugin(),
    react()
  ]
});
