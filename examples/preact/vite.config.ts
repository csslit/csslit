import preact from "@preact/preset-vite";
import csslit from "@csslit/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [csslit(), preact()],
});
