import {
  isTaggedTemplateExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isNoSubstitutionTemplateLiteral,
  isTemplateExpression,
} from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import type { API } from "typescript/unstable/async";
import type { CssQuasi, CssTemplate, ParsedModule } from "./types.ts";

export class StaleSourceFileError extends Error {}

export async function parseModule(
  api: API<boolean>,
  uri: string,
  expectedSource: string,
): Promise<ParsedModule | undefined> {
  const opened = await api.updateSnapshot({ openFiles: [{ uri }] });
  try {
    const project = await opened.getDefaultProjectForFile({ uri });
    if (!project) return;

    let sourceFile = await project.program.getSourceFile({ uri });
    if (!sourceFile) return;

    if (sourceFile.text !== expectedSource) throw new StaleSourceFileError();

    const templates: CssTemplate[] = [];
    const visit = (node: Node) => {
      if (isTaggedTemplateExpression(node)) {
        let global: boolean | undefined;
        if (isIdentifier(node.tag) && node.tag.text === "css") {
          global = false;
        } else if (
          isPropertyAccessExpression(node.tag) &&
          isIdentifier(node.tag.expression) &&
          node.tag.expression.text === "css" &&
          node.tag.name.text === "global"
        ) {
          global = true;
        }
        if (global !== undefined) {
          const template = node.template;
          const quasis: CssQuasi[] = [];
          if (isNoSubstitutionTemplateLiteral(template)) {
            const [start, end] = templateContentRange(sourceFile, template);
            quasis.push({ start, end, cooked: template.text });
          } else if (isTemplateExpression(template)) {
            const [start, end] = templateContentRange(sourceFile, template.head);
            quasis.push({ start, end, cooked: template.head.text });
            for (const span of template.templateSpans) {
              const [start, end] = templateContentRange(sourceFile, span.literal);
              quasis.push({ start, end, cooked: span.literal.text });
            }
          } else {
            throw new Error("Unexpected template node");
          }
          templates.push({ global, quasis });
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    return { source: sourceFile.text, templates };
  } finally {
    const closed = await api.updateSnapshot({ closeFiles: [{ uri }] });
    await closed.dispose();
    await opened.dispose();
  }
}

function templateContentRange(
  sourceFile: SourceFile,
  node: { getStart(sourceFile: SourceFile): number; end: number },
): [start: number, end: number] {
  const source = sourceFile.text;
  const start = Math.min(node.getStart(sourceFile) + 1, node.end);
  if (
    node.end - start >= 2 &&
    source.slice(node.end - 2, node.end) === "${" &&
    !isEscaped(source, node.end - 2, start)
  ) {
    return [start, node.end - 2];
  }
  if (
    node.end > start &&
    source.charCodeAt(node.end - 1) === 96 &&
    !isEscaped(source, node.end - 1, start)
  ) {
    return [start, node.end - 1];
  }
  return [start, node.end];
}

function isEscaped(source: string, position: number, start: number): boolean {
  let backslashes = 0;
  while (position - backslashes > start && source.charCodeAt(position - backslashes - 1) === 92) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}
