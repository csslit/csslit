import { defineConfig } from "vite-plus";

const release = process.env.CSSLIT_RELEASE === "1";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: `napi build --platform --esm${release ? " --release" : ""} -o dist -- -q`,
        env: ["CSSLIT_RELEASE"],
        input: [{ auto: true }, "!dist/**"],
      },
      dev: {
        command: "napi watch --platform --esm -o dist",
      },
    },
  },
});
