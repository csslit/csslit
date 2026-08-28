import { octane } from "@octanejs/vite-plugin";
import csslit from "@csslit/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [octane(), csslit({ moduleType: { ".tsrx": "js" } })],
});
