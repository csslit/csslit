import { expect, test } from "vite-plus/test";
import type { Plugin } from "vite-plus";

import { buildProductionSnapshot } from "../harness/csslit-harness.ts";

test("production build emits csslit css", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`
          color: hotpink;
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js assets/entry-tM_3AfFd.js
    ({csslit_2_25:\`_csslit_2_25_b1keg_1\`}).csslit_2_25;

    # css assets/entry-CJ5jQY1k.css
    ._csslit_2_25_b1keg_1{color:#ff69b4}
    "
  `);
});

test("production build eval uses source transformed before csslit", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        const tone = "__TOKEN__";
        export const className = css\`color: \${tone};\`;
      `,
    },
    plugins: [
      {
        name: "csslit-test-rewrite-before-csslit",
        enforce: "pre",
        transform(code, id) {
          if (id.endsWith("/src/entry.ts")) {
            return code.replaceAll("__TOKEN__", "hotpink");
          }

          return null;
        },
      } satisfies Plugin,
    ],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js assets/entry-DrFFYQB5.js
    ({csslit_3_25:\`_csslit_3_25_q4wvi_1\`}).csslit_3_25;

    # css assets/entry-BkBLMIme.css
    ._csslit_3_25_q4wvi_1{color:#ff69b4}
    "
  `);
});

test("production build eval imports use comptime transforms", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";
        import { tone } from "./theme";

        export const className = css\`color: \${tone};\`;
      `,
      "/src/theme.ts": `
        export const tone = "__TOKEN__";
      `,
    },
    plugins: [
      {
        name: "csslit-test-comptime-transform",
        transform(code, id) {
          if (this.environment.name === "comptime" && id.endsWith("/src/theme.ts")) {
            return code.replaceAll("__TOKEN__", "hotpink");
          }

          return null;
        },
      } satisfies Plugin,
    ],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js assets/entry-DrFFYQB5.js
    ({csslit_3_25:\`_csslit_3_25_q4wvi_1\`}).csslit_3_25;

    # css assets/entry-BkBLMIme.css
    ._csslit_3_25_q4wvi_1{color:#ff69b4}
    "
  `);
});
