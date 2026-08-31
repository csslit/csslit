import { describe, expect, inject, test as base } from "vite-plus/test";
import { fastTargets, serveWebTargets } from "./testing/frameworks.ts";
import type { Target } from "./testing/frameworks.ts";
import { virtualCssFor } from "./testing/locator.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    backend: "harness" | "serve-web";
  }
}

const targets = inject("backend") === "serve-web" ? serveWebTargets : fastTargets;

function dedent(value: string): string {
  const lines = value.split("\n");

  let common = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] = lines[i]!.trimEnd());
    if (line.length === 0) continue;
    let j = 0;
    while (line.charCodeAt(j) === 32) j++;
    if (j < common) common = j;
  }

  let i = 0;
  let len = lines.length;

  while (i < len && !lines[i]) i++;
  while (i < len && !lines[len - 1]) len--;
  if (i === len) return "";

  let result = "";
  for (; i < len; i++) {
    const line = lines[i]!;
    if (line.length !== 0) result += line.slice(common);
    if (i < len - 1) result += "\n";
  }

  return result;
}

const suite = base
  .extend("editors", { scope: "file" }, ({}, { onCleanup }) => {
    const resources = new AsyncDisposableStack();
    onCleanup(() => resources.disposeAsync());
    const locators = new Map(targets.map((t) => [t, resources.use(t.createLocator())] as const));

    return (target: Target, declaration: string) => {
      const framework = target.framework;
      const source = framework.wrap(dedent(declaration));
      return virtualCssFor(locators.get(target)!, source);
    };
  })
  .extend("target", (): Target => {
    throw new Error("`target` is supplied per suite by `test.override`");
  })
  .extend("virtual", ({ editors, target }) => {
    return (declaration: string) => editors(target, declaration);
  });

describe.each(targets)("$name", (target) => {
  const { framework } = target;
  const test = suite.override("target", () => target);

  test("cursor in a declaration value", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: |red;\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»color: |red;«
      }»
      ---
      source +7, virtual 9, exact true, edits +7..+10"
    `);
  });

  test("cursor at the template end", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: red;|\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»color: red;|«
      }»
      ---
      source +11, virtual 13, exact true, edits +11..+11"
    `);
  });

  test("empty template", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`|\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{|
      }»
      ---
      source +0, virtual 2, exact true, edits none"
    `);
  });

  test("cursor after a hole", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: \${tone}|;\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»color: «xx|»;«
      }»
      ---
      source +14, virtual 11, exact true, unitSuffix 9..11 -> +14, edits none"
    `);
  });

  test("empty quasi after a hole", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: \${tone}|\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»color: «xx|
      }»
      ---
      source +14, virtual 11, exact true, unitSuffix 9..11 -> +14, edits none"
    `);
  });

  test("cursor in a unit suffix after a hole", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`width: \${size}p|x;\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»width: p|x;«
      }»
      ---
      source +15, virtual 10, exact true, unitSuffix 9..9 -> +14, edits +14..+16"
    `);
  });

  test("hole as a whole declaration", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`
        \${base}
        color: |red;
      \`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»
      \x20\x20
        color: |red;
      «
      }»
      ---
      source +20, virtual 15, exact true, edits +20..+23"
    `);
  });

  test("cursor after a cooked escape", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`content: "\\\\2014|";\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»content: "«\\»2014|";«
      }»
      ---
      source +16, virtual 17, exact true, edits +12..+16"
    `);
  });

  test("global stylesheet", async ({ virtual }) => {
    const result = await virtual(`
      const a = css.global\`
        .card {
          color: |red;
        }
      \`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "
        .card {
          color: |red;
        }

      ---
      source +22, virtual 22, exact true, edits +22..+25"
    `);
  });

  test("hole in selector position", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`
        \${selector} { col|or: red; }
      \`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»
        «xx» { col|or: red; }
      «
      }»
      ---
      source +20, virtual 13, exact true, edits +17..+22"
    `);
  });

  test("hole inside a css string", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`content: "|\${x}";\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»content: "|«xx»";«
      }»
      ---
      source +10, virtual 12, exact true, edits none"
    `);
  });

  test("cursor inside a hole", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: \${c|ur};\`;
    `);
    expect(result).toMatchInlineSnapshot(`"no template at offset"`);
  });

  test("nested template gets its own document", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`.\${css\`color: r|ed;\`} & { color: blue; }\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»color: r|ed;«
      }»
      ---
      source +8, virtual 10, exact true, edits +7..+10"
    `);
  });

  test("unterminated template", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: r|ed
    `);
    if (target.tsgo) {
      expect(result).toMatchInlineSnapshot(`
        "«*{»color: r|ed

        export const App = () => <div className={a} />;
        «
        }»
        ---
        source +8, virtual 10, exact true, edits +7..+10"
      `);
    } else if (framework.name === "mdx") {
      expect(result).toMatchInlineSnapshot(`"no TypeScript implementation answered"`);
    } else if (framework.name === "vue" || framework.name === "astro") {
      expect(result).toMatchInlineSnapshot(`"no template at offset"`);
    } else if (framework.name === "tsrx") {
      expect(result).toMatchInlineSnapshot(`
        "«*{»color: r|ed
          <div class={a}>{"hi"}</div>
        }«
        }»
        ---
        source +8, virtual 10, exact true, edits +7..+10"
      `);
    } else {
      expect(result).toMatchInlineSnapshot(`
        "«*{»color: r|ed

        export const App = () => <div className={a} />;«
        }»
        ---
        source +8, virtual 10, exact true, edits +7..+10"
      `);
    }
  });

  test("malformed expression in a hole", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`co|lor: \${(value] };\`;
    `);
    if (framework.name === "mdx") {
      expect(result).toMatchInlineSnapshot(`"no TypeScript implementation answered"`);
    } else {
      expect(result).toMatchInlineSnapshot(`
        "«*{»co|lor: «xx
        }»
        ---
        source +2, virtual 4, exact true, edits +0..+5"
      `);
    }
  });

  test("astral escape cooks to a surrogate pair", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`content: "\\u{1F600}"; color: r|ed;\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»content: "«😀»"; color: r|ed;«
      }»
      ---
      source +30, virtual 25, exact true, edits +29..+32"
    `);
  });

  test("invalid js escape stays verbatim", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`content: "\\2014|";\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»content: "\\2014|";«
      }»
      ---
      source +15, virtual 17, exact true, edits +11..+15"
    `);
  });

  test("escaped interpolation opener stays template content", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`content: "\\\${|";\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»content: "«$»{|";«
      }»
      ---
      source +13, virtual 14, exact true, edits +13..+13"
    `);
  });

  test("selects the template containing the cursor", async ({ virtual }) => {
    const result = await virtual(`
      const decoy = css\`color: red;\`;
      const a = css\`margin: |0;\`;
    `);
    expect(result).toMatchInlineSnapshot(`
      "«*{»margin: |0;«
      }»
      ---
      source +8, virtual 10, exact true, edits +8..+9"
    `);
  });

  test("no template at the cursor", async ({ virtual }) => {
    const result = await virtual(`
      const a = css\`color: red;\`;
      const b| = 1;
    `);
    expect(result).toMatchInlineSnapshot(`"no template at offset"`);
  });
});
