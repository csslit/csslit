import csslit from "@csslit/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [vue(), csslit({ moduleType: { ".vue": "js" } })],
  run: {
    tasks: {
      build: {
        command: "vp build",
        dependsOn: ["@csslit/core#build", "@csslit/vite-plugin#build"],
        output: ["dist/**"],
      },
      dev: {
        command: "vp dev",
        dependsOn: ["@csslit/core#build", "@csslit/vite-plugin#build"],
      },
    },
  },
});
