import { expect, test } from "vite-plus/test";
import type { Plugin } from "vite-plus";

import { buildSnapshot } from "../harness/csslit-harness.ts";

test("css literal reads from enclosing function scope", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        const makeStyles = () => {
          const base = "hotpink";
          return css\`color: \${base};\`;
        };

        export const className = makeStyles();
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    const makeStyles = () => {
    	const base = "hotpink";
    	return __css_module_import.css_5_10;
    };
    export const className = makeStyles();

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_5_10": "qkiPAk_5_10" };

    # css /src/entry.ts.csslit.css
    .qkiPAk_5_10 {
      color: #ff69b4;
    }
    "
  `);
});

test("imported function can be called directly in interpolation", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";
        import { pickColor } from "./theme";

        export const className = css\`color: \${pickColor()};\`;
      `,
      "/src/theme.ts": `
        export function pickColor() {
          return "hotpink";
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_4_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_4_26": "nTevJI_4_26" };

    # js /src/theme.ts
    export function pickColor() {
    	return "hotpink";
    }

    # css /src/entry.ts.csslit.css
    .nTevJI_4_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("comptime allows function call in binding position", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "csslit";
        import { pickColor } from "./theme";

        const tone = comptime(pickColor());

        export const className = css\`color: \${tone};\`;
      `,
      "/src/theme.ts": `
        export function pickColor() {
          return "hotpink";
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    import { comptime } from "/@fs/<root>/packages/csslit/dist/index.js";
    import { pickColor } from "/@id/<root>/src/theme.ts";
    const tone = comptime(pickColor());
    export const className = __css_module_import.css_6_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_6_26": "YONEpD_6_26" };

    # js /src/theme.ts
    export function pickColor() {
    	return "hotpink";
    }

    # css /src/entry.ts.csslit.css
    .YONEpD_6_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("array literal can be used in direct interpolation", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`transition: \${["opacity 0.2s", "transform 0.2s"].join(", ")};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_3_26": "Myz4Qi_3_26" };

    # css /src/entry.ts.csslit.css
    .Myz4Qi_3_26 {
      transition: opacity .2s, transform .2s;
    }
    "
  `);
});

test("object literal can be used in direct interpolation", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`color: \${{ primary: "hotpink", secondary: "blue" }.primary};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_3_26": "Myz4Qi_3_26" };

    # css /src/entry.ts.csslit.css
    .Myz4Qi_3_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("css literal compiles to static css", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`
          background: hotpink;
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_3_26": "Myz4Qi_3_26" };

    # css /src/entry.ts.csslit.css
    .Myz4Qi_3_26 {
      background: #ff69b4;
    }
    "
  `);
});

test("css literal resolves inline module dependencies", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";
        import theme from "./theme";

        export const className = css\`
          background: \${theme.colors.primary};
        \`;
      `,
      "/src/theme.ts": `
        export default {
          colors: {
            primary: "hotpink",
          },
        };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_4_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_4_26": "nTevJI_4_26" };

    # js /src/theme.ts
    export default { colors: { primary: "hotpink" } };

    # css /src/entry.ts.csslit.css
    .nTevJI_4_26 {
      background: #ff69b4;
    }
    "
  `);
});

test("css class binding can be interpolated into another selector", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        const appStyle = css\`
          display: block;
        \`;

        export const h1Style = css\`
          .\${appStyle} & {
            color: hotpink;
          }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    const appStyle = __css_module_import.css_3_18;
    export const h1Style = __css_module_import.css_7_24;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default {
    	"css_3_18": "vtZXOf_3_18",
    	"css_7_24": "AqYT1Z_7_24"
    };

    # css /src/entry.ts.csslit.css
    .vtZXOf_3_18 {
      display: block;
    }

    .AqYT1Z_7_24 {
      .vtZXOf_3_18 & {
        color: #ff69b4;
      }
    }
    "
  `);
});

test("css class binding is rewritten inside selector functions", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        const appStyle = css\`
          display: block;
        \`;

        export const child = css\`
          :is(.\${appStyle}, :where(.\${appStyle})) &,
          :not(.\${appStyle}) &,
          :has(.\${appStyle}) &,
          :global(.\${appStyle}) &,
          :nth-child(2 of .\${appStyle}) & {
            color: hotpink;
          }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    const appStyle = __css_module_import.css_3_18;
    export const child = __css_module_import.css_7_22;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default {
    	"css_3_18": "vtZXOf_3_18",
    	"css_7_22": "BDdUFU_7_22"
    };

    # css /src/entry.ts.csslit.css
    .vtZXOf_3_18 {
      display: block;
    }

    .BDdUFU_7_22 {
      :is(.vtZXOf_3_18, :where(.vtZXOf_3_18)) &, :not(.vtZXOf_3_18) &, :has(.vtZXOf_3_18) &, .vtZXOf_3_18 &, :nth-child(2 of .vtZXOf_3_18) & {
        color: #ff69b4;
      }
    }
    "
  `);
});

test("imported css class binding can be interpolated into another selector", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";
        import { base } from "./base";

        export const child = css\`
          .\${base} & { color: hotpink; }
        \`;
      `,
      "/src/base.ts": `
        import { css } from "csslit";

        export const base = css\`display: block;\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/base.ts
    import __css_module_import from "/@id/<root>/src/base.ts.csslit.module.js";
    export const base = __css_module_import.css_3_21;

    # js /src/base.ts.csslit.module.js
    import "/@id/<root>/src/base.ts.csslit.css";
    export default { "css_3_21": "PLFTZk_3_21" };

    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const child = __css_module_import.css_4_22;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_4_22": "l5mYrv_4_22" };

    # css /src/base.ts.csslit.css
    .PLFTZk_3_21 {
      display: block;
    }

    # css /src/entry.ts.csslit.css
    .l5mYrv_4_22 {
      .PLFTZk_3_21 & {
        color: #ff69b4;
      }
    }
    "
  `);
});

test("css expressions in conditional bindings emit matching css module keys", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        const enabled = true;
        export const style = enabled ? css\`
          color: red;
        \` : css\`
          color: blue;
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    const enabled = true;
    export const style = enabled ? __css_module_import.css_4_32 : __css_module_import.css_6_5;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default {
    	"css_4_32": "MpXhWZ_4_32",
    	"css_6_5": "AFhLf9_6_5"
    };

    # css /src/entry.ts.csslit.css
    .MpXhWZ_4_32 {
      color: red;
    }

    .AFhLf9_6_5 {
      color: #00f;
    }
    "
  `);
});

test("css eval uses source transformed before csslit", async () => {
  const result = await buildSnapshot({
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
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    const tone = "hotpink";
    export const className = __css_module_import.css_4_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_4_26": "nTevJI_4_26" };

    # css /src/entry.ts.csslit.css
    .nTevJI_4_26 {
      color: #ff69b4;
    }
    "
  `);
});

test("css and global css preserve source order in one stylesheet", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const first = css\`color: red;\`;

        css.global\`
          body { color: blue; }
        \`;

        export const second = css\`color: green;\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const first = __css_module_import.css_3_22;
    undefined;
    export const second = __css_module_import.css_9_23;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default {
    	"css_3_22": "hsDpVD_3_22",
    	"css_9_23": "npQTPc_9_23"
    };

    # css /src/entry.ts.csslit.css
    .hsDpVD_3_22 {
      color: red;
    }

    body {
      color: #00f;
    }

    .npQTPc_9_23 {
      color: green;
    }
    "
  `);
});

test("global keyframes remain global and ordered with scoped css", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        css.global\`
          @keyframes pulse { to { opacity: 1; } }
        \`;

        export const className = css\`
          animation: pulse 1s;
          @keyframes pulse { to { opacity: 0; } }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    undefined;
    export const className = __css_module_import.css_7_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_7_26": "fledcS_7_26" };

    # css /src/entry.ts.csslit.css
    @keyframes pulse {
      to {
        opacity: 1;
      }
    }

    .fledcS_7_26 {
      animation: 1s CU6lSG_pulse;
    }

    @keyframes CU6lSG_pulse {
      to {
        opacity: 0;
      }
    }
    "
  `);
});

test("css literal hoists and scopes keyframes", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`
          animation: pulse 1s;
          @keyframes pulse { to { opacity: 1; } }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_3_26": "Myz4Qi_3_26" };

    # css /src/entry.ts.csslit.css
    .Myz4Qi_3_26 {
      animation: 1s Qt1gFG_pulse;
    }

    @keyframes Qt1gFG_pulse {
      to {
        opacity: 1;
      }
    }
    "
  `);
});

test("conditional keyframes preserve their media condition", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`
          @media print {
            animation: pulse 1s;
            @keyframes pulse { to { opacity: 1; } }
          }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_3_26": "Myz4Qi_3_26" };

    # css /src/entry.ts.csslit.css
    @media print {
      .Myz4Qi_3_26 {
        animation: 1s Qt1gFG_pulse;
      }

      @keyframes Qt1gFG_pulse {
        to {
          opacity: 1;
        }
      }
    }
    "
  `);
});

test("duplicate keyframes in separate css blocks are independently scoped", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const first = css\`
          animation: pulse 1s;
          @keyframes pulse { to { opacity: 0; } }
        \`;

        export const second = css\`
          animation: pulse 2s;
          @keyframes pulse { to { opacity: 1; } }
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const first = __css_module_import.css_3_22;
    export const second = __css_module_import.css_8_23;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default {
    	"css_3_22": "hsDpVD_3_22",
    	"css_8_23": "wNC5gC_8_23"
    };

    # css /src/entry.ts.csslit.css
    .hsDpVD_3_22 {
      animation: 1s Qt1gFG_pulse;
    }

    @keyframes Qt1gFG_pulse {
      to {
        opacity: 0;
      }
    }

    .wNC5gC_8_23 {
      animation: 2s CU6lSG_pulse;
    }

    @keyframes CU6lSG_pulse {
      to {
        opacity: 1;
      }
    }
    "
  `);
});

test("css literals preserve custom property references", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        export const className = css\`
          --text-color: hotpink;
          color: var(--text-color);
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_3_26": "Myz4Qi_3_26" };

    # css /src/entry.ts.csslit.css
    .Myz4Qi_3_26 {
      --text-color: hotpink;
      color: var(--text-color);
    }
    "
  `);
});
