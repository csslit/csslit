import ts from "typescript6";
import type tsServer from "typescript6/lib/tsserverlibrary";
import { expect, test } from "vite-plus/test";
import { collectTemplateEdits, hasCssTemplate } from "./templates.ts";

const typescript = ts as unknown as typeof tsServer;

function parse(source: string): tsServer.SourceFile {
  return ts.createSourceFile(
    "component.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ) as unknown as tsServer.SourceFile;
}

// Decode each edit back into { the source it spans, its metadata } for readable assertions.
function decode(source: string, sourceFile: tsServer.SourceFile) {
  return collectTemplateEdits(typescript, sourceFile).map((edit) => ({
    raw: source.slice(edit.span.start, edit.span.start + edit.span.length),
    metadata: JSON.parse(edit.newText),
  }));
}

test("hasCssTemplate detects css and css.global tags and ignores others", () => {
  expect(hasCssTemplate(typescript, parse("const a = css`color: red;`;"))).toBe(true);
  expect(hasCssTemplate(typescript, parse("const a = css.global`.a {}`;"))).toBe(true);
  expect(hasCssTemplate(typescript, parse("const a = styled`color: red;`;"))).toBe(false);
  expect(hasCssTemplate(typescript, parse("const a = 1;"))).toBe(false);
});

test("no-substitution template yields one quasi spanning the content", () => {
  const source = "const a = css`color: red;`;";
  expect(decode(source, parse(source))).toEqual([
    {
      raw: "color: red;",
      metadata: { template: 0, quasi: 0, quasis: 1, global: false, cooked: "color: red;" },
    },
  ]);
});

test("interpolations split the template into ordered quasis", () => {
  const source = "const a = css`a: ${x}; b: ${y};`;";
  expect(decode(source, parse(source))).toEqual([
    { raw: "a: ", metadata: { template: 0, quasi: 0, quasis: 3, global: false, cooked: "a: " } },
    { raw: "; b: ", metadata: { template: 0, quasi: 1, quasis: 3, global: false, cooked: "; b: " } },
    { raw: ";", metadata: { template: 0, quasi: 2, quasis: 3, global: false, cooked: ";" } },
  ]);
});

test("css.global is marked global", () => {
  const source = "const a = css.global`.a { color: red; }`;";
  expect(decode(source, parse(source))[0]?.metadata.global).toBe(true);
});

test("multiple templates get distinct indices", () => {
  const source = "const a = css`x: 1;`; const b = css`y: 2;`;";
  const decoded = decode(source, parse(source));
  expect(decoded.map((e) => e.metadata.template)).toEqual([0, 1]);
  expect(decoded.map((e) => e.raw)).toEqual(["x: 1;", "y: 2;"]);
});

test("cooked text resolves escapes while the span stays raw", () => {
  const source = 'const a = css`content: "\\u2014";`;';
  const [edit] = decode(source, parse(source));
  expect(edit?.raw).toBe('content: "\\u2014";');
  expect(edit?.metadata.cooked).toBe('content: "—";');
});

test("an escaped closing backtick stays inside the quasi content", () => {
  const source = "const a = css`a\\`b`;";
  const [edit] = decode(source, parse(source));
  expect(edit?.raw).toBe("a\\`b");
});
