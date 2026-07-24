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
      index: "src/index.ts",
    },
    // tsserver loads project plugins through require(), so emit CommonJS (.cjs, since the package
    // itself is ESM-authored with "type": "module").
    format: "cjs",
    fixedExtension: true,
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
      test: {
        command: "vp test --reporter agent",
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      check: {
        command: "vp test --reporter agent",
        input: [{ auto: true }, "!node_modules/.vite/**"],
      },
      dev: {
        command: "vp pack --watch",
      },
      clean: {
        command: clean("dist"),
        cache: false,
      },
      release: {
        command: "vp pack -l silent --minify --no-sourcemap",
        dependsOn: ["clean"],
        cache: false,
      },
    },
  },
});
