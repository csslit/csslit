type SourceLocation = {
  source: string;
  line: number;
  column: number;
  content: string | null;
};

type CssBlock = {
  quasis?: (SourceLocation | null)[] | null;
  expressions?: (SourceLocation | null)[] | null;
};

type MappingSegment = {
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
};

type MappingState = {
  code: string;
  file: string;
  generatedLine: number;
  generatedColumn: number;
  lines: MappingSegment[][];
  sources: string[];
  sourcesContent: (string | null)[];
  sourceIndexByKey: Map<string, number>;
};

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function normalizeNewlines(text: string) {
  return String(text).replace(/\r\n?/g, "\n");
}

function cloneLoc(loc: SourceLocation | null | undefined): SourceLocation | null {
  return loc
    ? {
        source: loc.source,
        line: loc.line,
        column: loc.column,
        content: loc.content ?? null,
      }
    : null;
}

function advanceLoc(loc: SourceLocation | null, rawText: string) {
  if (!loc) return null;

  let line = loc.line;
  let column = loc.column;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText.charCodeAt(index);
    if (char === 13) {
      if (rawText.charCodeAt(index + 1) === 10) index += 1;
      line += 1;
      column = 0;
      continue;
    }

    if (char === 10) {
      line += 1;
      column = 0;
      continue;
    }

    column += 1;
  }

  return {
    source: loc.source,
    line,
    column,
    content: loc.content ?? null,
  };
}

function decodeEscape(raw: string, index: number) {
  const next = raw[index + 1];
  if (next == null) {
    return { cooked: "", rawLength: 1 };
  }

  if (next === "\r") {
    return {
      cooked: "",
      rawLength: raw[index + 2] === "\n" ? 3 : 2,
    };
  }

  if (next === "\n") {
    return { cooked: "", rawLength: 2 };
  }

  switch (next) {
    case "0":
      return { cooked: "\0", rawLength: 2 };
    case "b":
      return { cooked: "\b", rawLength: 2 };
    case "f":
      return { cooked: "\f", rawLength: 2 };
    case "n":
      return { cooked: "\n", rawLength: 2 };
    case "r":
      return { cooked: "\r", rawLength: 2 };
    case "t":
      return { cooked: "\t", rawLength: 2 };
    case "v":
      return { cooked: "\v", rawLength: 2 };
    case "\\":
    case "'":
    case '"':
    case "`":
    case "$":
      return { cooked: next, rawLength: 2 };
    case "x": {
      const hex = raw.slice(index + 2, index + 4);
      const value = Number.parseInt(hex, 16);
      return {
        cooked: Number.isNaN(value) ? raw.slice(index, index + 4) : String.fromCharCode(value),
        rawLength: 4,
      };
    }
    case "u": {
      if (raw[index + 2] === "{") {
        const closeIndex = raw.indexOf("}", index + 3);
        if (closeIndex !== -1) {
          const codePoint = Number.parseInt(raw.slice(index + 3, closeIndex), 16);
          return {
            cooked: Number.isNaN(codePoint) ? "" : String.fromCodePoint(codePoint),
            rawLength: closeIndex - index + 1,
          };
        }
      }

      const hex = raw.slice(index + 2, index + 6);
      const value = Number.parseInt(hex, 16);
      return {
        cooked: Number.isNaN(value) ? raw.slice(index, index + 6) : String.fromCharCode(value),
        rawLength: 6,
      };
    }
    default:
      return { cooked: next, rawLength: 2 };
  }
}

function collectStaticLineStarts(loc: SourceLocation | null, rawText: string) {
  if (!loc) return [];

  const starts = [cloneLoc(loc)];
  let current = cloneLoc(loc);
  let index = 0;

  while (index < rawText.length) {
    let rawLength = 1;
    let cookedChunk = rawText[index];

    if (rawText[index] === "\\") {
      const decoded = decodeEscape(rawText, index);
      rawLength = decoded.rawLength;
      cookedChunk = decoded.cooked;
    } else if (rawText[index] === "\r") {
      rawLength = rawText[index + 1] === "\n" ? 2 : 1;
      cookedChunk = "\n";
    }

    cookedChunk = normalizeNewlines(cookedChunk);
    current = advanceLoc(current, rawText.slice(index, index + rawLength));

    for (let cookedIndex = 0; cookedIndex < cookedChunk.length; cookedIndex += 1) {
      if (cookedChunk.charCodeAt(cookedIndex) === 10) {
        starts.push(cloneLoc(current));
      }
    }

    index += rawLength;
  }

  return starts;
}

function collectDynamicLineStarts(loc: SourceLocation | null, text: string) {
  if (!loc) return [];
  const lineCount = text === "" ? 1 : text.split("\n").length;
  return Array.from({ length: lineCount }, () => cloneLoc(loc));
}

function createState(file: string): MappingState {
  return {
    code: "",
    file,
    generatedLine: 0,
    generatedColumn: 0,
    lines: [[]],
    sources: [],
    sourcesContent: [],
    sourceIndexByKey: new Map(),
  };
}

function ensureLine(state: MappingState, line: number) {
  while (state.lines.length <= line) {
    state.lines.push([]);
  }
}

function ensureSource(state: MappingState, loc: SourceLocation) {
  const key = loc.source;
  const existingIndex = state.sourceIndexByKey.get(key);
  if (existingIndex != null) {
    if (state.sourcesContent[existingIndex] == null && loc.content != null) {
      state.sourcesContent[existingIndex] = loc.content;
    }
    return existingIndex;
  }

  const index = state.sources.length;
  state.sourceIndexByKey.set(key, index);
  state.sources.push(key);
  state.sourcesContent.push(loc.content ?? null);
  return index;
}

function addSegment(
  state: MappingState,
  line: number,
  column: number,
  loc: SourceLocation | null | undefined,
) {
  if (!loc?.source) return;

  ensureLine(state, line);
  const sourceIndex = ensureSource(state, loc);
  const segments = state.lines[line];
  const lastSegment = segments[segments.length - 1];
  const nextSegment = {
    generatedColumn: column,
    sourceIndex,
    originalLine: loc.line,
    originalColumn: loc.column,
  };

  if (lastSegment?.generatedColumn === column) {
    segments[segments.length - 1] = nextSegment;
    return;
  }

  segments.push(nextSegment);
}

function appendText(state: MappingState, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    state.code += char;
    if (char === "\n") {
      state.generatedLine += 1;
      state.generatedColumn = 0;
      ensureLine(state, state.generatedLine);
    } else {
      state.generatedColumn += 1;
    }
  }
}

function appendMappedText(
  state: MappingState,
  text: string,
  lineStarts: (SourceLocation | null)[],
  fallbackLoc: SourceLocation | null,
) {
  if (text.length === 0) return;

  let lineStartIndex = 0;
  addSegment(
    state,
    state.generatedLine,
    state.generatedColumn,
    lineStarts[lineStartIndex] ?? fallbackLoc ?? null,
  );

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    state.code += char;
    if (char === "\n") {
      state.generatedLine += 1;
      state.generatedColumn = 0;
      ensureLine(state, state.generatedLine);
      lineStartIndex += 1;
      addSegment(
        state,
        state.generatedLine,
        state.generatedColumn,
        lineStarts[lineStartIndex] ?? fallbackLoc ?? null,
      );
    } else {
      state.generatedColumn += 1;
    }
  }
}

function encodeVlq(value: number) {
  let encoded = "";
  let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;

  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    encoded += BASE64_CHARS[digit];
  } while (vlq > 0);

  return encoded;
}

function finalizeMap(state: MappingState) {
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;

  const mappings = state.lines
    .map((segments) => {
      let previousGeneratedColumn = 0;

      return segments
        .map((segment) => {
          const encoded =
            encodeVlq(segment.generatedColumn - previousGeneratedColumn) +
            encodeVlq(segment.sourceIndex - previousSource) +
            encodeVlq(segment.originalLine - 1 - previousOriginalLine) +
            encodeVlq(segment.originalColumn - previousOriginalColumn);

          previousGeneratedColumn = segment.generatedColumn;
          previousSource = segment.sourceIndex;
          previousOriginalLine = segment.originalLine - 1;
          previousOriginalColumn = segment.originalColumn;
          return encoded;
        })
        .join(",");
    })
    .join(";");

  return {
    version: 3 as const,
    file: state.file,
    mappings,
    names: [],
    sources: state.sources,
    sourcesContent: state.sourcesContent,
  };
}

export function createCsslitExtractRuntime(blocks: (CssBlock | null)[]) {
  return (id: number) => (strings: TemplateStringsArray, ...values: unknown[]) => {
    const block = blocks[id];
    const file = `virtual:css-compile/${id}.module.css`;
    const state = createState(file);
    const startLoc = block?.quasis?.[0] ?? block?.expressions?.[0] ?? null;

    addSegment(state, 0, 0, startLoc);
    appendText(state, `.css-${id} {\n`);

    for (let index = 0; index < strings.length; index += 1) {
      const cooked = normalizeNewlines(strings[index] ?? "");
      const raw = normalizeNewlines(strings.raw[index] ?? "");
      const quasiLoc = block?.quasis?.[index] ?? null;
      appendMappedText(state, cooked, collectStaticLineStarts(quasiLoc, raw), quasiLoc);

      if (index < values.length) {
        const expressionLoc = block?.expressions?.[index] ?? null;
        const expressionText = normalizeNewlines(String(values[index]));
        appendMappedText(
          state,
          expressionText,
          collectDynamicLineStarts(expressionLoc, expressionText),
          expressionLoc,
        );
      }
    }

    appendText(state, "\n}");
    return { css: state.code, map: finalizeMap(state) };
  };
}
