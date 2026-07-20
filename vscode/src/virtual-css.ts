import type { Node, SourceFile, TaggedTemplateExpression } from "typescript/unstable/ast";
import type { API } from "typescript/unstable/async";

type AstModule = typeof import("typescript/unstable/ast");
export type TypeScriptModules = {
  async: typeof import("typescript/unstable/async");
  ast: AstModule;
};

export type VirtualCss = {
  content: string;
  templateStart: number;
  /**
   * Flat [virtualStart, sourceStart, length] triples of the runs copied
   * verbatim from the source, in document order. Everything between the runs
   * — the wrapper, hole placeholders, the cooked characters of escape
   * sequences — exists only in the virtual document.
   */
  mappings: number[];
  offset: number;
  offsetExact: boolean;
  /**
   * The hole immediately before the requested position when only a possible
   * unit suffix lies between them. Completions replacing this synthetic range
   * can be rewritten to append the unit to the interpolation instead.
   */
  attachedHole?: {
    virtualStart: number;
    virtualEnd: number;
    sourceEnd: number;
  };
};

export class StaleSourceFileError extends Error {}

type CssPiece = {
  from: number;
  to: number;
  cooked: string;
};

type CssTemplate = {
  global: boolean;
  contentStart: number;
  pieces: CssPiece[];
};

export async function loadTypeScript(): Promise<TypeScriptModules> {
  const [async, ast] = await Promise.all([
    import("typescript/unstable/async"),
    import("typescript/unstable/ast"),
  ]);
  return { async, ast };
}

export async function getVirtualCss(
  ts: TypeScriptModules,
  api: API<boolean>,
  uri: string,
  offset: number,
  expectedSource?: string,
  refresh = false,
): Promise<VirtualCss | undefined> {
  const opened = await api.updateSnapshot({ openFiles: [{ uri }] });
  if (refresh) api.clearSourceFileCache();
  let sourceFile: SourceFile | undefined;
  try {
    const project = await opened.getDefaultProjectForFile({ uri });
    sourceFile = await project?.program.getSourceFile({ uri });
  } finally {
    const closed = await api.updateSnapshot({ closeFiles: [{ uri }] });
    await closed.dispose();
    await opened.dispose();
  }
  if (!sourceFile) return;
  if (expectedSource !== undefined && sourceFile.text !== expectedSource) {
    throw new StaleSourceFileError("tsgo and VS Code have different document contents");
  }

  const templates = collectTemplates(ts.ast, sourceFile);
  const template = templates.find((candidate) => containsOffset(candidate.pieces, offset));
  if (!template) return;
  const source = sourceFile.text;

  // Keep the synthetic closing brace off the final source line so a broken
  // line-bounded CSS token cannot swallow it.
  let content = template.global ? "" : "*{";
  const mappings: number[] = [];
  let virtualOffset = 0;
  let offsetExact = false;
  let attachedHole: VirtualCss["attachedHole"];

  const pushCss = (from: number, to: number) => {
    if (offset >= from && offset <= to) {
      virtualOffset = content.length + offset - from;
      offsetExact = true;
    }
    if (from < to) mappings.push(content.length, from, to - from);
    content += source.slice(from, to);
  };

  let cursor = template.contentStart;
  for (const piece of template.pieces) {
    const isAttachedHole =
      cursor < piece.from &&
      offset >= piece.from &&
      offset <= piece.to &&
      isCssUnitSuffix(source, piece.from, offset);
    const holeStart = content.length;
    content += holePlaceholder(source, cursor, piece.from, content);
    const holeEnd = content.length;
    if (isAttachedHole) {
      attachedHole = { virtualStart: holeStart, virtualEnd: holeEnd, sourceEnd: piece.from };
    }
    if (piece.from === piece.to && offset === piece.from) {
      virtualOffset = content.length;
      offsetExact = true;
    }
    let rawIndex = piece.from;
    let cookedIndex = 0;
    while (rawIndex < piece.to) {
      let boundary = rawIndex;
      let lengths: [number, number] | undefined;
      while (boundary < piece.to && !(lengths = differenceLengths(source, boundary))) boundary++;
      pushCss(rawIndex, boundary);
      cookedIndex += boundary - rawIndex;
      rawIndex = boundary;
      if (!lengths) break;
      const [rawLength, cookedLength] = lengths;
      if (offset >= rawIndex && offset <= rawIndex + rawLength) {
        virtualOffset = offset === rawIndex ? content.length : content.length + cookedLength;
        offsetExact = offset === rawIndex || offset === rawIndex + rawLength;
      }
      content += piece.cooked.slice(cookedIndex, cookedIndex + cookedLength);
      cookedIndex += cookedLength;
      rawIndex += rawLength;
    }
    cursor = piece.to;
  }
  if (!template.global) content += "\n}";
  return {
    content,
    templateStart: template.contentStart,
    mappings,
    offset: virtualOffset,
    offsetExact,
    attachedHole,
  };
}

// Editable ranges must stay inside one verbatim run; seams around synthetic text are ambiguous.
export function toSourceRange(
  mappings: readonly number[],
  virtualStart: number,
  virtualEnd: number,
): [start: number, end: number] | undefined {
  let point = -1;
  for (let index = 0; index < mappings.length; index += 3) {
    const runStart = mappings[index]!;
    const sourceStart = mappings[index + 1]!;
    const length = mappings[index + 2]!;
    const runEnd = runStart + length;

    if (virtualStart !== virtualEnd) {
      if (virtualStart >= runStart && virtualEnd <= runEnd) {
        return [sourceStart + virtualStart - runStart, sourceStart + virtualEnd - runStart];
      }
      continue;
    }

    if (virtualStart < runStart || virtualStart > runEnd) continue;
    const sourcePoint = sourceStart + virtualStart - runStart;
    if (point !== -1 && point !== sourcePoint) return undefined;
    point = sourcePoint;
  }
  return point === -1 ? undefined : [point, point];
}

function collectTemplates(ast: AstModule, sourceFile: SourceFile): CssTemplate[] {
  const templates: CssTemplate[] = [];
  const visit = (node: Node) => {
    if (ast.isTaggedTemplateExpression(node)) {
      const global = cssTagKind(ast, node);
      if (global !== undefined) templates.push(templateFromAst(ast, sourceFile, node, global));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return templates;
}

function cssTagKind(ast: AstModule, node: TaggedTemplateExpression): boolean | undefined {
  if (ast.isIdentifier(node.tag) && node.tag.text === "css") return false;
  if (
    ast.isPropertyAccessExpression(node.tag) &&
    ast.isIdentifier(node.tag.expression) &&
    node.tag.expression.text === "css" &&
    node.tag.name.text === "global"
  ) {
    return true;
  }
  return undefined;
}

function templateFromAst(
  ast: AstModule,
  sourceFile: SourceFile,
  node: TaggedTemplateExpression,
  global: boolean,
): CssTemplate {
  const source = sourceFile.text;
  const template = node.template;
  const pieces: CssPiece[] = [];
  const pushPiece = (start: number, end: number, literal: { text: string }) => {
    pieces.push({ from: start, to: end, cooked: literal.text });
  };

  let contentStart;
  if (ast.isNoSubstitutionTemplateLiteral(template)) {
    contentStart = template.getStart(sourceFile) + 1;
    pushPiece(contentStart, templateContentEnd(source, template.end), template);
  } else if (ast.isTemplateExpression(template)) {
    contentStart = template.head.getStart(sourceFile) + 1;
    pushPiece(contentStart, template.head.end - 2, template.head); // head ends after ${
    for (const span of template.templateSpans) {
      const start = span.literal.getStart(sourceFile) + 1;
      if (span.literal.kind === ast.SyntaxKind.TemplateTail) {
        pushPiece(start, templateContentEnd(source, span.literal.end), span.literal);
      } else {
        pushPiece(start, span.literal.end - 2, span.literal);
      }
    }
  } else {
    throw new Error("Unexpected template node");
  }

  return { global, contentStart, pieces };
}

// Error recovery may end a template at EOF with an escaped backtick as its content.
function templateContentEnd(source: string, end: number): number {
  if (source.charCodeAt(end - 1) !== 96) return end;
  let backslashes = 0;
  while (source.charCodeAt(end - 2 - backslashes) === 92) backslashes++;
  return backslashes % 2 === 0 ? end - 1 : end;
}

function containsOffset(pieces: readonly CssPiece[], offset: number) {
  return pieces.some((piece) => offset >= piece.from && offset <= piece.to);
}

// Only classify the shape of an escape; the cooked characters come from the parser.
function differenceLengths(
  source: string,
  index: number,
): [raw: number, cooked: number] | undefined {
  const code = source.charCodeAt(index);
  if (code === 13) return [source.charCodeAt(index + 1) === 10 ? 2 : 1, 1];
  if (code !== 92) return undefined;
  const next = source.charCodeAt(index + 1);
  if (next === 13) return [source.charCodeAt(index + 2) === 10 ? 3 : 2, 0]; // line continuation
  if (next === 10 || next === 0x2028 || next === 0x2029) return [2, 0]; // line continuation
  if (next === 48) return isDigit(source.charCodeAt(index + 2)) ? undefined : [2, 1]; // \0
  if (isDigit(next)) return undefined; // octal, \8 and \9 escapes are invalid in templates
  if (next === 120) {
    return isHexDigit(source.charCodeAt(index + 2)) && isHexDigit(source.charCodeAt(index + 3))
      ? [4, 1] // \xhh
      : undefined;
  }
  if (next === 117) {
    if (source.charCodeAt(index + 2) !== 123) {
      for (let hex = index + 2; hex < index + 6; hex++) {
        if (!isHexDigit(source.charCodeAt(hex))) return undefined;
      }
      return [6, 1]; // \uhhhh
    }
    let close = index + 3;
    while (isHexDigit(source.charCodeAt(close))) close++;
    if (close === index + 3 || source.charCodeAt(close) !== 125) return undefined;
    const codePoint = Number.parseInt(source.slice(index + 3, close), 16);
    return codePoint > 0x10ffff ? undefined : [close + 1 - index, codePoint > 0xffff ? 2 : 1];
  }
  if (Number.isNaN(next)) return undefined; // backslash at end of file
  return source.codePointAt(index + 1)! > 0xffff ? [3, 2] : [2, 1];
}

function isDigit(code: number) {
  return code >= 48 && code <= 57;
}

function isHexDigit(code: number) {
  return isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

// Standalone holes become identifiers. Holes attached to words or units stay empty so
// the real suffix remains a completion prefix, and block-boundary fragments stay empty
// so a placeholder cannot merge with the following declaration.
function holePlaceholder(source: string, start: number, end: number, content: string): string {
  if (start >= end) return "";
  if (
    isCssWordCharacter(source.charCodeAt(start - 1)) ||
    isCssWordCharacter(source.charCodeAt(end)) ||
    source.charCodeAt(end) === 37
  ) {
    return "";
  }

  let before = content.length - 1;
  while (isCssWhitespace(content.charCodeAt(before))) before--;
  let after = end;
  while (isCssWhitespace(source.charCodeAt(after))) after++;
  const beforeCode = content.charCodeAt(before);
  if (
    (Number.isNaN(beforeCode) || beforeCode === 59 || beforeCode === 123 || beforeCode === 125) &&
    source.charCodeAt(after) !== 123
  ) {
    return "";
  }
  return "xx";
}

function isCssUnitSuffix(source: string, start: number, end: number) {
  for (let index = start; index < end; index++) {
    const code = source.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 37)) {
      return false;
    }
  }
  return true;
}

function isCssWhitespace(code: number) {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function isCssWordCharacter(code: number) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95
  );
}
