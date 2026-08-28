import mdx from "@mdx-js/rollup";
import csslit from "@csslit/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx() },
    csslit({ moduleType: { ".mdx": "js" } }),
    react({ include: /\.(js|jsx|md|mdx|ts|tsx)$/ }),
  ],
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
