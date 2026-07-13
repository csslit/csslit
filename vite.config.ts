import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      _check_vp_fmt: {
        command: "vp fmt --list-different",
        input: [{ auto: true }, "!node_modules/.vite-temp/**"],
      },
      _check_cargo_fmt: {
        command: "cargo fmt --check",
      },
      _check_vp_lint: {
        command: "vp lint --format agent",
        input: [{ auto: true }, "!node_modules/.vite-temp/**"],
      },
      _check_cargo_check: {
        command: "cargo check -q",
      },
      check: {
        command: "echo check complete",
        dependsOn: [
          "_check_vp_fmt",
          "_check_cargo_fmt",
          "_check_vp_lint",
          "_check_cargo_check",
          "tests#check",
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
      "eslint/no-unused-expressions": "off",
      "typescript/consistent-type-imports": "error",
    },
  },
  fmt: {},
});
