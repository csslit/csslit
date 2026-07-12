import { expect, test } from "vite-plus/test";

import { buildWarningSnapshot } from "../harness/csslit-harness.ts";

test("runtime parameter warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

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

test("function binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        function tone() {}

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which is a function binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:3:10
        2 | 
        3 | function tone() {}
          |          ^^^^ tone is a function binding.
        4 | 
    "
  `);
});

test("function binding warning through call access", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        function tone() {
          return "red";
        }

        css\`color: \${tone()};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which is a function binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{tone()};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:3:10
        2 | 
        3 | function tone() {
          |          ^^^^ tone is a function binding.
        4 |   return "red";
    "
  `);
});

test("class binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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

test("destructuring local binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";
        import { theme } from "./theme";

        const { tone } = theme;

        css\`color: \${tone};\`;
      `,
      "/src/theme.ts": `
        export const theme = { tone: "hotpink" };
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, which comes from destructuring.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:6:14
      Interpolation:
        at <root>/src/entry.ts:6:14
        5 | 
        6 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Root cause:
        at <root>/src/entry.ts:4:7
        3 | 
        4 | const { tone } = theme;
          |       ^^^^^^^^^^^^^^^^ tone comes from destructuring.
        5 | 
    "
  `);
});

test("loop binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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
          import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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

test("locally defined function direct interpolation warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        function pickColor() { return "red"; }

        css\`color: \${pickColor()};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references pickColor, which is a function binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:5:14
      Interpolation:
        at <root>/src/entry.ts:5:14
        4 | 
        5 | css'color: #{pickColor()};';
          |              ^^^^^^^^^ references pickColor
      
      Root cause:
        at <root>/src/entry.ts:3:10
        2 | 
        3 | function pickColor() { return "red"; }
          |          ^^^^^^^^^ pickColor is a function binding.
        4 | 
    "
  `);
});

test("locally defined function comptime binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { comptime, css } from "csslit";

        function pickColor() { return "red"; }

        const tone = comptime(pickColor());

        css\`color: \${tone};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation references tone, depending on pickColor, which is a function binding.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:7:14
      Interpolation:
        at <root>/src/entry.ts:7:14
        6 | 
        7 | css'color: #{tone};';
          |              ^^^^ references tone
      
      Dependency chain:
        pickColor  at <root>/src/entry.ts:5:23
      
      Root cause:
        at <root>/src/entry.ts:3:10
        2 | 
        3 | function pickColor() { return "red"; }
          |          ^^^^^^^^^ pickColor is a function binding.
        4 | 
    "
  `);
});

test("dependent call warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";

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

test("new expression warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        css\`color: \${new String("hotpink")};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains a new expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{new String("hotpink")};';
          |              ^^^^^^^^^^^^^^^^^^^^^ contains a new expression
    "
  `);
});

test("sequence expression warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        css\`color: \${(0, "hotpink")};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains a sequence expression.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{(0, "hotpink")};';
          |              ^^^^^^^^^^^^^^ contains a sequence expression
    "
  `);
});

test("tagged template warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

        css\`color: \${String.raw\`hotpink\`};\`;
      `,
    },
  });

  expect(result).toMatchInlineSnapshot(`
    "
    warning: CSS literal eval failed: interpolation contains a tagged template.
      Plugin: vite-plugin-csslit
      File: <root>/src/entry.ts:3:14
      Interpolation:
        at <root>/src/entry.ts:3:14
        2 | 
        3 | css'color: #{String.raw'hotpink'};';
          |              ^^^^^^^^^^^^^^^^^^^ contains a tagged template
    "
  `);
});

test("tagged template binding warning", async () => {
  const result = await buildWarningSnapshot({
    entry: "/src/entry.ts",
    files: {
      "/src/entry.ts": `
        import { css } from "csslit";

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
        import { css } from "csslit";

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
        import { css } from "csslit";
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
        import { css } from "csslit";
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
        import { css } from "csslit";
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
        import { css } from "csslit";

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
