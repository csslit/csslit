import { expect, test } from "vite-plus/test";
import type { Plugin } from "vite";

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
    # js assets/entry-BhaSCCYR.js
    ({ "css_3_26": "Myz4Qi_3_26" }).css_3_26;
    //#endregion

    # css assets/entry-QuEypHYX.css
    .Myz4Qi_3_26 {
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
    # js assets/entry-KzH5W5Gq.js
    ({ "css_4_26": "nTevJI_4_26" }).css_4_26;
    //#endregion

    # css assets/entry-B2LtiVZK.css
    .nTevJI_4_26 {
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
    # js assets/entry-KzH5W5Gq.js
    ({ "css_4_26": "nTevJI_4_26" }).css_4_26;
    //#endregion

    # css assets/entry-B2LtiVZK.css
    .nTevJI_4_26 {
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
        import { css } from "csslit";

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
    # js assets/entry-ooHe3jza.js
    //#region ../../../../..<root>/src/entry.ts.csslit.module.js
    var entry_ts_csslit_module_default = {
    	"css_5_22": "RbVSf2_5_22",
    	"css_13_23": "FQBCkZ_13_23"
    };
    entry_ts_csslit_module_default.css_5_22;
    entry_ts_csslit_module_default.css_13_23;
    //#endregion

    # css assets/entry-By_gOgLe.css
    .RbVSf2_5_22 {
      color: #ff69b4;
    }

    html {
      background: #ff69b4;
    }

    .FQBCkZ_13_23 {
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
        import { css } from "csslit";

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
    # js assets/entry-xhBY8LoT.js
    ({ "css_3_26": "Myz4Qi_3_26" }).css_3_26;
    //#endregion

    # css assets/entry-CNwFaZQO.css
    .Myz4Qi_3_26 {
      animation: 1s infinite Qt1gFG_pulse;
    }

    @keyframes Qt1gFG_pulse {
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
