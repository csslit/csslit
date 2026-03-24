import { defineConfig } from "vite-plus";
import { cssCompilePlugin } from "@csslit/vite-plugin";

export default defineConfig({
  plugins: [cssCompilePlugin()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
  },
});
