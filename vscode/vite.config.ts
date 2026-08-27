import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  test: {
    experimental: {
      viteModuleRunner: false,
    },
    projects: [
      {
        extends: true,
        test: {
          name: "fast",
          include: ["src/**/*.test.ts"],
          provide: { backend: "harness" },
        },
      },
      {
        extends: true,
        test: {
          name: "slow",
          include: ["src/templates.test.ts"],
          provide: { backend: "serve-web" },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
  pack: {
    define: {
      __CSSLIT_TESTING__: "true",
    },
    entry: {
      extension: "src/extension.ts",
    },
    copy: "generated/syntaxes",
    deps: {
      neverBundle: ["vscode"],
    },
    fixedExtension: false,
    format: "esm",
    platform: "node",
    sourcemap: true,
    exports: false,
  },
  run: {
    tasks: {
      grammars: {
        command: "node grammar/build-grammars.ts",
        output: ["generated/syntaxes/**"],
      },
      build: {
        command: "vp pack -l silent",
        dependsOn: ["grammars", "@csslit/typescript-plugin#build"],
        output: ["dist/**"],
      },
      test: {
        command: "vp test --project fast --reporter agent",
        dependsOn: ["grammars", "@csslit/typescript-plugin#build"],
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      "serve-web-fixture": {
        command: "node scripts/serve-web-fixture.ts",
        input: [
          "src/testing/frameworks.ts",
          "src/testing/vscode-harness.ts",
          "scripts/serve-web-fixture.ts",
        ],
        output: [
          "fixtures/serve-web/fixture.json",
          "fixtures/serve-web/*/extensions/**",
          "fixtures/serve-web/*/workspace/**",
        ],
      },
      "test-slow": {
        command: "vp test --project slow --reporter agent",
        dependsOn: ["build", "@csslit/typescript-plugin#build", "serve-web-fixture"],
        cache: false,
      },
      check: {
        command: "vp test --project fast --reporter agent",
        dependsOn: ["grammars", "@csslit/typescript-plugin#build"],
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      dev: {
        command: "vp pack --watch",
        dependsOn: ["grammars"],
      },
      clean: {
        command: [clean("dist"), clean("generated")],
        cache: false,
      },
      release: {
        command: [
          "node grammar/build-grammars.ts",
          "vp pack -l silent --minify --no-sourcemap -d dist/dist --define.__CSSLIT_TESTING__=false",
          "node scripts/package.ts",
        ],
        dependsOn: ["clean", "@csslit/typescript-plugin#release"],
        cache: false,
      },
      publish: {
        command:
          "echo Upload dist/csslit-vscode.vsix at https://marketplace.visualstudio.com/manage/publishers/csslit",
        cache: false,
      },
      install: {
        command: "code --install-extension dist/csslit-vscode.vsix --force",
        dependsOn: ["release"],
        cache: false,
      },
    },
  },
});
