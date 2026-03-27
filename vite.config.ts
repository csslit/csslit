import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["import"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "typescript/consistent-type-imports": "error",
    },
  },
  fmt: {},
});
