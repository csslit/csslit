import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  pack: {
    entry: {
      "eval-runtime": "src/eval-runtime.ts",
      index: "src/index.ts",
    },
    dts: {
      tsgo: true,
    },
    format: "esm",
    fixedExtension: false,
    sourcemap: true,
    exports: false,
  },
  run: {
    tasks: {
      build: {
        command: "vp pack -l silent",
        dependsOn: ["@csslit/transform#build"],
        output: ["dist/**"],
      },
      dev: {
        command: "vp pack --watch",
        dependsOn: ["@csslit/transform#dev"],
      },
      clean: {
        command: clean("dist"),
        cache: false,
      },
      release: {
        command: "vp pack -l silent",
        dependsOn: ["clean", "@csslit/transform#release"],
        cache: false,
      },
    },
  },
});
