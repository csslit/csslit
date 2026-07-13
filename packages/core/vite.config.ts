import { defineConfig } from "vite-plus";

const clean = (pattern: string) =>
  `node -e 'for (const f of fs.globSync("./" + ${JSON.stringify(pattern)})) fs.rmSync(f, { recursive: true, force: true })'`;

export default defineConfig({
  pack: {
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
      },
      dev: {
        command: "vp pack --watch",
      },
      clean: {
        command: clean("dist"),
        cache: false,
      },
      release: {
        command: "vp pack -l silent",
        dependsOn: ["clean"],
        cache: false,
      },
    },
  },
});
