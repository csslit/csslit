import csslit from "@csslit/vite-plugin";
import { defineConfig } from "astro/config";

export default defineConfig({
  vite: {
    plugins: [csslit({ moduleType: { ".astro": "js" } })],
  },
});
