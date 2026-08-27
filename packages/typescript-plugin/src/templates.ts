import type ts from "typescript6/lib/tsserverlibrary";

type TypeScript = typeof ts;

export interface TemplateQuasiMetadata {
  template: number;
  quasi: number;
  quasis: number;
  global: boolean;
  cooked: string;
}

export function collectTemplateEdits(
  typescript: TypeScript,
  sourceFile: ts.SourceFile,
): ts.TextChange[] {
  const edits: ts.TextChange[] = [];
  let templateIndex = 0;
  const visit = (node: ts.Node) => {
    if (typescript.isTaggedTemplateExpression(node)) {
      let global: boolean | undefined;
      if (typescript.isIdentifier(node.tag) && node.tag.text === "css") {
        global = false;
      } else if (
        typescript.isPropertyAccessExpression(node.tag) &&
        typescript.isIdentifier(node.tag.expression) &&
        node.tag.expression.text === "css" &&
        node.tag.name.text === "global"
      ) {
        global = true;
      }
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
          push(...templateContentRange(sourceFile, template), template.text);
        } else {
          push(...templateContentRange(sourceFile, template.head), template.head.text);
          for (const span of template.templateSpans) {
            push(...templateContentRange(sourceFile, span.literal), span.literal.text);
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

function templateContentRange(
  sourceFile: ts.SourceFile,
  node: ts.TemplateLiteralLikeNode,
): [start: number, end: number] {
  const start = Math.min(node.getStart(sourceFile) + 1, node.end);
  return [start, start + node.rawText!.length];
}
