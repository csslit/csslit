import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, expect, test } from "vite-plus/test";
import type { IGrammar } from "vscode-textmate";

// Both libraries ship UMD bundles that defeat ESM named-export detection.
const require = createRequire(import.meta.url);
const oniguruma = require("vscode-oniguruma") as typeof import("vscode-oniguruma");
const vsctm = require("vscode-textmate") as typeof import("vscode-textmate");

const syntaxesDir = join(import.meta.dirname, "..", "generated", "syntaxes");
const grammarFiles: Record<string, string> = {
  "source.ts": require.resolve("tm-grammars/grammars/typescript.json"),
  "source.csslit.css": join(syntaxesDir, "csslit-css.tmLanguage.json"),
  "source.csslit.scss": join(syntaxesDir, "csslit-scss.tmLanguage.json"),
  "csslit.typescript.injection": join(syntaxesDir, "csslit-typescript.tmLanguage.json"),
  "csslit.typescript.holes.injection": join(syntaxesDir, "csslit-typescript-holes.tmLanguage.json"),
};

let grammar: IGrammar;

beforeAll(async () => {
  const onigMain = createRequire(import.meta.url).resolve("vscode-oniguruma");
  const wasm = readFileSync(join(dirname(onigMain), "onig.wasm")).buffer;
  await oniguruma.loadWASM(wasm);
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (source) => new oniguruma.OnigString(source),
    }),
    loadGrammar: (scopeName) => {
      const file = grammarFiles[scopeName];
      if (!file) return Promise.resolve(null);
      const raw = readFileSync(file, "utf8");
      return Promise.resolve(vsctm.parseRawGrammar(raw, file));
    },
    getInjections: (scopeName) =>
      scopeName === "source.ts"
        ? ["csslit.typescript.injection", "csslit.typescript.holes.injection"]
        : [],
  });
  const loaded = await registry.loadGrammar("source.ts");
  if (!loaded) throw new Error("failed to load source.ts");
  grammar = loaded;
});

type Token = { text: string; scopes: string[] };

function tokenize(lines: string[]): Token[][] {
  let stack = vsctm.INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    return result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    }));
  });
}

const isCsslitScope = (scope: string) => scope.includes("csslit") || /\.css\b|\.scss\b/.test(scope);

function expectPlainTypeScript(tokens: Token[], context: string): void {
  for (const token of tokens) {
    const leaked = token.scopes.filter(isCsslitScope);
    expect(leaked, `${context}: ${JSON.stringify(token.text)} leaked ${leaked.join(" ")}`).toEqual(
      [],
    );
  }
  // `const` scoped as a TS keyword proves the host grammar is really back in
  // charge rather than the line merely falling through unstyled.
  const constToken = tokens.find((token) => token.text === "const");
  expect(constToken?.scopes.join(" ")).toContain("storage.type");
}

const SENTINEL = "const AFTER = othercode();";

// Broken CSS must not leak past the template boundary.
const pathological: Record<string, string[]> = {
  "unterminated block comment": ["const a = css`", "  .x { color: red; /* broken", "`;"],
  "unterminated string": ["const a = css`", '  .x { content: "broken', "`;"],
  "unterminated string in @media nesting": [
    "const a = css`",
    '@media screen { .x { color: red; url( "broken',
    "`;",
  ],
  "backtick swallowed by url token": ["const a = css`.x { b: url(img`; const inline = 1;"],
  "template ends inside url()": ["const a = css`.x { b: url(`; const inline = 1;"],
  "template ends right after string open": ['const a = css`.x { b: url("`; const inline = 1;'],
  "template ends right after comment open": ["const a = css`.x { /*`; const inline = 1;"],
  "zero-width media begin at boundary": ["const a = css`@media `; const inline = 1;"],
  "escaped backslash pair then real end": [
    'const a = css`.x { content: "a\\\\`; const inline = 1;',
  ],
  "css word before closing backtick": ["const a = css`.x { color: red; } .css`; const inline = 1;"],
  "consecutive holes": ["const a = css`.x { margin: ${a}${b}; }`; const inline = 1;"],
  "hole at template start": ["const a = css`${base}.x { color: red; }`;"],
  "unterminated comment then more templates": [
    "const a = css`/* broken",
    "`;",
    "const b = css`.y { color: blue; }`;",
  ],
  "global template with broken selector": ["const a = css.global`.x[ { /*`; const inline = 1;"],
  "hole in @media header": ["const a = css`@media ${cond} { .x { color: red; } }`;"],
  "hole with nested template literals": ["const a = css`.x { color: ${cond ? `red` : `blue`}; }`;"],
  "hole with object literal braces": ["const a = css`.x { width: ${sizes({n: 1})}px; }`;"],
  "backslash at end of line before closing backtick": ["const a = css`.x { color: red; \\", "`;"],
};

for (const [name, lines] of Object.entries(pathological)) {
  test(`recovers after ${name}`, () => {
    const tokenized = tokenize([...lines, SENTINEL]);
    expectPlainTypeScript(tokenized.at(-1)!, "sentinel line");
  });
}

test("well-formed css gets full scss scoping", () => {
  const [line] = tokenize(["const a = css`.x { color: red; }`;"]);
  const color = line!.find((token) => token.text === "color");
  expect(color?.scopes.join(" ")).toContain("support.type.property-name");
  const red = line!.find((token) => token.text === "red");
  expect(red?.scopes.join(" ")).toContain("support.constant.color");
});

test("hole in a property value keeps css state across it", () => {
  const [line] = tokenize(["const a = css`.x { margin: ${m} 0 auto; }`;"]);
  const open = line!.find((token) => token.text === "${");
  // The string.template wrapper is what lets themes color the punctuation.
  expect(open?.scopes.join(" ")).toContain("string.template");
  expect(open?.scopes.join(" ")).toContain("punctuation.definition.template-expression.begin");
  const hole = line!.find((token) => token.text === "m");
  expect(hole?.scopes.join(" ")).toContain("meta.template.expression");
  const auto = line!.find((token) => token.text === "auto");
  expect(auto?.scopes.join(" ")).toContain("support.constant.property-value");
});

test("hole works inside a css string", () => {
  const [line] = tokenize(['const a = css`.x { content: "a${hx}b"; }`;']);
  const hole = line!.find((token) => token.text === "hx");
  expect(hole?.scopes.join(" ")).toContain("meta.template.expression");
  const after = line!.find((token) => token.text === "b");
  expect(after?.scopes.join(" ")).toContain("string.quoted.double");
});

test("escaped backtick stays inside the template", () => {
  const lines = tokenize(['const a = css`.x::before { content: "a\\`b"; }`;', SENTINEL]);
  const escape = lines[0]!.find((token) => token.text === "\\`");
  expect(escape?.scopes.join(" ")).toContain("constant.character.escape");
  const after = lines[0]!.find((token) => token.text === "b");
  expect(after?.scopes.join(" ")).toContain("string.quoted.double");
  expectPlainTypeScript(lines.at(-1)!, "sentinel line");
});

test("escaped dollar does not open a hole", () => {
  const [line] = tokenize(['const a = css`.x::after { content: "\\${literal}"; }`;']);
  for (const token of line!) {
    expect(token.scopes.join(" ")).not.toContain("meta.template.expression");
  }
});

test("escaped backslash pair ends the template at the following backtick", () => {
  const [line] = tokenize(['const a = css`.x { content: "a\\\\`; const inline = 1;']);
  const inline = line!.find((token) => token.text === "inline");
  expect(inline, "code after the real template end").toBeDefined();
  expect(inline!.scopes.filter(isCsslitScope)).toEqual([]);
});

// Broken host expressions retain TypeScript's native recovery behavior.
test("limitation: unterminated template inside a hole swallows what follows", () => {
  const lines = tokenize(["const a = css`.x { color: ${ `broken", SENTINEL]);
  const constToken = lines.at(-1)!.find((token) => token.text.includes("const"));
  expect(constToken?.scopes.join(" ")).toContain("string.template");
});

test("limitation: an unclosed hole keeps what follows in expression context", () => {
  const lines = tokenize(["const a = css`.x { color: ${ broken", SENTINEL]);
  const constToken = lines.at(-1)!.find((token) => token.text.includes("const"));
  expect(constToken?.scopes.join(" ")).toContain("meta.template.expression");
});

test("limitation: a nested css template inside a hole is not highlighted as css", () => {
  const lines = tokenize([
    "const a = css`.x { color: ${css`.y { color: red; }`}; }`; const inline = 1;",
    SENTINEL,
  ]);
  const red = lines[0]!.find((token) => token.text.includes("red"));
  expect(red?.scopes.join(" ")).toContain("string.template");
  expect(red?.scopes.join(" ")).not.toContain("support.constant.color");
  const inline = lines[0]!.find((token) => token.text === "inline");
  expect(inline?.scopes.filter(isCsslitScope)).toEqual([]);
  expectPlainTypeScript(lines.at(-1)!, "sentinel line");
});

test("every patched regex compiles in oniguruma", () => {
  const sources: string[] = [];
  for (const file of [grammarFiles["source.csslit.css"]!, grammarFiles["source.csslit.scss"]!]) {
    const collect = (rule: unknown): void => {
      if (!rule || typeof rule !== "object") return;
      for (const [key, value] of Object.entries(rule)) {
        if (typeof value === "string" && ["match", "begin", "end"].includes(key))
          sources.push(value);
        else collect(value);
      }
    };
    collect(JSON.parse(readFileSync(file, "utf8")));
  }
  expect(sources.length).toBeGreaterThan(300);
  for (const source of sources) {
    expect(() => new oniguruma.OnigScanner([source]), source).not.toThrow();
  }
});
