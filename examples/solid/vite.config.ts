import csslit from "@csslit/vite-plugin";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [csslit(), solid()],
});
