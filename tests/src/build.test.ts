import { expect, test } from "vite-plus/test";
import type { Plugin } from "vite";

import { buildProductionSnapshot } from "../harness/csslit-harness.ts";

test("production build emits csslit css", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        export const className = css\`
          color: hotpink;
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js
    var className = { "css_3_26": "sWdGZm_3_26" }.css_3_26;
    export { className };

    # css
    .sWdGZm_3_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("production build eval uses source transformed before csslit", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

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
    # js
    var className = { "css_4_26": "Emgz6f_4_26" }.css_4_26;
    export { className };

    # css
    .Emgz6f_4_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("production build eval imports use comptime transforms", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
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
    # js
    var className = { "css_4_26": "Emgz6f_4_26" }.css_4_26;
    export { className };

    # css
    .Emgz6f_4_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("production build preserves global and scoped css source order", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const tone = "hotpink";

        export const first = css\`
          color: \${tone};
        \`;

        css.global\`
          html { background: \${tone}; }
        \`;

        export const second = css\`
          border-color: \${tone};
        \`;

        css.global\`
          body { color: \${tone}; }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js
    var entry_ts_csslit_module_default = {
    	"css_5_22": "bfSIGN_5_22",
    	"css_13_23": "CBIdfI_13_23"
    };
    var first = entry_ts_csslit_module_default.css_5_22;
    var second = entry_ts_csslit_module_default.css_13_23;
    export { first, second };

    # css
    .bfSIGN_5_22 {
      color: #ff69b4;
    }

    html {
      background: #ff69b4;
    }

    .CBIdfI_13_23 {
      border-color: #ff69b4;
    }

    body {
      color: #ff69b4;
    }
    "
  `);
});

test("production build hoists csslit keyframes", async () => {
  const result = await buildProductionSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        export const className = css\`
          animation: pulse 1s infinite;

          @keyframes pulse {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js
    var className = { "css_3_26": "sWdGZm_3_26" }.css_3_26;
    export { className };

    # css
    .sWdGZm_3_26 {
      animation: 1s infinite _PNaQW_pulse;
    }

    @keyframes _PNaQW_pulse {
      from {
        opacity: 0;
      }

      to {
        opacity: 1;
      }
    }
    "
  `);
});
