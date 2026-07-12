import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      check_vp_fmt: {
        command: "vp fmt --list-different",
        input: [{ auto: true }, "!node_modules/.vite-temp/**"],
      },
      check_cargo_fmt: {
        command: "cargo fmt --check",
      },
      check_vp_lint: {
        command: "vp lint --format agent",
        input: [{ auto: true }, "!node_modules/.vite-temp/**"],
      },
      check_cargo_check: {
        command: "cargo check -q",
      },
      check: {
        command: "echo check complete",
        dependsOn: [
          "check_vp_fmt",
          "check_cargo_fmt",
          "check_vp_lint",
          "check_cargo_check",
          "tests#check",
        ],
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
