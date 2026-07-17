import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  pack: {
    entry: {
      extension: "src/extension.ts",
    },
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
      build: {
        command: "vp pack -l silent",
        output: ["dist/**"],
      },
      dev: {
        command: "vp pack --watch",
      },
      clean: {
        command: [clean("dist"), clean("*.vsix")],
        cache: false,
      },
      package: {
        command: "vp pack -l silent --minify",
        cache: false,
      },
      release: {
        command: "vsce package --no-dependencies --out dist/csslit-vscode.vsix",
        dependsOn: ["clean"],
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
