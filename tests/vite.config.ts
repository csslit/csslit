import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    experimental: {
      viteModuleRunner: false,
    },
  },
  run: {
    tasks: {
      test: {
        command: "vp test",
        dependsOn: ["@csslit/vite-plugin#build", "csslit#build"],
      },
    },
  },
});
