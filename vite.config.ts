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
      _check_examples: {
        command: [
          "npm run build --workspace=example-octane --workspace=example-preact --workspace=example-react --workspace=example-react-router --workspace=example-solid --workspace=example-vue",
          "npm run typecheck --if-present --workspace=example-octane --workspace=example-preact --workspace=example-react --workspace=example-react-router --workspace=example-solid --workspace=example-vue",
        ],
        dependsOn: ["@csslit/core#build", "@csslit/vite-plugin#build"],
        output: [
          "examples/*/dist/**",
          "examples/react-router/.react-router/types/**",
          "examples/react-router/build/**",
        ],
      },
      check: {
        command: "echo check complete",
        dependsOn: [
          "_check_vp_lint",
          "_check_cargo_check",
          "_check_cargo_test",
          "_check_examples",
          "tests#check",
          "csslit-vscode#check",
        ],
      },
      clean: {
        command: "echo clean complete",
        dependsOn: [
          "@csslit/core#clean",
          "@csslit/vite-plugin#clean",
          "@csslit/transform#clean",
          "@csslit/typescript-plugin#clean",
        ],
        cache: false,
      },
      release: {
        command: "echo release artifacts ready",
        dependsOn: [
          "clean",
          "@csslit/core#release",
          "@csslit/vite-plugin#release",
          "@csslit/transform#release",
          "@csslit/typescript-plugin#release",
        ],
        cache: false,
      },
    },
  },
  test: {
    include: [],
    projects: ["./tests", "./vscode"],
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
      "eslint/no-empty-pattern": "off",
      "typescript/consistent-type-imports": "error",
    },
  },
  fmt: {},
});
