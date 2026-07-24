import type ts from "typescript6/lib/tsserverlibrary";

type TypeScript = typeof ts;

// Encoded into each edit's newText so the extension can reassemble the templates after the
// framework proxy has remapped the edit ranges. Keep in sync with tsgo.ts, which builds the same
// template shape directly from the TypeScript 7 AST.
export interface TemplateQuasiMetadata {
  template: number;
  quasi: number;
  quasis: number;
  global: boolean;
  cooked: string;
}

export function hasCssTemplate(typescript: TypeScript, sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (typescript.isTaggedTemplateExpression(node) && cssTagKind(typescript, node) !== undefined) {
      found = true;
      return;
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function collectTemplateEdits(
  typescript: TypeScript,
  sourceFile: ts.SourceFile,
): ts.TextChange[] {
  const edits: ts.TextChange[] = [];
  let templateIndex = 0;
  const visit = (node: ts.Node) => {
    if (typescript.isTaggedTemplateExpression(node)) {
      const global = cssTagKind(typescript, node);
      if (global !== undefined) {
        const template = node.template;
        const quasiCount = typescript.isNoSubstitutionTemplateLiteral(template)
          ? 1
          : template.templateSpans.length + 1;
        let quasiIndex = 0;
        const push = (start: number, end: number, cooked: string) => {
          edits.push({
            span: { start, length: end - start },
            newText: JSON.stringify({
              template: templateIndex,
              quasi: quasiIndex++,
              quasis: quasiCount,
              global,
              cooked,
            } satisfies TemplateQuasiMetadata),
          });
        };
        if (typescript.isNoSubstitutionTemplateLiteral(template)) {
          push(
            template.getStart(sourceFile) + 1,
            templateContentEnd(sourceFile, template.end),
            template.text,
          );
        } else {
          push(template.head.getStart(sourceFile) + 1, template.head.end - 2, template.head.text);
          for (const span of template.templateSpans) {
            push(
              span.literal.getStart(sourceFile) + 1,
              typescript.isTemplateTail(span.literal)
                ? templateContentEnd(sourceFile, span.literal.end)
                : span.literal.end - 2,
              span.literal.text,
            );
          }
        }
        templateIndex++;
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edits;
}

function cssTagKind(
  typescript: TypeScript,
  node: ts.TaggedTemplateExpression,
): boolean | undefined {
  if (typescript.isIdentifier(node.tag) && node.tag.text === "css") return false;
  if (
    typescript.isPropertyAccessExpression(node.tag) &&
    typescript.isIdentifier(node.tag.expression) &&
    node.tag.expression.text === "css" &&
    node.tag.name.text === "global"
  )
    return true;
  return undefined;
}

function templateContentEnd(sourceFile: ts.SourceFile, end: number): number {
  const source = sourceFile.text;
  if (source.charCodeAt(end - 1) !== 96) return end;
  let backslashes = 0;
  while (source.charCodeAt(end - 2 - backslashes) === 92) backslashes++;
  return backslashes % 2 === 0 ? end - 1 : end;
}
