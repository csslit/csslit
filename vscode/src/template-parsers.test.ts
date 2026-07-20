import { expect, test } from "vite-plus/test";
import { buildVirtualCss } from "./virtual-css.ts";
import { parseModule as parseTsrxModule } from "./parsers/tsrx.ts";
import { parseModule as parseTypeScriptModule } from "./parsers/typescript6.ts";

test("framework-neutral TSRX parser locates templates", () => {
  const source = "const a = css`.x { color: ${theme}; }`;";
  const module = parseTsrxModule(source, "component.tsrx")!;
  expect(buildVirtualCss(module, source.indexOf("color"))?.content).toBe("*{.x { color: xx; }\n}");
});

test("TSRX parser locates global templates", () => {
  const source = "const a = css.global`.x { color: red; }`;";
  const module = parseTsrxModule(source, "component.tsrx")!;
  expect(buildVirtualCss(module, source.indexOf("color"))?.content).toBe(".x { color: red; }");
});

test("incomplete TSRX is an ordinary no-result parse", () => {
  const source = "const broken = ; const a = css`.x { color: red; }`;";
  expect(parseTsrxModule(source, "component.tsrx")).toBeUndefined();
});

test("TypeScript 6 locates templates without a language server", () => {
  const source = "const a = css`.x { color: ${theme}; }`;";
  const module = parseTypeScriptModule(source, "component.ts", "typescript");
  expect(buildVirtualCss(module, source.indexOf("color"))?.content).toBe("*{.x { color: xx; }\n}");
});

test("TypeScript 6 recovery still locates a later template", () => {
  const source = "function f<T extends U + css`first`>() {} const a = css`.x { color: red; }`;";
  const module = parseTypeScriptModule(source, "component.ts", "typescript");
  expect(buildVirtualCss(module, source.indexOf("red"))?.content).toBe("*{.x { color: red; }\n}");
});

test("parsers preserve empty quasis and cooked text", () => {
  const source = "const a = css`${a}${b}\\u2014`;";
  for (const module of [
    parseTypeScriptModule(source, "component.ts", "typescript"),
    parseTsrxModule(source, "component.tsrx")!,
  ]) {
    expect(
      module.templates[0]!.quasis.map(({ start, end, cooked }) => ({
        raw: module.source.slice(start, end),
        cooked,
      })),
    ).toEqual([
      { raw: "", cooked: "" },
      { raw: "", cooked: "" },
      { raw: "\\u2014", cooked: "—" },
    ]);
  }
});
