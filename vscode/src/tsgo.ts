import {
  isTaggedTemplateExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isNoSubstitutionTemplateLiteral,
  isTemplateExpression,
  SyntaxKind,
} from "typescript/unstable/ast";
import type { Node, SourceFile, TaggedTemplateExpression } from "typescript/unstable/ast";
import type { API } from "typescript/unstable/async";
import type { CssQuasi, CssTemplate, ParsedModule } from "./types.ts";

export class StaleSourceFileError extends Error {}

export async function parseModule(
  api: API<boolean>,
  uri: string,
  expectedSource: string,
): Promise<ParsedModule | undefined> {
  // updateSnapshot returns the server's change diff since the previous snapshot and evicts the
  // changed files from the client cache, so this reflects the server's current content.
  const opened = await api.updateSnapshot({ openFiles: [{ uri }] });
  try {
    const project = await opened.getDefaultProjectForFile({ uri });
    if (!project) return;

    let sourceFile = await project.program.getSourceFile({ uri });
    if (!sourceFile) return;

    if (sourceFile.text !== expectedSource)
      throw new StaleSourceFileError("tsgo and VS Code have different document contents");

    return { source: sourceFile.text, templates: collectTemplates(sourceFile) };
  } finally {
    const closed = await api.updateSnapshot({ closeFiles: [{ uri }] });
    await closed.dispose();
    await opened.dispose();
  }
}

function collectTemplates(sourceFile: SourceFile): CssTemplate[] {
  const templates: CssTemplate[] = [];
  const visit = (node: Node) => {
    if (isTaggedTemplateExpression(node)) {
      const global = cssTagKind(node);
      if (global !== undefined) templates.push(templateFromAst(sourceFile, node, global));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return templates;
}

function cssTagKind(node: TaggedTemplateExpression): boolean | undefined {
  if (isIdentifier(node.tag) && node.tag.text === "css") return false;
  if (
    isPropertyAccessExpression(node.tag) &&
    isIdentifier(node.tag.expression) &&
    node.tag.expression.text === "css" &&
    node.tag.name.text === "global"
  )
    return true;
  return undefined;
}

function templateFromAst(
  sourceFile: SourceFile,
  node: TaggedTemplateExpression,
  global: boolean,
): CssTemplate {
  const source = sourceFile.text;
  const template = node.template;
  const quasis: CssQuasi[] = [];
  const push = (start: number, end: number, cooked: string) => {
    quasis.push({ start, end, cooked });
  };
  if (isNoSubstitutionTemplateLiteral(template)) {
    const start = template.getStart(sourceFile) + 1;
    push(start, templateContentEnd(source, template.end), template.text);
  } else if (isTemplateExpression(template)) {
    push(template.head.getStart(sourceFile) + 1, template.head.end - 2, template.head.text);
    for (const span of template.templateSpans) {
      const start = span.literal.getStart(sourceFile) + 1;
      push(
        start,
        span.literal.kind === SyntaxKind.TemplateTail
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
