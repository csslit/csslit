import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, test } from "vite-plus/test";
import { buildVirtualCss, toSourceRange } from "./virtual-css.ts";
import type { VirtualCss } from "./virtual-css.ts";
import { API } from "typescript/unstable/async";
import { parseModule, StaleSourceFileError } from "./tsgo.ts";

// Overlay the test cases in memory so tsgo reads them through its virtual filesystem callbacks
// instead of the disk; unknown paths return undefined to fall back to the real lib/node_modules.
const caseRoot = join(process.cwd(), "__virtual__");
const files = new Map<string, string>();
// tsgo normalizes paths to forward slashes with a lowercase drive letter.
const key = (name: string) =>
  name.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, (d) => d.toLowerCase());
const api = new API({
  cwd: process.cwd(),
  fs: {
    readFile: (name) => files.get(key(name)) ?? undefined,
    fileExists: (name) => files.has(key(name)) || undefined,
  },
});
afterAll(async () => {
  await api.close();
});
let caseIndex = 0;

async function virtual(
  sourceWithCaret: string,
  jsx = true,
  expectedSource?: string,
): Promise<VirtualCss | undefined> {
  const offset = sourceWithCaret.indexOf("|");
  const source = sourceWithCaret.slice(0, offset) + sourceWithCaret.slice(offset + 1);
  // A fresh path per case keeps tsgo's source-file cache from serving an earlier case's content.
  const file = join(caseRoot, `case${caseIndex++}${jsx ? ".tsx" : ".ts"}`);
  files.set(key(file), source);
  const module = await parseModule(api, pathToFileURL(file).href, expectedSource ?? source);
  return module && buildVirtualCss(module, offset);
}

async function virtualContent(sourceWithCaret: string, jsx = true): Promise<string | undefined> {
  return (await virtual(sourceWithCaret, jsx))?.content;
}

test("value hole becomes a placeholder identifier", async () => {
  expect(await virtualContent("const a = css`color: |${c}; margin: 0;`;")).toBe(
    "*{color: xx; margin: 0;\n}",
  );
});

test("empty template still has a css insertion point", async () => {
  const v = (await virtual("const a = css`|`;"))!;
  expect(v.content).toBe("*{\n}");
  expect(v.cursor.virtual).toBe(2);
  expect(v.cursor.exact).toBe(true);
});

test("rejects an AST for different document contents", async () => {
  await expect(virtual("void css`color: r|ed;`;", true, "different source")).rejects.toBeInstanceOf(
    StaleSourceFileError,
  );
});

test("void expression does not affect template positions", async () => {
  expect(await virtualContent("void css`\n  color: |red;\n  \n`;")).toBe(
    "*{\n  color: red;\n  \n\n}",
  );
  expect(await virtualContent("void css`\n  color: red;\n  |\n`;")).toBe(
    "*{\n  color: red;\n  \n\n}",
  );
});

test("empty tail preserves a trailing hole and its insertion point", async () => {
  expect(await virtualContent("const a = css`col|or: ${c}`;")).toBe("*{color: xx\n}");
  const withCaret = "const a = css`color: ${c}|`;";
  const v = (await virtual(withCaret))!;
  expect(v.content).toBe("*{color: xx\n}");
  expect(v.cursor.virtual).toBe(v.content.indexOf("xx") + 2);
  expect(v.cursor.exact).toBe(true);
  expect(v.unitSuffix).toEqual({
    virtualStart: v.content.indexOf("xx"),
    virtualEnd: v.content.indexOf("xx") + 2,
    sourceStart: withCaret.replace("|", "").lastIndexOf("`"),
  });
});

test("hole glued to a unit contributes nothing, keeping the completion prefix", async () => {
  expect(await virtualContent("const a = css`width: ${n}p|x;`;")).toBe("*{width: px;\n}");
});

test("percent unit suffix also remains source text", async () => {
  expect(await virtualContent("const a = css`width: ${n}%|;`;")).toBe("*{width: %;\n}");
});

test("attached unit completion records the hole and source suffix", async () => {
  const withCaret = "const a = css`width: ${n}p|x;`;";
  const source = withCaret.replace("|", "");
  const v = (await virtual(withCaret))!;
  expect(v.unitSuffix).toEqual({
    virtualStart: v.content.indexOf("px"),
    virtualEnd: v.content.indexOf("px"),
    sourceStart: source.indexOf("px"),
  });
});

test("a declaration fragment at a block boundary stays empty", async () => {
  expect(await virtualContent("const a = css`\n  ${themeDeclarations()}\n  col|or: red;\n`;")).toBe(
    "*{\n  \n  color: red;\n\n}",
  );
});

test("a standalone selector hole still gets an identifier", async () => {
  expect(await virtualContent("const a = css`\n  ${selector} { col|or: red; }\n`;")).toBe(
    "*{\n  xx { color: red; }\n\n}",
  );
});

test("hole spanning lines still becomes a single placeholder", async () => {
  expect(await virtualContent("const a = css`color: ${\n  c\n}; mar|gin: 0;`;")).toBe(
    "*{color: xx; margin: 0;\n}",
  );
});

test("class-reference hole in a selector", async () => {
  expect(await virtualContent("const a = css`.${cls} & { col|or: red; }`;")).toBe(
    "*{.xx & { color: red; }\n}",
  );
});

test("hole inside a css string", async () => {
  expect(await virtualContent('const a = css`content: "|${x}";`;')).toBe('*{content: "xx";\n}');
});

test("css.global stays a bare stylesheet", async () => {
  expect(await virtualContent("const g = css.global`.a { c|olor: red; }`;")).toBe(
    ".a { color: red; }",
  );
});

test("other templates in the file contribute nothing", async () => {
  const source = "const a = css`x{}`; const b = css`color: r|ed;`;";
  const v = (await virtual(source))!;
  expect(v.content).toBe("*{color: red;\n}");
  expect(v.templateStart).toBe(source.replace("|", "").indexOf("`", source.indexOf("const b")) + 1);
});

test("code around the template contributes nothing", async () => {
  const source = "const before = 1;\nconst a = css`color: r|ed;`;\nconst after = 2;";
  expect(await virtualContent(source)).toBe("*{color: red;\n}");
});

test("unterminated template at end of file", async () => {
  expect(await virtualContent("const a = css`color: r|ed")).toBe("*{color: red\n}");
});

test("parser-inserted template tail keeps only the real css", async () => {
  const source = "const x = css`a|${(value] }b`; const y = css`second`;";
  expect(await virtualContent(source)).toBe("*{a\n}");
});

test("nested template inside a hole gets its own document", async () => {
  const source = "const a = css`.${css`color: r|ed;`} & { color: blue; }`;";
  expect(await virtualContent(source)).toBe("*{color: red;\n}");
});

test("outer template collapses the nested one as part of its hole", async () => {
  const source = "const a = css`.${css`color: red;`} & { color: b|lue; }`;";
  expect(await virtualContent(source)).toBe("*{.xx & { color: blue; }\n}");
});

test("cursor inside a hole yields no css document", async () => {
  expect(await virtualContent("const a = css`color: ${c|ur};`;")).toBeUndefined();
});

test("cursor outside any template yields no css document", async () => {
  expect(await virtualContent("const not|css = 1;")).toBeUndefined();
});

test("request offset lands on the same css in the virtual document", async () => {
  const v = (await virtual("const a = css`.btn { color: r|ed; }`;"))!;
  expect(v.content.slice(0, v.cursor.virtual)).toBe("*{.btn { color: r");
});

test("ranges in placeholders and ranges crossing holes are not editable", async () => {
  const withCaret = "const a = css`color: ${c}; mar|gin: 0;`;";
  const source = withCaret.replace("|", "");
  const v = (await virtual(withCaret))!;
  expect(v.content).toBe("*{color: xx; margin: 0;\n}");
  const placeholder = v.content.indexOf("xx");
  expect(toSourceRange(v.mappings, placeholder + 1, placeholder + 1)).toBeUndefined();
  expect(
    toSourceRange(v.mappings, v.content.indexOf("color"), v.content.indexOf("margin") + 6),
  ).toBeUndefined();
  const margin = v.content.indexOf("margin");
  expect(toSourceRange(v.mappings, margin, margin + 6)).toEqual([
    source.indexOf("margin"),
    source.indexOf("margin") + 6,
  ]);
});

test("a seam glued around a removed hole is ambiguous", async () => {
  const withCaret = "const a = css`width: ${n}p|x;`;";
  const source = withCaret.replace("|", "");
  const v = (await virtual(withCaret))!;
  const seam = v.content.indexOf("px");
  expect(toSourceRange(v.mappings, seam, seam)).toBeUndefined();
  expect(toSourceRange(v.mappings, seam, seam + 2)).toEqual([
    source.indexOf("px"),
    source.indexOf("px") + 2,
  ]);
});

test("js escape sequences cook before the css service sees them", async () => {
  expect(await virtualContent('const a = css`content: "\\u2014|";`;')).toBe('*{content: "—";\n}');
});

test("escaped backslash cooks to a css escape", async () => {
  expect(await virtualContent('const a = css`content: "\\\\2014|";`;')).toBe(
    '*{content: "\\2014";\n}',
  );
});

test("astral code point escape cooks to a surrogate pair", async () => {
  expect(await virtualContent('const a = css`content: "\\u{1F600}|";`;')).toBe(
    '*{content: "😀";\n}',
  );
});

test("crlf cooks to a single newline", async () => {
  expect(await virtualContent("const a = css`color: red;\r\n  mar|gin: 0;`;")).toBe(
    "*{color: red;\n  margin: 0;\n}",
  );
});

test("line continuation joins lines", async () => {
  expect(await virtualContent("const a = css`color: red\\\n|;`;")).toBe("*{color: red;\n}");
});

test("invalid js escape stays verbatim for editor recovery", async () => {
  const v = (await virtual('const a = css`content: "\\2014|";`;'))!;
  expect(v.content).toBe('*{content: "\\2014";\n}');
  expect(v.mappings).toHaveLength(3);
});

test("positions map across cooked escapes", async () => {
  const withCaret = 'const a = css`content: "\\\\2014 \\u2014"; color: r|ed;`;';
  const source = withCaret.replace("|", "");
  const v = (await virtual(withCaret))!;
  expect(v.content).toBe('*{content: "\\2014 —"; color: red;\n}');
  const color = v.content.indexOf("color");
  expect(toSourceRange(v.mappings, color, color + 5)).toEqual([
    source.indexOf("color"),
    source.indexOf("color") + 5,
  ]);
  const dash = v.content.indexOf("—");
  expect(toSourceRange(v.mappings, dash, dash + 1)).toBeUndefined();
});

test("entirely cooked text has no exact reverse range", async () => {
  const v = (await virtual("const a = css`\\u0063\\u006f\\u006c\\u006f\\u0072|`;"))!;
  expect(v.content).toBe("*{color\n}");
  expect(v.mappings).toEqual([]);
  expect(v.cursor.exact).toBe(true);
  expect(toSourceRange(v.mappings, 2, 7)).toBeUndefined();
});

test("cursor inside an escape maps beside its cooked character", async () => {
  const v = (await virtual('const a = css`content: "\\u20|14";`;'))!;
  expect(v.content).toBe('*{content: "—";\n}');
  expect(v.content.slice(0, v.cursor.virtual)).toBe('*{content: "—');
});

test("apostrophe in jsx text does not open a string", async () => {
  expect(await virtualContent("const x = <p>It's fine</p>; const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("backtick in jsx text does not open a template", async () => {
  expect(await virtualContent("const x = <p>tick ` here</p>; const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("template in a jsx attribute expression", async () => {
  expect(await virtualContent('const x = <div title="a`b" style={css`color: r|ed;`} />;')).toBe(
    "*{color: red;\n}",
  );
});

test("template in a jsx expression child", async () => {
  expect(await virtualContent("const x = <p>{css`color: r|ed;`}</p>;")).toBe("*{color: red;\n}");
});

test("regex containing a backtick is not a template", async () => {
  expect(await virtualContent("const re = /`+/; const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("division is not mistaken for a regex", async () => {
  expect(await virtualContent("const k = a / b + `t`; const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("regex after a control-flow paren", async () => {
  expect(await virtualContent("if (x) /`/.test(s); const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("regex brace inside a hole does not end the hole", async () => {
  expect(await virtualContent('const a = css`width: ${s.replace(/{/g, "n")}p|x;`;')).toBe(
    "*{width: px;\n}",
  );
});

test("property access is not a csslit tag", async () => {
  expect(await virtualContent("const a = t.css`x{}`; const b = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("angle type assertion in plain typescript", async () => {
  expect(await virtualContent("const x = <string>y; const a = css`color: r|ed;`;", false)).toBe(
    "*{color: red;\n}",
  );
});

test("generic call before a template argument", async () => {
  expect(await virtualContent("const n = f<T>(css`color: r|ed;`);")).toBe("*{color: red;\n}");
});

test("template inside a plain template hole", async () => {
  expect(await virtualContent("const t = `a ${css`color: r|ed;`} b`;")).toBe("*{color: red;\n}");
});

test("regex after a case-label block", async () => {
  expect(
    await virtualContent("switch (x) { case 1: { } /`/.test(s); } const a = css`color: r|ed;`;"),
  ).toBe("*{color: red;\n}");
});

test("division after a typed function expression", async () => {
  expect(
    await virtualContent(
      "const q = function (): { x: number } { return x; } / d; const a = css`color: r|ed;`;",
    ),
  ).toBe("*{color: red;\n}");
});

test("regex inside an object after a ternary colon", async () => {
  expect(
    await virtualContent(
      "const v = c ? { a: 1 } : { b: /`/.source }; const a = css`color: r|ed;`;",
    ),
  ).toBe("*{color: red;\n}");
});

test("regex in a default parameter value", async () => {
  expect(
    await virtualContent("function f(a: number = /`/.source) {} const a = css`color: r|ed;`;"),
  ).toBe("*{color: red;\n}");
});

test("template in a destructuring default", async () => {
  expect(await virtualContent("const { a: b = css`color: r|ed;` } = o;")).toBe("*{color: red;\n}");
});

test("as-cast before a template", async () => {
  expect(await virtualContent("const n = (x as T) + 1; const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});

test("arrow function with an annotated return object type", async () => {
  expect(
    await virtualContent("const f = (): { x: number } => ({ x: 1 }); const a = css`color: r|ed;`;"),
  ).toBe("*{color: red;\n}");
});

test("function-type variable annotation", async () => {
  expect(await virtualContent("let g: (a: string) => void = h; const a = css`color: r|ed;`;")).toBe(
    "*{color: red;\n}",
  );
});
