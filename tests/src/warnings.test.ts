import { expect, test } from "vite-plus/test";

import { buildSnapshot, buildWarningSnapshot } from "../harness/csslit-harness.ts";

test("runtime parameter warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        function demo(param: string) {
          css\`color: \${param};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references param, which is a runtime parameter.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:16
      Interpolation:
        at <root>/src/entry.ts:4:16
        3 | function demo(param: string) {
        4 |   css'color: #{param};';
          |                ^^^^^ references param
        5 | }
      
      Root cause:
        at <root>/src/entry.ts:3:15
        2 | 
        3 | function demo(param: string) {
          |               ^^^^^^^^^^^^^ param is a runtime parameter.
        4 |   css'color: #{param};';
    "
  `);
});

test("function declaration with unsupported body warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        function tone(value: { color: string }) {
          value.color = "red";
          return value.color;
        }

        css\`color: \${tone({ color: "blue" })};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an assignment expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:8:14
      Interpolation:
        at <root>/src/entry.ts:8:14
        7 | 
        8 | css'color: #{tone({ color: "blue" })};';
          |              ^^^^^^^^^^^^^^^^^^^^^^^ contains an assignment expression
    "
  `);
});

test("class binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        class Tone {}

        css\`color: \${Tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references Tone, which is a class binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{Tone};';
          |              ^^^^ references Tone
      
      Root cause:
        at <root>/src/entry.ts:3:7
        2 | 
        3 | class Tone {}
          |       ^^^^ Tone is a class binding.
        4 | 
    "
  `);
});

test("class binding warning through member access", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        class Tone {
          value = "hotpink";
        }

        css\`color: \${Tone.name};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references Tone, which is a class binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{Tone.name};';
          |              ^^^^ references Tone
      
      Root cause:
        at <root>/src/entry.ts:3:7
        2 | 
        3 | class Tone {
          |       ^^^^ Tone is a class binding.
        4 |   value = "hotpink";
    "
  `);
});

test("catch binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        try {
          throw new Error("boom");
        } catch (error) {
          css\`color: \${error};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references error, which is a catch binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:16
      Interpolation:
        at <root>/src/entry.ts:6:16
        5 | } catch (error) {
        6 |   css'color: #{error};';
          |                ^^^^^ references error
        7 | }
      
      Root cause:
        at <root>/src/entry.ts:5:10
        4 |   throw new Error("boom");
        5 | } catch (error) {
          |          ^^^^^ error is a catch binding.
        6 |   css'color: #{error};';
    "
  `);
});

test("reassigned local binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        let tone = "hotpink";
        tone = "blue";

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which is reassigned.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:4:1
        3 | let tone = "hotpink";
        4 | tone = "blue";
          | ^^^^ tone is reassigned.
        5 | 
    "
  `);
});

test("destructuring evaluation error warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "@csslit/core";
        import { fail, theme } from "./theme";

        const { tone = comptime(fail()) } = theme;

        css\`color: \${tone};\`;
      `,
      "/src/theme.ts": `
        export const theme = { tone: undefined };

        export function fail() {
          throw new Error("destructuring failed");
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which threw during evaluation: Error: destructuring failed.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:4:25
        3 | 
        4 | const { tone = comptime(fail()) } = theme;
          |                         ^ Error: destructuring failed
        5 | 
      
      Stack trace:
        Error: destructuring failed
            at fail (<root>/src/theme.ts:4:9)
            at tone (<root>/src/entry.ts:4:25)
    "
  `);
});

test("destructuring preserves values initialized before an error", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "@csslit/core";

        const { color, border } = comptime({
          color: "hotpink",
          get border() {
            throw new Error("border failed");
          },
        });

        export const className = css\`
          color: \${color};
          border-width: \${border};
        \`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    import { comptime } from "/@fs/<root>/packages/core/dist/index.js";
    const { color, border } = comptime({
    	color: "hotpink",
    	get border() {
    		throw new Error("border failed");
    	}
    });
    export const className = __css_module_import.css_10_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_10_26": "euh629_10_26" };

    # css /src/entry.ts.csslit.css
    .euh629_10_26 {
      color: #ff69b4;
      border-width: /* csslit error 1 */;
    }

    # warnings
    warning: CSS literal eval failed: interpolation references border, which threw during evaluation: Error: border failed.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:12:19
      Interpolation:
        at <root>/src/entry.ts:12:19
        11 |   color: #{color};
        12 |   border-width: #{border};
           |                   ^^^^^^ references border
        13 | ';
      
      Root cause:
        at <root>/src/entry.ts:6:11
        5 |   get border() {
        6 |     throw new Error("border failed");
          |           ^ Error: border failed
        7 |   },
      
      Stack trace:
        Error: border failed
            at Object.get border (<root>/src/entry.ts:6:11)
    "
  `);
});

test("var destructuring reports reads before initialization", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { empty } from "./theme";

        var { color = color } = empty;

        export const className = css\`color: \${color};\`;
      `,
      "/src/theme.ts": `
        export const empty = {};
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    import { empty } from "/@id/<root>/src/theme.ts";
    var { color = color } = empty;
    export const className = __css_module_import.css_6_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_6_26": "YONEpD_6_26" };

    # js /src/theme.ts
    export const empty = {};

    # css /src/entry.ts.csslit.css
    .YONEpD_6_26 {
      color: /* csslit error 1 */;
    }

    # warnings
    warning: CSS literal eval failed: interpolation references color, depending on color, which is used before its initializer runs.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:39
      Interpolation:
        at <root>/src/entry.ts:6:39
        5 | 
        6 | export const className = css'color: #{color};';
          |                                       ^^^^^ references color
      
      Dependency chain:
        color  at <root>/src/entry.ts:4:15
      
      Root cause:
        at <root>/src/entry.ts:4:5
        3 | 
        4 | var { color = color } = empty;
          |     ^^^^^^^^^^^^^^^^^^^^^^^^^ color is used before its initializer runs.
        5 | 
    "
  `);
});

test("duplicate var destructuring binding is a reassignment", async () => {
  const result = await buildSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        var { color, color } = { color: "hotpink" };

        export const className = css\`color: \${color};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/entry.ts
    import __css_module_import from "/@id/<root>/src/entry.ts.csslit.module.js";
    var { color, color } = { color: "hotpink" };
    export const className = __css_module_import.css_5_26;

    # js /src/entry.ts.csslit.module.js
    import "/@id/<root>/src/entry.ts.csslit.css";
    export default { "css_5_26": "XN9bNe_5_26" };

    # css /src/entry.ts.csslit.css
    .XN9bNe_5_26 {
      color: /* csslit error 1 */;
    }

    # warnings
    warning: CSS literal eval failed: interpolation references color, which is reassigned.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:39
      Interpolation:
        at <root>/src/entry.ts:5:39
        4 | 
        5 | export const className = css'color: #{color};';
          |                                       ^^^^^ references color
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | var { color, color } = { color: "hotpink" };
          |              ^^^^^ color is reassigned.
        4 | 
    "
  `);
});

test("loop binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        for (const tone of ["hotpink"]) {
          css\`color: \${tone};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which comes from a loop binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:16
      Interpolation:
        at <root>/src/entry.ts:4:16
        3 | for (const tone of ["hotpink"]) {
        4 |   css'color: #{tone};';
          |                ^^^^ references tone
        5 | }
      
      Root cause:
        at <root>/src/entry.ts:3:12
        2 | 
        3 | for (const tone of ["hotpink"]) {
          |            ^^^^ tone comes from a loop binding.
        4 |   css'color: #{tone};';
    "
  `);
});

test("no initializer warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        let tone: string;

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which has no initializer.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:3:5
        2 | 
        3 | let tone: string;
          |     ^^^^^^^^^^^^ tone has no initializer.
        4 | 
    "
  `);
});

test("enum declaration warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        enum Tone {
          Hotpink = "hotpink",
        }

        css\`color: \${Tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references Tone, which is an enum declaration.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{Tone};';
          |              ^^^^ references Tone
      
      Root cause:
        at <root>/src/entry.ts:3:6
        2 | 
        3 | enum Tone {
          |      ^^^^ Tone is an enum declaration.
        4 |   Hotpink = "hotpink",
    "
  `);
});

test("namespace declaration warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
          import { css } from "@csslit/core";

          namespace Tone {
            export const value = "hotpink";
          }

          css\`color: \${Tone};\`;
        `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references Tone, which is a namespace/module declaration.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{Tone};';
          |              ^^^^ references Tone
      
      Root cause:
        at <root>/src/entry.ts:3:11
        2 | 
        3 | namespace Tone {
          |           ^^^^ Tone is a namespace/module declaration.
        4 |   export const value = "hotpink";
    "
  `);
});

test("circular dependency warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        function demo() {
          const tone = border;
          const border = tone;

          css\`color: \${tone};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which threw during evaluation: ReferenceError: Cannot access 'border' before initialization.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:16
      Interpolation:
        at <root>/src/entry.ts:7:16
        6 | 
        7 |   css'color: #{tone};';
          |                ^^^^ references tone
        8 | }
      
      Root cause:
        at <root>/src/entry.ts:4:16
        3 | function demo() {
        4 |   const tone = border;
          |                ^ ReferenceError: Cannot access 'border' before initialization
        5 |   const border = tone;
      
      Stack trace:
        ReferenceError: Cannot access 'border' before initialization
            at border (<root>/src/entry.ts:4:16)
    "
  `);
});

test("var initializer order warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        css\`color: \${tone};\`;

        var tone = "hotpink";
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which is used before its initializer runs.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{tone};';
          |              ^^^^ references tone
        4 | 
      
      Root cause:
        at <root>/src/entry.ts:5:5
        4 | 
        5 | var tone = "hotpink";
          |     ^^^^^^^^^^^^^^^^ tone is used before its initializer runs.
    "
  `);
});

test("dependent call warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const tone = pickColor();

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which depends on a call expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | const tone = pickColor();
          |              ^^^^^^^^^^^ tone depends on a call expression.
        4 | 
    "
  `);
});

test("locally defined function call binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        function pickColor() { return "red"; }

        const tone = pickColor();

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which depends on a call expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | const tone = pickColor();
          |              ^^^^^^^^^^^ tone depends on a call expression.
        6 | 
    "
  `);
});

test("dependent dependency chain warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const tone = pickColor();
        const color = tone;

        css\`color: \${color};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references color, depending on tone, which depends on a call expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{color};';
          |              ^^^^^ references color
      
      Dependency chain:
        tone  at <root>/src/entry.ts:4:15
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | const tone = pickColor();
          |              ^^^^^^^^^^^ tone depends on a call expression.
        4 | const color = tone;
    "
  `);
});

test("multi-step dependency chain warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const accent = pickColor();
        const tone = accent;
        const className = tone;

        css\`color: \${className};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references className, depending on accent, which depends on a call expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{className};';
          |              ^^^^^^^^^ references className
      
      Dependency chain:
        tone    at <root>/src/entry.ts:5:19
        accent  at <root>/src/entry.ts:4:14
      
      Root cause:
        at <root>/src/entry.ts:3:16
        2 | 
        3 | const accent = pickColor();
          |                ^^^^^^^^^^^ accent depends on a call expression.
        4 | const tone = accent;
    "
  `);
});

test("delete expression warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        css\`color: \${delete globalThis.theme.color};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains a delete expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{delete globalThis.theme.color};';
          |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ contains a delete expression
    "
  `);
});

test("assignment expression warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        let tone = "hotpink";

        css\`color: \${(tone = "blue")};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an assignment expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{(tone = "blue")};';
          |              ^^^^^^^^^^^^^^^ contains an assignment expression
    "
  `);
});

test("tagged template binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const token = String.raw\`hotpink\`;

        css\`color: \${token};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references token, which depends on a tagged template.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{token};';
          |              ^^^^^ references token
      
      Root cause:
        at <root>/src/entry.ts:3:15
        2 | 
        3 | const token = String.raw'hotpink';
          |               ^^^^^^^^^^^^^^^^^^^ token depends on a tagged template.
        4 | 
    "
  `);
});

test("private field warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        class Tone {
          static #value = "hotpink";
          static className = css\`color: \${this.#value};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains private field access.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:35
      Interpolation:
        at <root>/src/entry.ts:5:35
        4 |   static #value = "hotpink";
        5 |   static className = css'color: #{this.#value};';
          |                                   ^^^^^^^^^^^ contains private field access
        6 | }
    "
  `);
});

test("direct thrown evaluation warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { palette } from "./theme";

        css\`color: \${palette.tone};\`;
      `,
      "/src/theme.ts": `
        export const palette = {
          get tone() {
            throw new Error("boom");
          },
        };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation threw during evaluation: Error: boom.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      Interpolation:
        at <root>/src/entry.ts:4:22
        3 | 
        4 | css'color: #{palette.tone};';
          |                      ^ Error: boom
      
      Stack trace:
        Error: boom
            at Object.get tone (<root>/src/theme.ts:3:11)
            at palette.tone (<root>/src/entry.ts:4:22)
    "
  `);
});

test("dependent thrown evaluation warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { palette } from "./theme";

        const tone = palette.tone;

        css\`color: \${tone};\`;
      `,
      "/src/theme.ts": `
        export const palette = {
          get tone() {
            throw new Error("boom");
          },
        };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which threw during evaluation: Error: boom.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:4:22
        3 | 
        4 | const tone = palette.tone;
          |                      ^ Error: boom
        5 | 
      
      Stack trace:
        Error: boom
            at Object.get tone (<root>/src/theme.ts:3:11)
            at palette.tone (<root>/src/entry.ts:4:22)
    "
  `);
});

test("dependent thrown dependency chain warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { palette } from "./theme";

        const tone = palette.tone;
        const color = tone;

        css\`color: \${color};\`;
      `,
      "/src/theme.ts": `
        export const palette = {
          get tone() {
            throw new Error("boom");
          },
        };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references color, depending on tone, which threw during evaluation: Error: boom.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{color};';
          |              ^^^^^ references color
      
      Dependency chain:
        tone  at <root>/src/entry.ts:5:15
      
      Root cause:
        at <root>/src/entry.ts:4:22
        3 | 
        4 | const tone = palette.tone;
          |                      ^ Error: boom
        5 | const color = tone;
      
      Stack trace:
        Error: boom
            at Object.get tone (<root>/src/theme.ts:3:11)
            at palette.tone (<root>/src/entry.ts:4:22)
    "
  `);
});

test("global css evaluation warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        css.global\`html { color: \${pickColor()}; }\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation threw during evaluation: ReferenceError: pickColor is not defined.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:28
      Interpolation:
        at <root>/src/entry.ts:3:28
        2 | 
        3 | css.global'html { color: #{pickColor()}; }';
          |                            ^ ReferenceError: pickColor is not defined
      
      Stack trace:
        ReferenceError: pickColor is not defined
            at pickColor() (<root>/src/entry.ts:3:28)
    "
  `);
});

test("closure assigning to an outer binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { sizes } from "./theme";

        let total = 0;
        css\`width: \${sizes.forEach((size) => { total += size; }) ?? total}px;\`;
      `,
      "/src/theme.ts": `
        export const sizes = [1, 2, 3];
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an assignment expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | let total = 0;
        5 | css'width: #{sizes.forEach((size) => { total += size; }) ?? total}px;';
          |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ contains an assignment expression
    "
  `);
});

test("nested closure assigning to an enclosing local warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { sizes } from "./theme";

        css\`width: \${(() => {
          let total = 0;
          function add(size: number) {
            total += size;
          }
          sizes.forEach(add);
          return total;
        })()}px;\`;
      `,
      "/src/theme.ts": `
        export const sizes = [1, 2, 3];
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an assignment expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      Interpolation:
        at <root>/src/entry.ts:4:14
         3 | 
         4 | css'width: #{(() => {
           |              ^^^^^^^^ contains an assignment expression
         5 |   let total = 0;
           | ^^^^^^^^^^^^^^^^
         6 |   function add(size: number) {
           | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
         7 |     total += size;
           | ^^^^^^^^^^^^^^^^^^
         8 |   }
           | ^^^
         9 |   sizes.forEach(add);
           | ^^^^^^^^^^^^^^^^^^^^^
        10 |   return total;
           | ^^^^^^^^^^^^^^^
        11 | })()}px;';
           | ^^^^
    "
  `);
});

test("closure assigning to a member warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { theme } from "./theme";

        css\`color: \${((value) => {
          value.color = "blue";
          return value.color;
        })(theme)};\`;
      `,
      "/src/theme.ts": `
        export const theme = { color: "red" };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an assignment expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      Interpolation:
        at <root>/src/entry.ts:4:14
        3 | 
        4 | css'color: #{((value) => {
          |              ^^^^^^^^^^^^^ contains an assignment expression
        5 |   value.color = "blue";
          | ^^^^^^^^^^^^^^^^^^^^^^^
        6 |   return value.color;
          | ^^^^^^^^^^^^^^^^^^^^^
        7 | })(theme)};';
          | ^^^^^^^^^
    "
  `);
});

test("class inside closure warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        css\`content: \${(() => {
          class Tone {}
          return Tone.name;
        })()};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains a class expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:16
      Interpolation:
        at <root>/src/entry.ts:3:16
        2 | 
        3 | css'content: #{(() => {
          |                ^^^^^^^^ contains a class expression
        4 |   class Tone {}
          | ^^^^^^^^^^^^^^^
        5 |   return Tone.name;
          | ^^^^^^^^^^^^^^^^^^^
        6 | })()};';
          | ^^^^
    "
  `);
});

test("closure uses interpolation expression rules", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        css\`content: \${(() => import("./theme"))()};\`;
      `,
      "/src/theme.ts": `
        export const theme = "dark";
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an import expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:16
      Interpolation:
        at <root>/src/entry.ts:3:16
        2 | 
        3 | css'content: #{(() => import("./theme"))()};';
          |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^ contains an import expression
    "
  `);
});

test("await and yield outside retained closures warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        css\`width: \${await Promise.resolve(1)}px;\`;

        function* styles() {
          css\`height: \${yield 2}px;\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains an await expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'width: #{await Promise.resolve(1)}px;';
          |              ^^^^^^^^^^^^^^^^^^^^^^^^ contains an await expression
        4 | 

    warning: CSS literal eval failed: interpolation contains a yield expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:17
      Interpolation:
        at <root>/src/entry.ts:6:17
        5 | function* styles() {
        6 |   css'height: #{yield 2}px;';
          |                 ^^^^^^^ contains a yield expression
        7 | }
    "
  `);
});

test("nested css interpolation referencing a closure local warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { colors } from "./theme";

        css\`content: \${colors.map((color) => css\`color: \${color};\`).join(" ")};\`;
      `,
      "/src/theme.ts": `
        export const colors = ["red", "blue"];
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references color, which is a runtime parameter.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:51
      Interpolation:
        at <root>/src/entry.ts:4:51
        3 | 
        4 | css'content: #{colors.map((color) => css'color: #{color};').join(" ")};';
          |                                                   ^^^^^ references color
      
      Root cause:
        at <root>/src/entry.ts:4:28
        3 | 
        4 | css'content: #{colors.map((color) => css'color: #{color};').join(" ")};';
          |                            ^^^^^ color is a runtime parameter.
    "
  `);
});
