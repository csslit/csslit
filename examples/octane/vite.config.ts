import { octane } from "@octanejs/vite-plugin";
import csslit from "@csslit/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [octane(), csslit({ moduleType: { ".tsrx": "js" } })],
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
