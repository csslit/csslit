import { reactRouter } from "@react-router/dev/vite";
import csslit from "@csslit/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [reactRouter(), csslit()],
});
