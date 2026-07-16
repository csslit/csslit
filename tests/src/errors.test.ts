import { expect, test } from "vite-plus/test";

import { buildErrorSnapshot } from "../harness/csslit-harness.ts";

test("runtime parameter error", async () => {
  const result = await buildErrorSnapshot({
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
    error: runtime parameter 'param' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:16
      
      error: runtime parameter 'param' is unavailable during CSS evaluation
       --> <root>/src/entry.ts:4:16
        |
      3 | function demo(param: string) {
        |               ------------- only exists when this function is called
      4 |   css'color: #{param};';
        |                ^^^^^ CSS reads 'param'
        |
        = note: CSS literals are evaluated independently at build time
    "
  `);
});

test("function declaration with unsupported body error", async () => {
  const result = await buildErrorSnapshot({
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
    error: cannot modify an object property during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:8:14
      
      error: cannot modify an object property during CSS evaluation
       --> <root>/src/entry.ts:8:14
        |
      4 |   value.color = "red";
        |   ----------- modified here
      ...
      8 | css'color: #{tone({ color: "blue" })};';
        |              ^^^^^^^^^^^^^^^^^^^^^^^ evaluation reaches rejected code
        |
        = note: objects used during CSS evaluation are assumed to remain unchanged
        = help: construct the object in a single expression, using immutable patterns such as spreads or 'Object.fromEntries'
    "
  `);
});

test("class binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: classes are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      
      error: classes are not supported during CSS evaluation
       --> <root>/src/entry.ts:5:14
        |
      3 | class Tone {}
        |       ---- declared as a class
      4 |
      5 | css'color: #{Tone};';
        |              ^^^^ CSS reads 'Tone'
        |
        = help: declare the class in a separate module and import it
    "
  `);
});

test("class binding error through member access", async () => {
  const result = await buildErrorSnapshot({
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
    error: classes are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      
      error: classes are not supported during CSS evaluation
       --> <root>/src/entry.ts:7:14
        |
      3 | class Tone {
        |       ---- declared as a class
      ...
      7 | css'color: #{Tone.name};';
        |              ^^^^ CSS reads 'Tone'
        |
        = help: declare the class in a separate module and import it
    "
  `);
});

test("catch binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: catch binding 'error' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:16
      
      error: catch binding 'error' is unavailable during CSS evaluation
       --> <root>/src/entry.ts:6:16
        |
      5 | } catch (error) {
        |          ----- only exists while the catch block runs
      6 |   css'color: #{error};';
        |                ^^^^^ CSS reads 'error'
        |
        = note: CSS literals are evaluated independently at build time
    "
  `);
});

test("reassigned local binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: binding 'tone' does not provide a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      
      error: binding 'tone' does not provide a stable CSS value
       --> <root>/src/entry.ts:6:14
        |
      4 | tone = "blue";
        | ---- reassigned here
      5 |
      6 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
        |
        = note: bindings used by CSS must retain one value
    "
  `);
});

test("destructuring evaluation error error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'tone' threw: Error: destructuring failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      
      error: evaluating 'tone' threw: Error: destructuring failed
       --> <root>/src/entry.ts:6:14
        |
      4 | const { tone = comptime(fail()) } = theme;
        |                         - Error: destructuring failed
      5 |
      6 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
        |
       ::: <root>/src/theme.ts:4:9
        |
      4 |   throw new Error("destructuring failed");
        |         - thrown here, inside 'fail'
    "
  `);
});

test("destructuring preserves values initialized before an error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'border' threw: Error: border failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:12:19
      
      error: evaluating 'border' threw: Error: border failed
        --> <root>/src/entry.ts:12:19
         |
       3 | const { color, border } = comptime({
         |                - Error: border failed
      ...
      12 |   border-width: #{border};
         |                   ^^^^^^ CSS reads 'border'
         |
        ::: <root>/src/entry.ts:6:11
         |
       6 |     throw new Error("border failed");
         |           - thrown here, inside 'Object.get border'
    "
  `);
});

test("destructuring attributes imported getter errors to the pattern", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'border' threw: Error: border failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:21
      
      error: evaluating 'border' threw: Error: border failed
       --> <root>/src/entry.ts:6:21
        |
      4 | const { border } = theme;
        |         - Error: border failed
      5 |
      6 | css'border-width: #{border};';
        |                     ^^^^^^ CSS reads 'border'
        |
       ::: <root>/src/theme.ts:3:11
        |
      3 |     throw new Error("border failed");
        |           - thrown here, inside 'Object.get border'
    "
  `);
});

test("destructuring attributes initializer errors to the initializer", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'border' threw: Error: theme failed
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:21
      
      error: evaluating 'border' threw: Error: theme failed
       --> <root>/src/entry.ts:6:21
        |
      4 | const { border } = comptime(loadTheme());
        |                             - Error: theme failed
      5 |
      6 | css'border-width: #{border};';
        |                     ^^^^^^ CSS reads 'border'
        |
       ::: <root>/src/theme.ts:2:9
        |
      2 |   throw new Error("theme failed");
        |         - thrown here, inside 'loadTheme'
    "
  `);
});

test("var destructuring reports reads before initialization", async () => {
  const result = await buildErrorSnapshot({
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
    error: binding 'color' is read before its initializer runs
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:39
      
      error: binding 'color' is read before its initializer runs
       --> <root>/src/entry.ts:6:39
        |
      4 | var { color = color } = empty;
        |     -----------------
        |     |         |
        |     |         evaluating 'color' reads 'color'
        |     initializer has not run yet
      5 |
      6 | export const className = css'color: #{color};';
        |                                       ^^^^^ CSS reads 'color'
    "
  `);
});

test("duplicate var destructuring binding is a reassignment", async () => {
  const result = await buildErrorSnapshot({
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
    error: binding 'color' does not provide a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:39
      
      error: binding 'color' does not provide a stable CSS value
       --> <root>/src/entry.ts:5:39
        |
      3 | var { color, color } = { color: "hotpink" };
        |              ----- reassigned here
      4 |
      5 | export const className = css'color: #{color};';
        |                                       ^^^^^ CSS reads 'color'
        |
        = note: bindings used by CSS must retain one value
    "
  `);
});

test("loop binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: loop binding 'tone' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:16
      
      error: loop binding 'tone' is unavailable during CSS evaluation
       --> <root>/src/entry.ts:4:16
        |
      3 | for (const tone of ["hotpink"]) {
        |            ---- only exists for a loop iteration
      4 |   css'color: #{tone};';
        |                ^^^^ CSS reads 'tone'
        |
        = note: CSS literals are evaluated independently at build time
    "
  `);
});

test("no initializer error", async () => {
  const result = await buildErrorSnapshot({
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
    error: binding 'tone' has no initializer
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      
      error: binding 'tone' has no initializer
       --> <root>/src/entry.ts:5:14
        |
      3 | let tone: string;
        |     ------------ declared without a value
      4 |
      5 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
    "
  `);
});

test("enum declaration error", async () => {
  const result = await buildErrorSnapshot({
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
    error: TypeScript enums are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      
      error: TypeScript enums are not supported during CSS evaluation
       --> <root>/src/entry.ts:7:14
        |
      3 | enum Tone {
        |      ---- declared as an enum
      ...
      7 | css'color: #{Tone};';
        |              ^^^^ CSS reads 'Tone'
        |
        = help: move the enum to a separate module and import it
    "
  `);
});

test("namespace declaration error", async () => {
  const result = await buildErrorSnapshot({
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
    error: TypeScript namespaces are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      
      error: TypeScript namespaces are not supported during CSS evaluation
       --> <root>/src/entry.ts:7:14
        |
      3 | namespace Tone {
        |           ---- declared as a namespace
      ...
      7 | css'color: #{Tone};';
        |              ^^^^ CSS reads 'Tone'
    "
  `);
});

test("circular dependency error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'tone' threw: ReferenceError: Cannot access 'border' before initialization
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:16
      
      error: evaluating 'tone' threw: ReferenceError: Cannot access 'border' before initialization
       --> <root>/src/entry.ts:7:16
        |
      4 |   const tone = border;
        |                - ReferenceError: Cannot access 'border' before initialization
      ...
      7 |   css'color: #{tone};';
        |                ^^^^ CSS reads 'tone'
    "
  `);
});

test("var initializer order error", async () => {
  const result = await buildErrorSnapshot({
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
    error: binding 'tone' is read before its initializer runs
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      
      error: binding 'tone' is read before its initializer runs
       --> <root>/src/entry.ts:3:14
        |
      3 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
      4 |
      5 | var tone = "hotpink";
        |     ---------------- initializer has not run yet
    "
  `);
});

test("dependent call error", async () => {
  const result = await buildErrorSnapshot({
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
    error: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      
      error: expression is not known to produce a stable CSS value
       --> <root>/src/entry.ts:5:14
        |
      3 | const tone = pickColor();
        |              ----------- return value may not be stable
      4 |
      5 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
        |
        = note: stable CSS values contain no state that changes after they are produced
        = help: wrap this call in 'comptime(...)' to assert that its return value is stable
    "
  `);
});

test("locally defined function call binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      
      error: expression is not known to produce a stable CSS value
       --> <root>/src/entry.ts:7:14
        |
      5 | const tone = pickColor();
        |              ----------- return value may not be stable
      6 |
      7 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
        |
        = note: stable CSS values contain no state that changes after they are produced
        = help: wrap this call in 'comptime(...)' to assert that its return value is stable
    "
  `);
});

test("dependent dependency chain error", async () => {
  const result = await buildErrorSnapshot({
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
    error: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      
      error: expression is not known to produce a stable CSS value
       --> <root>/src/entry.ts:6:14
        |
      3 | const tone = pickColor();
        |              ----------- return value may not be stable
      4 | const color = tone;
        |               ---- evaluating 'color' reads 'tone'
      5 |
      6 | css'color: #{color};';
        |              ^^^^^ CSS reads 'color'
        |
        = note: stable CSS values contain no state that changes after they are produced
        = help: wrap this call in 'comptime(...)' to assert that its return value is stable
    "
  `);
});

test("multi-step dependency chain error", async () => {
  const result = await buildErrorSnapshot({
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
    error: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      
      error: expression is not known to produce a stable CSS value
       --> <root>/src/entry.ts:7:14
        |
      3 | const accent = pickColor();
        |                ----------- return value may not be stable
      4 | const tone = accent;
        |              ------ evaluating 'tone' reads 'accent'
      5 | const className = tone;
        |                   ---- evaluating 'className' reads 'tone'
      6 |
      7 | css'color: #{className};';
        |              ^^^^^^^^^ CSS reads 'className'
        |
        = note: stable CSS values contain no state that changes after they are produced
        = help: wrap this call in 'comptime(...)' to assert that its return value is stable
    "
  `);
});

test("delete expression error", async () => {
  const result = await buildErrorSnapshot({
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
    error: cannot delete an object property during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      
      error: cannot delete an object property during CSS evaluation
       --> <root>/src/entry.ts:3:14
        |
      3 | css'color: #{delete globalThis.theme.color};';
        |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ modifies the object
        |
        = note: objects used during CSS evaluation are assumed to remain unchanged
    "
  `);
});

test("assignment expression error", async () => {
  const result = await buildErrorSnapshot({
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
    error: cannot modify binding 'tone' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:15
      
      error: cannot modify binding 'tone' during CSS evaluation
       --> <root>/src/entry.ts:5:15
        |
      3 | let tone = "hotpink";
        |     ---- declared here
      4 |
      5 | css'color: #{(tone = "blue")};';
        |               ^^^^ modified here
        |
        = note: stateful calculations must be contained in closure-local bindings
    "
  `);
});

test("tagged template binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      
      error: expression is not known to produce a stable CSS value
       --> <root>/src/entry.ts:5:14
        |
      3 | const token = String.raw'hotpink';
        |               ------------------- return value may not be stable
      4 |
      5 | css'color: #{token};';
        |              ^^^^^ CSS reads 'token'
        |
        = note: stable CSS values contain no state that changes after they are produced
        = help: wrap this expression in 'comptime(...)' to assert that the tag's return value is stable
    "
  `);
});

test("stable CSS value initializer errors", async () => {
  const result = await buildErrorSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";

        const arrayValue = ["hotpink"];
        const objectValue = { color: "hotpink" };
        const instanceValue = new Map([["color", "hotpink"]]);
        const sequenceValue = ("red", "hotpink");
        const secondArrayValue = ["blue"];
        const secondObjectValue = { color: "blue" };

        css\`color: \${arrayValue[0]};\`;
        css\`color: \${objectValue.color};\`;
        css\`color: \${instanceValue.get("color")};\`;
        css\`color: \${sequenceValue};\`;
        css\`color: \${secondArrayValue[0]};\`;
        css\`color: \${secondObjectValue.color};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    error: 6 CSS evaluation errors: expression is not known to produce a stable CSS value (+5 more)
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:10:14
      
      error 1: expression is not known to produce a stable CSS value
        --> <root>/src/entry.ts:10:14
         |
       3 | const arrayValue = ["hotpink"];
         |                    ----------- may change later
      ...
      10 | css'color: #{arrayValue[0]};';
         |              ^^^^^^^^^^ CSS reads 'arrayValue'
         |
         = note: stable CSS values contain no state that changes after they are produced
         = help: wrap this expression in 'comptime(...)' to assert that the resulting array is stable
      
      error 2: expression is not known to produce a stable CSS value
        --> <root>/src/entry.ts:11:14
         |
       4 | const objectValue = { color: "hotpink" };
         |                     -------------------- may change later
      ...
      11 | css'color: #{objectValue.color};';
         |              ^^^^^^^^^^^ CSS reads 'objectValue'
         |
         = note: stable CSS values contain no state that changes after they are produced
         = help: wrap this expression in 'comptime(...)' to assert that the resulting object is stable
      
      error 3: expression is not known to produce a stable CSS value
        --> <root>/src/entry.ts:12:14
         |
       5 | const instanceValue = new Map([["color", "hotpink"]]);
         |                       ------------------------------- may change later
      ...
      12 | css'color: #{instanceValue.get("color")};';
         |              ^^^^^^^^^^^^^ CSS reads 'instanceValue'
         |
         = note: stable CSS values contain no state that changes after they are produced
         = help: wrap this expression in 'comptime(...)' to assert that the resulting instance is stable
      
      error 4: expression is not known to produce a stable CSS value
        --> <root>/src/entry.ts:13:14
         |
       6 | const sequenceValue = ("red", "hotpink");
         |                        ---------------- result may not be stable
      ...
      13 | css'color: #{sequenceValue};';
         |              ^^^^^^^^^^^^^ CSS reads 'sequenceValue'
         |
         = note: stable CSS values contain no state that changes after they are produced
         = help: wrap this expression in 'comptime(...)' to assert that its result is stable
      
      error 5: expression is not known to produce a stable CSS value
        --> <root>/src/entry.ts:14:14
         |
       7 | const secondArrayValue = ["blue"];
         |                          -------- may change later
      ...
      14 | css'color: #{secondArrayValue[0]};';
         |              ^^^^^^^^^^^^^^^^ CSS reads 'secondArrayValue'
         |
         = note: stable CSS values contain no state that changes after they are produced
         = help: wrap this expression in 'comptime(...)' to assert that the resulting array is stable
      
      ... 1 more error not shown
    "
  `);
});

test("invalid comptime assertion error", async () => {
  const result = await buildErrorSnapshot({
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
    error: invalid 'comptime' assertion
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      
      error: invalid 'comptime' assertion
       --> <root>/src/entry.ts:5:14
        |
      3 | const tone = comptime();
        |              ---------- 'comptime' expects exactly one non-spread argument
      4 |
      5 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
    "
  `);
});

test("private field error", async () => {
  const result = await buildErrorSnapshot({
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
    error: private fields are unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:35
      
      error: private fields are unavailable during CSS evaluation
       --> <root>/src/entry.ts:5:35
        |
      5 |   static className = css'color: #{this.#value};';
        |                                   ^^^^^^^^^^^ private names cannot be moved outside their class
    "
  `);
});

test("private name comparison error", async () => {
  const result = await buildErrorSnapshot({
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
    error: private names are unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:28
      
      error: private names are unavailable during CSS evaluation
       --> <root>/src/entry.ts:5:28
        |
      5 |   className = css'color: #{#value in this};';
        |                            ^^^^^^^^^^^^^^ private names cannot be moved outside their class
    "
  `);
});

test("JSX error", async () => {
  const result = await buildErrorSnapshot({
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
    error: JSX is not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.tsx:3:16
      
      error: JSX is not supported during CSS evaluation
       --> <root>/src/entry.tsx:3:16
        |
      3 | css'content: #{<div />};';
        |                ^^^^^^^ JSX cannot be evaluated as a CSS value
    "
  `);
});

test("super expression error", async () => {
  const result = await buildErrorSnapshot({
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
    error: 'super' is not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:30
      
      error: 'super' is not supported during CSS evaluation
       --> <root>/src/entry.ts:4:30
        |
      4 |   className = css'content: #{super.name};';
        |                              ^^^^^ 'super' cannot be evaluated by csslit
    "
  `);
});

test("direct thrown evaluation error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluation threw: Error: boom
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:22
      
      error: evaluation threw: Error: boom
       --> <root>/src/entry.ts:4:22
        |
      4 | css'color: #{palette.tone};';
        |                      ^ Error: boom
        |
       ::: <root>/src/theme.ts:3:11
        |
      3 |     throw new Error("boom");
        |           - thrown here, inside 'Object.get tone'
    "
  `);
});

test("dependent thrown evaluation error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'tone' threw: Error: boom
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      
      error: evaluating 'tone' threw: Error: boom
       --> <root>/src/entry.ts:6:14
        |
      4 | const tone = palette.tone;
        |                      - Error: boom
      5 |
      6 | css'color: #{tone};';
        |              ^^^^ CSS reads 'tone'
        |
       ::: <root>/src/theme.ts:3:11
        |
      3 |     throw new Error("boom");
        |           - thrown here, inside 'Object.get tone'
    "
  `);
});

test("dependent thrown dependency chain error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluating 'color' threw: Error: boom
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      
      error: evaluating 'color' threw: Error: boom
       --> <root>/src/entry.ts:7:14
        |
      4 | const tone = palette.tone;
        |                      - Error: boom
      5 | const color = tone;
        |               ---- evaluating 'color' reads 'tone'
      6 |
      7 | css'color: #{color};';
        |              ^^^^^ CSS reads 'color'
        |
       ::: <root>/src/theme.ts:3:11
        |
      3 |     throw new Error("boom");
        |           - thrown here, inside 'Object.get tone'
    "
  `);
});

test("thrown call chain renders caller frames", async () => {
  const result = await buildErrorSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { outer } from "./theme";

        css\`color: \${outer()};\`;
      `,
      "/src/theme.ts": `
        function inner() {
          throw new Error("boom");
        }

        export function outer() {
          return inner();
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    error: evaluation threw: Error: boom
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      
      error: evaluation threw: Error: boom
       --> <root>/src/entry.ts:4:14
        |
      4 | css'color: #{outer()};';
        |              ^ Error: boom
        |
       ::: <root>/src/theme.ts:6:10
        |
      6 |   return inner();
        |          - inside 'outer'
        |
       ::: <root>/src/theme.ts:2:9
        |
      2 |   throw new Error("boom");
        |         - thrown here, inside 'inner'
    "
  `);
});

test("thrown recursion collapses repeated frames", async () => {
  const result = await buildErrorSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        import { recurse } from "./theme";

        css\`width: \${recurse(0)}px;\`;
      `,
      "/src/theme.ts": `
        export function recurse(n: number): number {
          if (n === 5) {
            throw new Error("too deep");
          }
          return recurse(n + 1);
        }
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    error: evaluation threw: Error: too deep
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:14
      
      error: evaluation threw: Error: too deep
       --> <root>/src/entry.ts:4:14
        |
      4 | css'width: #{recurse(0)}px;';
        |              ^ Error: too deep
        |
       ::: <root>/src/theme.ts:5:10
        |
      5 |   return recurse(n + 1);
        |          - [... 4 additional calls inside 'recurse' ...]
        |
       ::: <root>/src/theme.ts:5:10
        |
      5 |   return recurse(n + 1);
        |          - inside 'recurse'
        |
       ::: <root>/src/theme.ts:3:11
        |
      3 |     throw new Error("too deep");
        |           - thrown here, inside 'recurse'
    "
  `);
});

test("global css evaluation error", async () => {
  const result = await buildErrorSnapshot({
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
    error: evaluation threw: ReferenceError: pickColor is not defined
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:28
      
      error: evaluation threw: ReferenceError: pickColor is not defined
       --> <root>/src/entry.ts:3:28
        |
      3 | css.global'html { color: #{pickColor()}; }';
        |                            ^ ReferenceError: pickColor is not defined
    "
  `);
});

test("closure assigning to an outer binding error", async () => {
  const result = await buildErrorSnapshot({
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
    error: cannot modify captured binding 'total' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:40
      
      error: cannot modify captured binding 'total' during CSS evaluation
       --> <root>/src/entry.ts:5:40
        |
      4 | let total = 0;
        |     ----- declared here
      5 | css'width: #{sizes.forEach((size) => { total += size; }) ?? total}px;';
        |                                        ^^^^^ modified here
        |
        = note: closures may read captured bindings, but may only modify their own locals
    "
  `);
});

test("expression-bodied closure assigning to an outer binding error", async () => {
  const result = await buildErrorSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "@csslit/core";
        const sizes = [1, 2];
        let total = 0;

        css\`width: \${sizes.map(size =>
          (total += size)
        ).at(-1)}px;\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    error: cannot modify captured binding 'total' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:4
      
      error: cannot modify captured binding 'total' during CSS evaluation
       --> <root>/src/entry.ts:6:4
        |
      3 | let total = 0;
        |     ----- declared here
      4 |
      5 | css'width: #{sizes.map(size =>
        |                        - captured by this function
      6 |   (total += size)
        |    ^^^^^ modified here
        |
        = note: closures may read captured bindings, but may only modify their own locals
    "
  `);
});

test("nested closure assigning to an enclosing local error", async () => {
  const result = await buildErrorSnapshot({
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
    error: cannot modify captured binding 'total' during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:5
      
      error: cannot modify captured binding 'total' during CSS evaluation
       --> <root>/src/entry.ts:7:5
        |
      5 |   let total = 0;
        |       ----- declared here
      6 |   function add(size: number) {
        |   ------------ captured by this function
      7 |     total += size;
        |     ^^^^^ modified here
        |
        = note: closures may read captured bindings, but may only modify their own locals
    "
  `);
});

test("closure assigning to a member error", async () => {
  const result = await buildErrorSnapshot({
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
    error: cannot modify an object property during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:3
      
      error: cannot modify an object property during CSS evaluation
       --> <root>/src/entry.ts:5:3
        |
      5 |   value.color = "blue";
        |   ^^^^^^^^^^^ modified here
        |
        = note: objects used during CSS evaluation are assumed to remain unchanged
        = help: construct the object in a single expression, using immutable patterns such as spreads or 'Object.fromEntries'
    "
  `);
});

test("class inside closure error", async () => {
  const result = await buildErrorSnapshot({
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
    error: classes are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:3
      
      error: classes are not supported during CSS evaluation
       --> <root>/src/entry.ts:4:3
        |
      4 |   class Tone {}
        |   ^^^^^^^^^^ class evaluation is not supported
        |
        = help: declare the class in a separate module and import it
    "
  `);
});

test("closure uses interpolation expression rules", async () => {
  const result = await buildErrorSnapshot({
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
    error: dynamic imports are not supported during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:23
      
      error: dynamic imports are not supported during CSS evaluation
       --> <root>/src/entry.ts:3:23
        |
      3 | css'content: #{(() => import("./theme"))()};';
        |                       ^^^^^^^^^^^^^^^^^ dynamic import produces an asynchronous value
        |
        = help: use a static import instead
    "
  `);
});

test("await and yield outside retained closures error", async () => {
  const result = await buildErrorSnapshot({
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
    error: 2 CSS evaluation errors: 'await' is not supported in CSS interpolations (+1 more)
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      
      error 1: 'await' is not supported in CSS interpolations
       --> <root>/src/entry.ts:3:14
        |
      3 | css'width: #{await Promise.resolve(1)}px;';
        |              ^^^^^^^^^^^^^^^^^^^^^^^^ direct compile-time 'await' is not supported
        |
        = note: CSS evaluation is synchronous; a promise cannot resolve before the CSS is produced
      
      error 2: 'yield' cannot provide a value during compile-time CSS evaluation
       --> <root>/src/entry.ts:6:17
        |
      6 |   css'height: #{yield 2}px;';
        |                 ^^^^^^^ a yielded value only exists when its generator is iterated
    "
  `);
});

test("nested css interpolation referencing a closure local error", async () => {
  const result = await buildErrorSnapshot({
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
    error: runtime parameter 'color' is unavailable during CSS evaluation
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:4:51
      
      error: runtime parameter 'color' is unavailable during CSS evaluation
       --> <root>/src/entry.ts:4:51
        |
      4 | css'content: #{colors.map((color) => css'color: #{color};').join(" ")};';
        |                            -----                  ^^^^^ CSS reads 'color'
        |                            |
        |                            only exists when this function is called
        |
        = note: CSS literals are evaluated independently at build time
    "
  `);
});

test("multi-line initializer span points at its start", async () => {
  const result = await buildErrorSnapshot({
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
    error: expression is not known to produce a stable CSS value
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:9:14
      
      error: expression is not known to produce a stable CSS value
       --> <root>/src/entry.ts:9:14
        |
      3 |   const theme = {
        |  _______________-
      4 | |   color: "hotpink",
      5 | |   border: "red",
      6 | |   background: "blue",
      7 | |   outline: "green",
      8 | | };
        | |_- may change later
      9 |   css'color: #{theme.color};';
        |                ^^^^^ CSS reads 'theme'
        |
        = note: stable CSS values contain no state that changes after they are produced
        = help: wrap this expression in 'comptime(...)' to assert that the resulting object is stable
    "
  `);
});
