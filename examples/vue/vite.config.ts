import csslit from "@csslit/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [vue(), csslit({ moduleType: { ".vue": "js" } })],
});
