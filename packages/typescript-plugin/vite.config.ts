import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
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
