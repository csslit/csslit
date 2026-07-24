import type { CssQuasi, ParsedModule } from "./types.ts";

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
  cursor: {
    source: number;
    virtual: number;
    exact: boolean;
  };
  /**
   * The hole immediately before the requested position when only a possible
   * unit suffix lies between them. Completions replacing this synthetic range
   * can be rewritten to append the unit to the interpolation instead.
   */
  unitSuffix?: {
    virtualStart: number;
    virtualEnd: number;
    sourceStart: number;
  };
};

export function buildVirtualCss(
  module: ParsedModule,
  sourceOffset: number,
): VirtualCss | undefined {
  const { source } = module;
  const template = module.templates.find((candidate) =>
    containsOffset(candidate.quasis, sourceOffset),
  );
  if (!template) return;

  // Keep the synthetic closing brace off the final source line so a broken
  // line-bounded CSS token cannot swallow it.
  let content = template.global ? "" : "*{";
  const mappings: number[] = [];
  let virtualOffset = 0;
  let cursorExact = false;
  let unitSuffix: VirtualCss["unitSuffix"];

  let holeStart = template.quasis[0]!.start;
  for (const quasi of template.quasis) {
    const raw = source.slice(quasi.start, quasi.end);
    const isAttachedHole =
      holeStart < quasi.start &&
      sourceOffset >= quasi.start &&
      sourceOffset <= quasi.end &&
      isCssUnitSuffix(source, quasi.start, sourceOffset);
    const virtualHoleStart = content.length;
    content += holePlaceholder(source, holeStart, quasi.start, content);
    if (isAttachedHole) {
      unitSuffix = {
        virtualStart: virtualHoleStart,
        virtualEnd: content.length,
        sourceStart: quasi.start,
      };
    }
    if (quasi.start === quasi.end && sourceOffset === quasi.start) {
      virtualOffset = content.length;
      cursorExact = true;
    }
    let rawIndex = 0;
    let cookedIndex = 0;
    while (rawIndex < raw.length) {
      let boundary = rawIndex;
      let lengths: [number, number] | undefined;
      while (boundary < raw.length && !(lengths = differenceLengths(raw, boundary))) boundary++;
      const runSourceStart = quasi.start + rawIndex;
      const runSourceEnd = quasi.start + boundary;
      if (sourceOffset >= runSourceStart && sourceOffset <= runSourceEnd) {
        virtualOffset = content.length + sourceOffset - runSourceStart;
        cursorExact = true;
      }
      if (runSourceStart < runSourceEnd) {
        mappings.push(content.length, runSourceStart, runSourceEnd - runSourceStart);
      }
      content += raw.slice(rawIndex, boundary);
      cookedIndex += boundary - rawIndex;
      rawIndex = boundary;
      if (!lengths) break;
      const [rawLength, cookedLength] = lengths;
      const sourceIndex = quasi.start + rawIndex;
      if (sourceOffset >= sourceIndex && sourceOffset <= sourceIndex + rawLength) {
        virtualOffset =
          sourceOffset === sourceIndex ? content.length : content.length + cookedLength;
        cursorExact = sourceOffset === sourceIndex || sourceOffset === sourceIndex + rawLength;
      }
      content += quasi.cooked.slice(cookedIndex, cookedIndex + cookedLength);
      cookedIndex += cookedLength;
      rawIndex += rawLength;
    }
    holeStart = quasi.end;
  }
  if (!template.global) content += "\n}";
  return {
    content,
    templateStart: template.quasis[0]!.start,
    mappings,
    cursor: { source: sourceOffset, virtual: virtualOffset, exact: cursorExact },
    unitSuffix,
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

function containsOffset(quasis: readonly CssQuasi[], offset: number) {
  return quasis.some((quasi) => offset >= quasi.start && offset <= quasi.end);
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
