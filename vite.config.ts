import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      format: {
        command: "vp fmt && cargo fmt",
        cache: false,
      },
      _check_vp_lint: {
        command: "vp lint --format agent",
        dependsOn: ["@csslit/vite-plugin#build", "@csslit/core#build"],
        input: [{ auto: true }, "!node_modules/.vite-temp/**"],
      },
      _check_cargo_check: {
        command: "cargo check -q",
      },
      _check_cargo_test: {
        command: "cargo test -q",
      },
      check: {
        command: "echo check complete",
        dependsOn: [
          "_check_vp_lint",
          "_check_cargo_check",
          "_check_cargo_test",
          "tests#check",
          "csslit-vscode#check",
        ],
      },
      clean: {
        command: "echo clean complete",
        dependsOn: ["@csslit/core#clean", "@csslit/vite-plugin#clean", "@csslit/transform#clean"],
        cache: false,
      },
      release: {
        command: "echo release artifacts ready",
        dependsOn: [
          "clean",
          "@csslit/core#release",
          "@csslit/vite-plugin#release",
          "@csslit/transform#release",
        ],
        cache: false,
      },
    },
  },
  test: {
    include: [],
    projects: ["./tests"],
  },
  lint: {
    plugins: ["import"],
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
    },
    rules: {
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "import/extensions": ["error", "ignorePackages", { checkTypeImports: true }],
      "eslint/no-unused-expressions": "off",
      "typescript/consistent-type-imports": "error",
    },
  },
  fmt: {},
});
