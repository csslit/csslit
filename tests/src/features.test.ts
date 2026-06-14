import { expect, test } from "vite-plus/test";

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
    	return __css_module_import.csslit_0;
    };
    export const className = makeStyles();


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_bje7q_1 {
    color: hotpink;
    }



    # exports
    csslit_0 = _csslit_0_bje7q_1
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
    export const className = __css_module_import.csslit_0;


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_bje7q_1 {
    color: hotpink;
    }



    # exports
    csslit_0 = _csslit_0_bje7q_1
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
    export const className = __css_module_import.csslit_0;


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_bje7q_1 {
    color: hotpink;
    }



    # exports
    csslit_0 = _csslit_0_bje7q_1
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
    export const className = __css_module_import.csslit_0;


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_14mec_1 {
    transition: opacity 0.2s, transform 0.2s;
    }



    # exports
    csslit_0 = _csslit_0_14mec_1
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
    export const className = __css_module_import.csslit_0;


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_bje7q_1 {
    color: hotpink;
    }



    # exports
    csslit_0 = _csslit_0_bje7q_1
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
    export const className = __css_module_import.csslit_0;


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_rxsyk_1 {
      background: hotpink;
    }



    # exports
    csslit_0 = _csslit_0_rxsyk_1
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
    export const className = __css_module_import.csslit_0;


    # css /src/entry.ts.csslit.module.css
    ._csslit_0_rxsyk_1 {
      background: hotpink;
    }



    # exports
    csslit_0 = _csslit_0_rxsyk_1
    "
  `);
});
