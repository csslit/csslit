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
    warning: runtime parameter 'param' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:16
      Interpolation:
        at <root>/src/entry.ts:4:16
        3 | function demo(param: string) {
        4 |   css'color: #{param};';
          |                ^^^^^ references 'param'
        5 | }
      
      Root cause:
        at <root>/src/entry.ts:3:15
        2 | 
        3 | function demo(param: string) {
          |               ^^^^^^^^^^^^^ only exists when this function is called
        4 |   css'color: #{param};';
      
      = note: CSS literals are evaluated independently at build time
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
    warning: cannot modify an object property during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:8:14
      Interpolation:
        at <root>/src/entry.ts:8:14
        7 | 
        8 | css'color: #{tone({ color: "blue" })};';
          |              ^^^^^^^^^^^^^^^^^^^^^^^ evaluation reaches rejected code
      
      Root cause:
        at <root>/src/entry.ts:4:3
        3 | function tone(value: { color: string }) {
        4 |   value.color = "red";
          |   ^^^^^^^^^^^ object properties cannot be modified during CSS evaluation
        5 |   return value.color;
      
      = note: objects used during CSS evaluation are assumed to remain unchanged
      = help: construct the object in a single expression, using immutable patterns such as spreads or 'Object.fromEntries'
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
    warning: classes are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{Tone};';
          |              ^^^^ references 'Tone'
      
      Root cause:
        at <root>/src/entry.ts:3:7
        2 | 
        3 | class Tone {}
          |       ^^^^ declared as a class
        4 | 
      
      = help: declare the class in a separate module and import it
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
    warning: classes are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{Tone.name};';
          |              ^^^^ references 'Tone'
      
      Root cause:
        at <root>/src/entry.ts:3:7
        2 | 
        3 | class Tone {
          |       ^^^^ declared as a class
        4 |   value = "hotpink";
      
      = help: declare the class in a separate module and import it
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
    warning: catch binding 'error' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:16
      Interpolation:
        at <root>/src/entry.ts:6:16
        5 | } catch (error) {
        6 |   css'color: #{error};';
          |                ^^^^^ references 'error'
        7 | }
      
      Root cause:
        at <root>/src/entry.ts:5:10
        4 |   throw new Error("boom");
        5 | } catch (error) {
          |          ^^^^^ only exists while the catch block runs
        6 |   css'color: #{error};';
      
      = note: CSS literals are evaluated independently at build time
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
    warning: binding 'tone' does not provide a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
      Root cause:
        at <root>/src/entry.ts:4:1
        3 | let tone = "hotpink";
        4 | tone = "blue";
          | ^^^^ reassigned here
        5 | 
      
      = note: bindings used by CSS must retain one value
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
    warning: evaluating 'tone' threw: Error: destructuring failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
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
    warning: evaluating 'border' threw: Error: border failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:12:19
      Interpolation:
        at <root>/src/entry.ts:12:19
        11 |   color: #{color};
        12 |   border-width: #{border};
           |                   ^^^^^^ references 'border'
        13 | ';
      
      Root cause:
        at <root>/src/entry.ts:3:16
        2 | 
        3 | const { color, border } = comptime({
          |                ^ Error: border failed
        4 |   color: "hotpink",
      
      Stack trace:
        Error: border failed
            at Object.get border (<root>/src/entry.ts:6:11)
            at border (<root>/src/entry.ts:3:16)
    "
  `);
});

test("destructuring attributes imported getter errors to the pattern", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { theme } from "./theme";

        const { border } = theme;

        css\`border-width: \${border};\`;
      `,
      "/src/theme.ts": `
        export const theme = {
          get border() {
            throw new Error("border failed");
          },
        };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: evaluating 'border' threw: Error: border failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:21
      Interpolation:
        at <root>/src/entry.ts:6:21
        5 | 
        6 | css'border-width: #{border};';
          |                     ^^^^^^ references 'border'
      
      Root cause:
        at <root>/src/entry.ts:4:9
        3 | 
        4 | const { border } = theme;
          |         ^ Error: border failed
        5 | 
      
      Stack trace:
        Error: border failed
            at Object.get border (<root>/src/theme.ts:3:11)
            at border (<root>/src/entry.ts:4:9)
    "
  `);
});

test("destructuring attributes initializer errors to the initializer", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "@csslit/core";
        import { loadTheme } from "./theme";

        const { border } = comptime(loadTheme());

        css\`border-width: \${border};\`;
      `,
      "/src/theme.ts": `
        export function loadTheme() {
          throw new Error("theme failed");
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: evaluating 'border' threw: Error: theme failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:21
      Interpolation:
        at <root>/src/entry.ts:6:21
        5 | 
        6 | css'border-width: #{border};';
          |                     ^^^^^^ references 'border'
      
      Root cause:
        at <root>/src/entry.ts:4:29
        3 | 
        4 | const { border } = comptime(loadTheme());
          |                             ^ Error: theme failed
        5 | 
      
      Stack trace:
        Error: theme failed
            at loadTheme (<root>/src/theme.ts:2:9)
            at border (<root>/src/entry.ts:4:29)
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
    warning: binding 'color' is read before its initializer runs
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:39
      Interpolation:
        at <root>/src/entry.ts:6:39
        5 | 
        6 | export const className = css'color: #{color};';
          |                                       ^^^^^ references 'color'
      
      Dependency chain:
        color  at <root>/src/entry.ts:4:15
      
      Root cause:
        at <root>/src/entry.ts:4:5
        3 | 
        4 | var { color = color } = empty;
          |     ^^^^^^^^^^^^^^^^^ initializer has not run yet
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
    warning: binding 'color' does not provide a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:39
      Interpolation:
        at <root>/src/entry.ts:5:39
        4 | 
        5 | export const className = css'color: #{color};';
          |                                       ^^^^^ references 'color'
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | var { color, color } = { color: "hotpink" };
          |              ^^^^^ reassigned here
        4 | 
      
      = note: bindings used by CSS must retain one value
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
    warning: loop binding 'tone' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:16
      Interpolation:
        at <root>/src/entry.ts:4:16
        3 | for (const tone of ["hotpink"]) {
        4 |   css'color: #{tone};';
          |                ^^^^ references 'tone'
        5 | }
      
      Root cause:
        at <root>/src/entry.ts:3:12
        2 | 
        3 | for (const tone of ["hotpink"]) {
          |            ^^^^ only exists for a loop iteration
        4 |   css'color: #{tone};';
      
      = note: CSS literals are evaluated independently at build time
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
    warning: binding 'tone' has no initializer
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
      Root cause:
        at <root>/src/entry.ts:3:5
        2 | 
        3 | let tone: string;
          |     ^^^^^^^^^^^^ declared without a value
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
    warning: TypeScript enums are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{Tone};';
          |              ^^^^ references 'Tone'
      
      Root cause:
        at <root>/src/entry.ts:3:6
        2 | 
        3 | enum Tone {
          |      ^^^^ declared as an enum
        4 |   Hotpink = "hotpink",
      
      = help: move the enum to a separate module and import it
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
    warning: TypeScript namespaces are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{Tone};';
          |              ^^^^ references 'Tone'
      
      Root cause:
        at <root>/src/entry.ts:3:11
        2 | 
        3 | namespace Tone {
          |           ^^^^ declared as a namespace
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
    warning: evaluating 'tone' threw: ReferenceError: Cannot access 'border' before initialization
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:16
      Interpolation:
        at <root>/src/entry.ts:7:16
        6 | 
        7 |   css'color: #{tone};';
          |                ^^^^ references 'tone'
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
    warning: binding 'tone' is read before its initializer runs
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{tone};';
          |              ^^^^ references 'tone'
        4 | 
      
      Root cause:
        at <root>/src/entry.ts:5:5
        4 | 
        5 | var tone = "hotpink";
          |     ^^^^^^^^^^^^^^^^ initializer has not run yet
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
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | const tone = pickColor();
          |              ^^^^^^^^^^^ the stability of a function's return value cannot be inferred
        4 | 
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this call in 'comptime(...)' to assert that its return value is stable
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
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
      Root cause:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | const tone = pickColor();
          |              ^^^^^^^^^^^ the stability of a function's return value cannot be inferred
        6 | 
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this call in 'comptime(...)' to assert that its return value is stable
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
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{color};';
          |              ^^^^^ references 'color'
      
      Dependency chain:
        tone  at <root>/src/entry.ts:4:15
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | const tone = pickColor();
          |              ^^^^^^^^^^^ the stability of a function's return value cannot be inferred
        4 | const color = tone;
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this call in 'comptime(...)' to assert that its return value is stable
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
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{className};';
          |              ^^^^^^^^^ references 'className'
      
      Dependency chain:
        tone    at <root>/src/entry.ts:5:19
        accent  at <root>/src/entry.ts:4:14
      
      Root cause:
        at <root>/src/entry.ts:3:16
        2 | 
        3 | const accent = pickColor();
          |                ^^^^^^^^^^^ the stability of a function's return value cannot be inferred
        4 | const tone = accent;
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this call in 'comptime(...)' to assert that its return value is stable
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
    warning: cannot delete an object property during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{delete globalThis.theme.color};';
          |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ deleting a property modifies the object
      
      = note: objects used during CSS evaluation are assumed to remain unchanged
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
    warning: cannot modify binding 'tone' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:15
      Interpolation:
        at <root>/src/entry.ts:5:15
        4 | 
        5 | css'color: #{(tone = "blue")};';
          |               ^^^^ only bindings declared inside a closure can be modified
      
      = note: stateful calculations must be contained in closure-local bindings
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
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{token};';
          |              ^^^^^ references 'token'
      
      Root cause:
        at <root>/src/entry.ts:3:15
        2 | 
        3 | const token = String.raw'hotpink';
          |               ^^^^^^^^^^^^^^^^^^^ the stability of a tag function's return value cannot be inferred
        4 | 
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this expression in 'comptime(...)' to assert that the tag's return value is stable
    "
  `);
});

test("stable CSS value initializer warnings", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const arrayValue = ["hotpink"];
        const objectValue = { color: "hotpink" };
        const instanceValue = new Map([["color", "hotpink"]]);
        const sequenceValue = ("red", "hotpink");

        css\`color: \${arrayValue[0]};\`;
        css\`color: \${objectValue.color};\`;
        css\`color: \${instanceValue.get("color")};\`;
        css\`color: \${sequenceValue};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:8:14
      Interpolation:
        at <root>/src/entry.ts:8:14
        7 | 
        8 | css'color: #{arrayValue[0]};';
          |              ^^^^^^^^^^ references 'arrayValue'
        9 | css'color: #{objectValue.color};';
      
      Root cause:
        at <root>/src/entry.ts:3:20
        2 | 
        3 | const arrayValue = ["hotpink"];
          |                    ^^^^^^^^^^^ new arrays can contain state that changes later
        4 | const objectValue = { color: "hotpink" };
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this expression in 'comptime(...)' to assert that the resulting array is stable

    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:9:14
      Interpolation:
        at <root>/src/entry.ts:9:14
         8 | css'color: #{arrayValue[0]};';
         9 | css'color: #{objectValue.color};';
           |              ^^^^^^^^^^^ references 'objectValue'
        10 | css'color: #{instanceValue.get("color")};';
      
      Root cause:
        at <root>/src/entry.ts:4:21
        3 | const arrayValue = ["hotpink"];
        4 | const objectValue = { color: "hotpink" };
          |                     ^^^^^^^^^^^^^^^^^^^^ new objects can contain state that changes later
        5 | const instanceValue = new Map([["color", "hotpink"]]);
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this expression in 'comptime(...)' to assert that the resulting object is stable

    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:10:14
      Interpolation:
        at <root>/src/entry.ts:10:14
         9 | css'color: #{objectValue.color};';
        10 | css'color: #{instanceValue.get("color")};';
           |              ^^^^^^^^^^^^^ references 'instanceValue'
        11 | css'color: #{sequenceValue};';
      
      Root cause:
        at <root>/src/entry.ts:5:23
        4 | const objectValue = { color: "hotpink" };
        5 | const instanceValue = new Map([["color", "hotpink"]]);
          |                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ constructed instances can contain state that changes later
        6 | const sequenceValue = ("red", "hotpink");
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this expression in 'comptime(...)' to assert that the resulting instance is stable

    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:11:14
      Interpolation:
        at <root>/src/entry.ts:11:14
        10 | css'color: #{instanceValue.get("color")};';
        11 | css'color: #{sequenceValue};';
           |              ^^^^^^^^^^^^^ references 'sequenceValue'
      
      Root cause:
        at <root>/src/entry.ts:6:24
        5 | const instanceValue = new Map([["color", "hotpink"]]);
        6 | const sequenceValue = ("red", "hotpink");
          |                        ^^^^^^^^^^^^^^^^ the stability of a sequence expression's result cannot be inferred
        7 | 
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this expression in 'comptime(...)' to assert that its result is stable
    "
  `);
});

test("invalid comptime assertion warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "@csslit/core";

        const tone = comptime();

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: invalid 'comptime' assertion
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
      Root cause:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | const tone = comptime();
          |              ^^^^^^^^^^ 'comptime' expects exactly one non-spread argument
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
    warning: private fields are unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:35
      Interpolation:
        at <root>/src/entry.ts:5:35
        4 |   static #value = "hotpink";
        5 |   static className = css'color: #{this.#value};';
          |                                   ^^^^^^^^^^^ private names cannot be moved outside their class
        6 | }
    "
  `);
});

test("private name comparison warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        class Tone {
          #value = "hotpink";
          className = css\`color: \${#value in this};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: private names are unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:28
      Interpolation:
        at <root>/src/entry.ts:5:28
        4 |   #value = "hotpink";
        5 |   className = css'color: #{#value in this};';
          |                            ^^^^^^^^^^^^^^ private names cannot be moved outside their class
        6 | }
    "
  `);
});

test("JSX warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.tsx",
    files: {
      "/src/entry.tsx": `
        import { css } from "@csslit/core";

        css\`content: \${<div />};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: JSX is not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.tsx:3:16
      Interpolation:
        at <root>/src/entry.tsx:3:16
        2 | 
        3 | css'content: #{<div />};';
          |                ^^^^^^^ JSX cannot be evaluated as a CSS value
    "
  `);
});

test("super expression warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        class Tone extends Object {
          className = css\`content: \${super.name};\`;
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: 'super' is not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:30
      Interpolation:
        at <root>/src/entry.ts:4:30
        3 | class Tone extends Object {
        4 |   className = css'content: #{super.name};';
          |                              ^^^^^ 'super' cannot be evaluated by csslit
        5 | }
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
    warning: evaluation threw: Error: boom
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
    warning: evaluating 'tone' threw: Error: boom
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references 'tone'
      
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
    warning: evaluating 'color' threw: Error: boom
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{color};';
          |              ^^^^^ references 'color'
      
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
    warning: evaluation threw: ReferenceError: pickColor is not defined
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
    warning: cannot modify captured binding 'total' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:40
        4 | let total = 0;
        5 | css'width: #{sizes.forEach((size) => { total += size; }) ?? total}px;';
          |                                        ^^^^^ this binding is captured by the closure
      
      = note: closures may read captured bindings, but may only modify their own locals
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
    warning: cannot modify captured binding 'total' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      Interpolation:
        at <root>/src/entry.ts:7:5
        6 |   function add(size: number) {
        7 |     total += size;
          |     ^^^^^ this binding is captured by the closure
        8 |   }
      
      = note: closures may read captured bindings, but may only modify their own locals
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
    warning: cannot modify an object property during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      Interpolation:
        at <root>/src/entry.ts:5:3
        4 | css'color: #{((value) => {
        5 |   value.color = "blue";
          |   ^^^^^^^^^^^ object properties cannot be modified during CSS evaluation
        6 |   return value.color;
      
      = note: objects used during CSS evaluation are assumed to remain unchanged
      = help: construct the object in a single expression, using immutable patterns such as spreads or 'Object.fromEntries'
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
    warning: classes are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:16
      Interpolation:
        at <root>/src/entry.ts:4:3
        3 | css'content: #{(() => {
        4 |   class Tone {}
          |   ^^^^^^^^^^ class evaluation is not supported
        5 |   return Tone.name;
      
      = help: declare the class in a separate module and import it
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
    warning: dynamic imports are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:16
      Interpolation:
        at <root>/src/entry.ts:3:23
        2 | 
        3 | css'content: #{(() => import("./theme"))()};';
          |                       ^^^^^^^^^^^^^^^^^ dynamic import produces an asynchronous value
      
      = help: use a static import instead
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
    warning: 'await' is not supported in CSS interpolations
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'width: #{await Promise.resolve(1)}px;';
          |              ^^^^^^^^^^^^^^^^^^^^^^^^ direct compile-time 'await' is not supported
        4 | 
      
      = note: CSS evaluation is synchronous; a promise cannot resolve before the CSS is produced

    warning: 'yield' cannot provide a value during compile-time CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:17
      Interpolation:
        at <root>/src/entry.ts:6:17
        5 | function* styles() {
        6 |   css'height: #{yield 2}px;';
          |                 ^^^^^^^ a yielded value only exists when its generator is iterated
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
    warning: runtime parameter 'color' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:51
      Interpolation:
        at <root>/src/entry.ts:4:51
        3 | 
        4 | css'content: #{colors.map((color) => css'color: #{color};').join(" ")};';
          |                                                   ^^^^^ references 'color'
      
      Root cause:
        at <root>/src/entry.ts:4:28
        3 | 
        4 | css'content: #{colors.map((color) => css'color: #{color};').join(" ")};';
          |                            ^^^^^ only exists when this function is called
      
      = note: CSS literals are evaluated independently at build time
    "
  `);
});

test("multi-line initializer span points at its start", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const theme = {
          color: "hotpink",
          border: "red",
          background: "blue",
          outline: "green",
        };
        css\`color: \${theme.color};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:9:14
      Interpolation:
        at <root>/src/entry.ts:9:14
        8 | };
        9 | css'color: #{theme.color};';
          |              ^^^^^ references 'theme'
      
      Root cause:
        at <root>/src/entry.ts:3:15
        2 | 
        3 | const theme = {
          |               ^ new objects can contain state that changes later
        4 |   color: "hotpink",
      
      = note: stable CSS values contain no state that changes after they are produced
      = help: wrap this expression in 'comptime(...)' to assert that the resulting object is stable
    "
  `);
});
