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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    const makeStyles = () => {
    	const base = "hotpink";
    	return __css_module_import.csslit_4_9;
    };
    export const className = makeStyles();

    # css /src/entry.ts.csslit.module.css
    ._csslit_4_9_rdfau_1 {
    color: hotpink;
    }

    # exports
    csslit_4_9 = _csslit_4_9_rdfau_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    export const className = __css_module_import.csslit_3_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_3_25_q4wvi_1 {
    color: hotpink;
    }

    # exports
    csslit_3_25 = _csslit_3_25_q4wvi_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    import { comptime } from "/@fs/<root>/packages/csslit/dist/index.js";
    import { pickColor } from "/@id/<root>/src/theme.ts";
    const tone = comptime(pickColor());
    export const className = __css_module_import.csslit_5_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_5_25_1da6f_1 {
    color: hotpink;
    }

    # exports
    csslit_5_25 = _csslit_5_25_1da6f_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    export const className = __css_module_import.csslit_2_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_2_25_494w6_1 {
    transition: opacity 0.2s, transform 0.2s;
    }

    # exports
    csslit_2_25 = _csslit_2_25_494w6_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    export const className = __css_module_import.csslit_2_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_2_25_8mjtm_1 {
    color: hotpink;
    }

    # exports
    csslit_2_25 = _csslit_2_25_8mjtm_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    export const className = __css_module_import.csslit_2_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_2_25_1tx2w_1 {
      background: hotpink;
    }

    # exports
    csslit_2_25 = _csslit_2_25_1tx2w_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    export const className = __css_module_import.csslit_3_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_3_25_139xc_1 {
      background: hotpink;
    }

    # exports
    csslit_3_25 = _csslit_3_25_139xc_1
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    const appStyle = __css_module_import.csslit_2_17;
    export const h1Style = __css_module_import.csslit_6_23;

    # css /src/entry.ts.csslit.module.css
    ._csslit_2_17_h520v_1 {
      display: block;
    }

    ._csslit_6_23_h520v_5 {
      ._csslit_2_17_h520v_1 & {
        color: hotpink;
      }
    }

    # exports
    csslit_2_17 = _csslit_2_17_h520v_1
    csslit_6_23 = _csslit_6_23_h520v_5
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    const enabled = true;
    export const style = enabled ? __css_module_import.csslit_3_31 : __css_module_import.csslit_5_4;

    # css /src/entry.ts.csslit.module.css
    ._csslit_3_31_1rey4_1 {
      color: red;
    }

    ._csslit_5_4_1rey4_5 {
      color: blue;
    }

    # exports
    csslit_3_31 = _csslit_3_31_1rey4_1
    csslit_5_4 = _csslit_5_4_1rey4_5
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
    # js
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.css";
    const tone = "hotpink";
    export const className = __css_module_import.csslit_3_25;

    # css /src/entry.ts.csslit.module.css
    ._csslit_3_25_q4wvi_1 {
    color: hotpink;
    }

    # exports
    csslit_3_25 = _csslit_3_25_q4wvi_1
    "
  `);
});
