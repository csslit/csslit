import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";
import { cssCompilePlugin } from "@csslit/vite-plugin";

export default defineConfig({
  plugins: [cssCompilePlugin()],
  test: {
    globals: true,
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
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
