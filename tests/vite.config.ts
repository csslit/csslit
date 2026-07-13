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
        command: "vp test --reporter agent",
        dependsOn: ["@csslit/vite-plugin#build", "@csslit/core#build"],
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      check: {
        command: "vp test --reporter ./concise-reporter.ts",
        dependsOn: ["@csslit/vite-plugin#build", "@csslit/core#build"],
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
    },
  },
});
