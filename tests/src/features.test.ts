import { expect, test } from "vite-plus/test";
import type { Plugin } from "vite";

import { buildSnapshot } from "../harness/csslit-harness.ts";

test("comptime supports destructuring with computed keys and defaults", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { theme } from "./theme";

        const key = "tone";
        const fallback = "hotpink";
        const { [key]: tone = fallback, nested: { border }, ...rest } = theme;

        export const className = css\`
          color: \${tone};
          border-width: \${border};
          opacity: \${rest.opacity};
        \`;
      `,
      "/src/theme.ts": `
        export const theme = {
          tone: undefined,
          nested: { border: "2px" },
          opacity: 0.5,
        };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import { theme } from "/src/theme.ts";
    const key = "tone";
    const fallback = "hotpink";
    const {
      [key]: tone = fallback,
      nested: { border },
      ...rest
    } = theme;
    export const className = __css_module_import.css_8_26;

    # js /src/entry.ts.csslit.json
    export const css_8_26 = "bFY7LX";
    export default {
      css_8_26,
    };

    # js /src/theme.ts
    export const theme = {
      tone: undefined,
      nested: { border: "2px" },
      opacity: 0.5,
    };

    # css /src/entry.ts.csslit.css
    .bFY7LX {
      color: #ff69b4;
      border-width: 2px;
      opacity: .5;
    }
    "
  `);
});

test("destructuring closures observe incrementally initialized bindings", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "@csslit/core";

        const { a, b, c } = comptime({
          a: 1,
          b: () => a,
          get c() {
            return a;
          },
        });

        export const className = css\`
          width: \${b()}px;
          height: \${c}px;
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { comptime, css } from "/@fs/<root>/packages/core/dist/index.js";
    const { a, b, c } = comptime({
      a: 1,
      b: () => a,
      get c() {
        return a;
      },
    });
    export const className = __css_module_import.css_11_26;

    # js /src/entry.ts.csslit.json
    export const css_11_26 = "pj9Hxg";
    export default {
      css_11_26,
    };

    # css /src/entry.ts.csslit.css
    .pj9Hxg {
      width: 1px;
      height: 1px;
    }
    "
  `);
});

test("css literal reads from enclosing function scope", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const makeStyles = () => {
      const base = "hotpink";
      return __css_module_import.css_5_10;
    };
    export const className = makeStyles();

    # js /src/entry.ts.csslit.json
    export const css_5_10 = "SFU29d";
    export default {
      css_5_10,
    };

    # css /src/entry.ts.csslit.css
    .SFU29d {
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
        import { css } from "@csslit/core";
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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import { pickColor } from "/src/theme.ts";
    export const className = __css_module_import.css_4_26;

    # js /src/entry.ts.csslit.json
    export const css_4_26 = "ADzKXK";
    export default {
      css_4_26,
    };

    # js /src/theme.ts
    export function pickColor() {
      return "hotpink";
    }

    # css /src/entry.ts.csslit.css
    .ADzKXK {
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
        import { comptime, css } from "@csslit/core";
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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { comptime, css } from "/@fs/<root>/packages/core/dist/index.js";
    import { pickColor } from "/src/theme.ts";
    const tone = comptime(pickColor());
    export const className = __css_module_import.css_6_26;

    # js /src/entry.ts.csslit.json
    export const css_6_26 = "eYxGv5";
    export default {
      css_6_26,
    };

    # js /src/theme.ts
    export function pickColor() {
      return "hotpink";
    }

    # css /src/entry.ts.csslit.css
    .eYxGv5 {
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
        import { css } from "@csslit/core";

        export const className = css\`transition: \${["opacity 0.2s", "transform 0.2s"].join(", ")};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
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
        import { css } from "@csslit/core";

        export const className = css\`color: \${{ primary: "hotpink", secondary: "blue" }.primary};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
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
        import { css } from "@csslit/core";

        export const className = css\`
          background: hotpink;
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
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
        import { css } from "@csslit/core";
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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import theme from "/src/theme.ts";
    export const className = __css_module_import.css_4_26;

    # js /src/entry.ts.csslit.json
    export const css_4_26 = "ADzKXK";
    export default {
      css_4_26,
    };

    # js /src/theme.ts
    export default { colors: { primary: "hotpink" } };

    # css /src/entry.ts.csslit.css
    .ADzKXK {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const appStyle = __css_module_import.css_3_18;
    export const h1Style = __css_module_import.css_7_24;

    # js /src/entry.ts.csslit.json
    export const css_3_18 = "DmQfhQ";
    export const css_7_24 = "GVCOwS";
    export default {
      css_3_18,
      css_7_24,
    };

    # css /src/entry.ts.csslit.css
    .DmQfhQ {
      display: block;
    }

    .GVCOwS {
      .DmQfhQ & {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const appStyle = __css_module_import.css_3_18;
    export const child = __css_module_import.css_7_22;

    # js /src/entry.ts.csslit.json
    export const css_3_18 = "DmQfhQ";
    export const css_7_22 = "dDSrni";
    export default {
      css_3_18,
      css_7_22,
    };

    # css /src/entry.ts.csslit.css
    .DmQfhQ {
      display: block;
    }

    .dDSrni {
      :is(.DmQfhQ, :where(.DmQfhQ)) &, :not(.DmQfhQ) &, :has(.DmQfhQ) &, .DmQfhQ &, :nth-child(2 of .DmQfhQ) & {
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
        import { css } from "@csslit/core";
        import { base } from "./base";

        export const child = css\`
          .\${base} & { color: hotpink; }
        \`;
      `,
      "/src/base.ts": `
        import { css } from "@csslit/core";

        export const base = css\`display: block;\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/base.ts
    import "/src/base.ts.csslit.css";
    import __css_module_import from "/src/base.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const base = __css_module_import.css_3_21;

    # js /src/base.ts.csslit.json
    export const css_3_21 = "eKmIvo";
    export default {
      css_3_21,
    };

    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import { base } from "/src/base.ts";
    export const child = __css_module_import.css_4_22;

    # js /src/entry.ts.csslit.json
    export const css_4_22 = "lPhY7R";
    export default {
      css_4_22,
    };

    # css /src/base.ts.csslit.css
    .eKmIvo {
      display: block;
    }

    # css /src/entry.ts.csslit.css
    .lPhY7R {
      .eKmIvo & {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const enabled = true;
    export const style = enabled ? __css_module_import.css_4_32 : __css_module_import.css_6_5;

    # js /src/entry.ts.csslit.json
    export const css_4_32 = "G4gki8";
    export const css_6_5 = "pA8vo2";
    export default {
      css_4_32,
      css_6_5,
    };

    # css /src/entry.ts.csslit.css
    .G4gki8 {
      color: red;
    }

    .pA8vo2 {
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
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const tone = "hotpink";
    export const className = __css_module_import.css_4_26;

    # js /src/entry.ts.csslit.json
    export const css_4_26 = "ADzKXK";
    export default {
      css_4_26,
    };

    # css /src/entry.ts.csslit.css
    .ADzKXK {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const first = __css_module_import.css_3_22;
    undefined;
    export const second = __css_module_import.css_9_23;

    # js /src/entry.ts.csslit.json
    export const css_3_22 = "UGTb1u";
    export const css_9_23 = "b47yAD";
    export default {
      css_3_22,
      css_9_23,
    };

    # css /src/entry.ts.csslit.css
    .UGTb1u {
      color: red;
    }

    body {
      color: #00f;
    }

    .b47yAD {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    undefined;
    export const className = __css_module_import.css_7_26;

    # js /src/entry.ts.csslit.json
    export const css_7_26 = "R4nq2r";
    export default {
      css_7_26,
    };

    # css /src/entry.ts.csslit.css
    @keyframes pulse {
      to {
        opacity: 1;
      }
    }

    .R4nq2r {
      animation: 1s ZSGyZG_pulse;
    }

    @keyframes ZSGyZG_pulse {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
      animation: 1s _PNaQW_pulse;
    }

    @keyframes _PNaQW_pulse {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    @media print {
      .L8OLuN {
        animation: 1s _PNaQW_pulse;
      }

      @keyframes _PNaQW_pulse {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const first = __css_module_import.css_3_22;
    export const second = __css_module_import.css_8_23;

    # js /src/entry.ts.csslit.json
    export const css_3_22 = "UGTb1u";
    export const css_8_23 = "kCoxkq";
    export default {
      css_3_22,
      css_8_23,
    };

    # css /src/entry.ts.csslit.css
    .UGTb1u {
      animation: 1s _PNaQW_pulse;
    }

    @keyframes _PNaQW_pulse {
      to {
        opacity: 0;
      }
    }

    .kCoxkq {
      animation: 2s ZSGyZG_pulse;
    }

    @keyframes ZSGyZG_pulse {
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
        import { css } from "@csslit/core";

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
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
      --text-color: hotpink;
      color: var(--text-color);
    }
    "
  `);
});

test("new, tagged template, and sequence expressions evaluate in interpolations", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        export const className = css\`
          color: \${new String("hotpink")};
          --tag: \${String.raw\`raw-\${1 + 1}\`};
          --seq: \${(0, "seq")};
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
      color: #ff69b4;
      --tag: raw-2;
      --seq: seq;
    }
    "
  `);
});

test("css template nested directly in an interpolation becomes its class name", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        export const className = css\`.\${css\`color: red;\`} & { color: blue; }\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .FNhxLX {
      color: red;
    }

    .L8OLuN {
      .FNhxLX & {
        color: #00f;
      }
    }
    "
  `);
});

test("css nested in a closure is evaluated independently", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        export const className = css\`.\${(() => {
          const color = "red";
          return css\`color: \${color};\`;
        })()} & { color: blue; }\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_3_26;

    # js /src/entry.ts.csslit.json
    export const css_3_26 = "L8OLuN";
    export default {
      css_3_26,
    };

    # css /src/entry.ts.csslit.css
    .L8OLuN {
      .SFU29d & {
        color: #00f;
      }
    }

    .SFU29d {
      color: red;
    }
    "
  `);
});

test("ambient functions are treated as globals", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        declare function parseInt(value: string): number;

        export const className = css\`z-index: \${parseInt("1")};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    export const className = __css_module_import.css_5_26;

    # js /src/entry.ts.csslit.json
    export const css_5_26 = "FdnjzE";
    export default {
      css_5_26,
    };

    # css /src/entry.ts.csslit.css
    .FdnjzE {
      z-index: 1;
    }
    "
  `);
});

test("closures in interpolations evaluate with outer constants and local state", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { sizes } from "./theme";

        const scale = (value: number) => value * 4;

        export const className = css\`
          padding: \${sizes.map((size) => \`\${scale(size)}px\`).join(" ")};
          width: \${(() => {
            let total = 0;
            for (const size of sizes) {
              total += size;
            }
            total++;
            return (() => total)() - 1;
          })()}px;
          gap: \${[...(function* () { yield 4; yield 8; })()].join("px ")}px;
          content: "\${(async () => await 4)().constructor.name}";
          margin: \${offset(3)}px;
          display: \${false ? (() => css\`color: red;\`)() : "block"};
        \`;

        function offset(value: number) {
          return value + 1;
        }
      `,
      "/src/theme.ts": `
        export const sizes = [1, 2, 3];
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import "/src/entry.ts.csslit.css";
    import __css_module_import from "/src/entry.ts.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import { sizes } from "/src/theme.ts";
    const scale = (value) => value * 4;
    export const className = __css_module_import.css_6_26;
    function offset(value) {
      return value + 1;
    }

    # js /src/entry.ts.csslit.json
    export const css_6_26 = "eYxGv5";
    export default {
      css_6_26,
    };

    # js /src/theme.ts
    export const sizes = [1, 2, 3];

    # css /src/entry.ts.csslit.css
    .eYxGv5 {
      padding: 4px 8px 12px;
      width: 6px;
      gap: 4px 8px;
      content: "Promise";
      margin: 4px;
      display: block;
    }

    .xaWsgk {
      color: red;
    }
    "
  `);
});
