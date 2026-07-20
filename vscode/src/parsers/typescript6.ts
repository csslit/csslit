import ts from "typescript6";
import type { CssQuasi, CssTemplate, ParsedModule } from "./types.ts";

let cachedSource: string | undefined;
let cachedFilename: string | undefined;
let cachedLanguage: string | undefined;
let cachedModule: ParsedModule | undefined;

export function parseModule(source: string, filename: string, language: string): ParsedModule {
  if (source === cachedSource && filename === cachedFilename && language === cachedLanguage) {
    return cachedModule!;
  }

  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    language.endsWith("react")
      ? ts.ScriptKind.TSX
      : language === "javascript"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  const templates: CssTemplate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const global = cssTagKind(node);
      if (global !== undefined) templates.push(templateFromAst(sourceFile, node, global));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  cachedSource = source;
  cachedFilename = filename;
  cachedLanguage = language;
  return (cachedModule = { source, templates });
}

function cssTagKind(node: ts.TaggedTemplateExpression): boolean | undefined {
  if (ts.isIdentifier(node.tag) && node.tag.text === "css") return false;
  if (
    ts.isPropertyAccessExpression(node.tag) &&
    ts.isIdentifier(node.tag.expression) &&
    node.tag.expression.text === "css" &&
    node.tag.name.text === "global"
  )
    return true;
  return undefined;
}

function templateFromAst(
  sourceFile: ts.SourceFile,
  node: ts.TaggedTemplateExpression,
  global: boolean,
): CssTemplate {
  const source = sourceFile.text;
  const template = node.template;
  const quasis: CssQuasi[] = [];
  const push = (start: number, end: number, cooked: string) => {
    quasis.push({ start, end, cooked });
  };

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    const start = template.getStart(sourceFile) + 1;
    push(start, templateContentEnd(source, template.end), template.text);
  } else if (ts.isTemplateExpression(template)) {
    push(template.head.getStart(sourceFile) + 1, template.head.end - 2, template.head.text);
    for (const span of template.templateSpans) {
      const start = span.literal.getStart(sourceFile) + 1;
      push(
        start,
        ts.isTemplateTail(span.literal)
          ? templateContentEnd(source, span.literal.end)
          : span.literal.end - 2,
        span.literal.text,
      );
    }
  } else {
    throw new Error("Unexpected template node");
  }
  return { global, quasis };
}

function templateContentEnd(source: string, end: number): number {
  if (source.charCodeAt(end - 1) !== 96) return end;
  let backslashes = 0;
  while (source.charCodeAt(end - 2 - backslashes) === 92) backslashes++;
  return backslashes % 2 === 0 ? end - 1 : end;
}
