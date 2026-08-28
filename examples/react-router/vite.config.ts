import { reactRouter } from "@react-router/dev/vite";
import csslit from "@csslit/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [reactRouter(), csslit()],
  run: {
    tasks: {
      build: {
        command: "react-router build",
        dependsOn: ["@csslit/core#build", "@csslit/vite-plugin#build"],
        output: ["build/**"],
      },
      dev: {
        command: "react-router dev",
        dependsOn: ["@csslit/core#build", "@csslit/vite-plugin#build"],
      },
    },
  },
});
