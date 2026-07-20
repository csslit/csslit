import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  test: {
    experimental: {
      viteModuleRunner: false,
    },
  },
  pack: {
    entry: {
      extension: "src/extension.ts",
    },
    copy: "generated/syntaxes",
    deps: {
      neverBundle: ["vscode"],
    },
    fixedExtension: false,
    format: "cjs",
    platform: "node",
    sourcemap: true,
    exports: false,
  },
  run: {
    tasks: {
      grammars: {
        command: "node grammar/build-grammars.mts",
        output: ["generated/syntaxes/**"],
      },
      build: {
        command: ["vp pack -l silent", "node scripts/copy-licenses.mts"],
        dependsOn: ["grammars"],
        output: ["dist/**"],
      },
      test: {
        command: "vp test --reporter agent",
        dependsOn: ["grammars"],
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      check: {
        command: "vp test --reporter agent",
        dependsOn: ["grammars"],
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      dev: {
        command: "vp pack --watch",
        dependsOn: ["grammars"],
      },
      clean: {
        command: [clean("dist"), clean("generated"), clean("*.vsix")],
        cache: false,
      },
      release: {
        command: [
          "node grammar/build-grammars.mts",
          "vp pack -l silent --minify",
          "node scripts/copy-licenses.mts",
          "vsce package --out dist/csslit-vscode.vsix",
        ],
        dependsOn: ["clean"],
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
