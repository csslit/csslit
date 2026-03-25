import { transform as rustTransform } from "@csslit/rust-transformer";
import {
  GenMapping,
  maybeAddMapping,
  setSourceContent,
  toEncodedMap,
} from "@jridgewell/gen-mapping";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor, type EncodedSourceMap } from "@jridgewell/trace-mapping";
import type { ExistingRawSourceMap, SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";
import { type Plugin, type ViteDevServer, normalizePath } from "vite-plus";

const VIRTUAL_CSS_ID_PREFIX = "virtual:css-compile/";
const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_RUNTIME_PATH = path.join(DIST_DIR, "extract-runtime.js");

let extractRuntimeSourceCache: string | null = null;

type OffsetSpan = {
  start: number;
  end: number;
};

type CssBlockMetadata = {
  index: number;
  quasis: OffsetSpan[];
  expressions: OffsetSpan[];
};

type SourceLocation = {
  source: string;
  line: number;
  column: number;
  content: string | null;
};

type RemappedCssBlock = {
  index: number;
  quasis: SourceLocation[];
  expressions: SourceLocation[];
};

type ExtractedCssResult = {
  block: RemappedCssBlock | null;
  strings: TemplateStringsArray;
  values: unknown[];
};

function isWithinRoot(id: string, root: string) {
  return id === root || id.startsWith(`${root}/`);
}

function toBrowserSourcePath(source: string, root: string) {
  const normalizedSource = normalizePath(source);
  if (!path.isAbsolute(normalizedSource)) return normalizedSource;
  if (!isWithinRoot(normalizedSource, root)) return normalizedSource;
  return `/${normalizePath(path.relative(root, normalizedSource))}`;
}

function encodeSourceId(id: string) {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodeSourceId(id: string) {
  return Buffer.from(id, "base64url").toString("utf8");
}

function rewriteRuntimeVirtualIds(code: string, sourceId: string) {
  const encodedSourceId = encodeSourceId(sourceId);
  return code.replace(
    /virtual:css-compile\/(\d+)\.module\.css\?source=[^"]+/g,
    (_match, index) => `virtual:css-compile/${index}.module.css?sourceId=${encodedSourceId}`,
  );
}

function createLineStarts(code: string) {
  const lineStarts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      lineStarts.push(index + 1);
    }
  }
  return lineStarts;
}

function offsetToPosition(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lineStarts[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const lineIndex = Math.max(high, 0);
  return {
    line: lineIndex + 1,
    column: offset - lineStarts[lineIndex],
  };
}

function toRawSourceMap(map: SourceMapInput | null | undefined): ExistingRawSourceMap | null {
  if (!map || typeof map === "string") return null;
  return map;
}

function shiftSourcemap(map: SourceMapInput | null, prefix: string): SourceMapInput | null {
  const rawMap = toRawSourceMap(map);
  if (!rawMap) return map;
  const prefixLines = prefix.match(/\n/g)?.length ?? 0;
  if (prefixLines === 0) return rawMap;
  return {
    ...rawMap,
    mappings: `${";".repeat(prefixLines)}${rawMap.mappings}`,
  };
}

function resolveOriginalSource(
  source: string,
  cleanId: string,
  root: string,
  content: string | null,
): SourceLocation {
  const [cleanSource] = source.split("?");

  if (cleanSource.startsWith("/")) {
    return {
      source: cleanSource,
      line: 1,
      column: 0,
      content,
    };
  }

  const normalizedSource = normalizePath(cleanSource);
  const resolvedSource = path.isAbsolute(normalizedSource)
    ? normalizedSource
    : normalizePath(path.resolve(path.dirname(cleanId), normalizedSource));

  return {
    source: toBrowserSourcePath(resolvedSource, root),
    line: 1,
    column: 0,
    content,
  };
}

function createRemapper(
  code: string,
  cleanId: string,
  root: string,
  combinedMap: SourceMapInput | null,
) {
  const lineStarts = createLineStarts(code);
  const rawMap = toRawSourceMap(combinedMap);

  if (!rawMap?.mappings) {
    return (span: OffsetSpan): SourceLocation => {
      const position = offsetToPosition(lineStarts, span.start);
      return {
        source: toBrowserSourcePath(cleanId, root),
        line: position.line,
        column: position.column,
        content: code,
      };
    };
  }

  const traceMap = new TraceMap(rawMap as EncodedSourceMap);
  return (span: OffsetSpan): SourceLocation => {
    const position = offsetToPosition(lineStarts, span.start);
    const original = originalPositionFor(traceMap, position);

    if (!original.source || original.line == null || original.column == null) {
      return {
        source: toBrowserSourcePath(cleanId, root),
        line: position.line,
        column: position.column,
        content: code,
      };
    }

    const sourceIndex = rawMap.sources?.indexOf(original.source) ?? -1;
    const sourceContent = sourceIndex >= 0 ? (rawMap.sourcesContent?.[sourceIndex] ?? null) : null;
    const resolvedSource = resolveOriginalSource(original.source, cleanId, root, sourceContent);

    return {
      source: resolvedSource.source,
      line: original.line,
      column: original.column,
      content: resolvedSource.content,
    };
  };
}

function remapCssMetadata(
  metadata: CssBlockMetadata[],
  code: string,
  cleanId: string,
  root: string,
  combinedMap: SourceMapInput | null,
): RemappedCssBlock[] {
  const remap = createRemapper(code, cleanId, root, combinedMap);

  return metadata.map((block) => ({
    index: block.index,
    quasis: block.quasis.map(remap),
    expressions: block.expressions.map(remap),
  }));
}

function getExtractRuntimeSource() {
  if (extractRuntimeSourceCache != null) return extractRuntimeSourceCache;

  const builtSource = fs.readFileSync(EXTRACT_RUNTIME_PATH, "utf8");
  extractRuntimeSourceCache = builtSource
    .replace(/\n\/\/# sourceMappingURL=.*$/u, "")
    .replace(/^\s*export\s*\{[^}]+\};?\s*$/gmu, "")
    .trimEnd();

  return extractRuntimeSourceCache;
}

function createCompileTimePrelude(blocks: RemappedCssBlock[]) {
  if (blocks.length === 0) return "";
  const bindings = blocks
    .map(
      (block) =>
        `const __csslit_extract_${block.index} = createCsslitExtractRuntime(${JSON.stringify(block)});`,
    )
    .join("\n");
  return `${getExtractRuntimeSource()}
${bindings}
`;
}

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

type CssOutputState = {
  parts: string[];
  currentLine: number;
  lineMappings: (SourceLocation | null)[];
};

function appendCssText(state: CssOutputState, text: string) {
  if (text.length === 0) return;

  state.parts.push(text);

  const newlineCount = text.split("\n").length - 1;
  while (state.lineMappings.length <= state.currentLine + newlineCount) {
    state.lineMappings.push(null);
  }
  state.currentLine += newlineCount;
}

function applyLineMappings(
  state: CssOutputState,
  currentLine: number,
  text: string,
  starts: (SourceLocation | null)[],
  fallbackLoc: SourceLocation | null,
) {
  if (text.length === 0) return;

  state.lineMappings[currentLine] ??= cloneLoc(starts[0] ?? fallbackLoc);

  let generatedLine = currentLine;
  let lineStartIndex = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      generatedLine += 1;
      state.lineMappings[generatedLine] ??= cloneLoc(starts[lineStartIndex] ?? fallbackLoc);
      lineStartIndex += 1;
    }
  }
}

function buildCssOutput(result: ExtractedCssResult, className: string) {
  const state: CssOutputState = {
    parts: [".", className, " {\n"],
    currentLine: 1,
    lineMappings: [],
  };
  const block = result.block;
  const startLoc = block?.quasis?.[0] ?? block?.expressions?.[0] ?? null;

  state.lineMappings[0] = cloneLoc(startLoc);

  for (let index = 0; index < result.strings.length; index += 1) {
    const currentLine = state.currentLine;
    const cooked = normalizeNewlines(result.strings[index] ?? "");
    const raw = normalizeNewlines(result.strings.raw[index] ?? "");
    const quasiLoc = block?.quasis?.[index] ?? null;

    appendCssText(state, cooked);
    applyLineMappings(state, currentLine, cooked, collectStaticLineStarts(quasiLoc, raw), quasiLoc);

    if (index < result.values.length) {
      const valueLine = state.currentLine;
      const expressionLoc = block?.expressions?.[index] ?? null;
      const value = normalizeNewlines(String(result.values[index] ?? ""));

      appendCssText(state, value);
      applyLineMappings(
        state,
        valueLine,
        value,
        collectDynamicLineStarts(expressionLoc, value),
        expressionLoc,
      );
    }
  }

  appendCssText(state, "\n}");

  return {
    css: state.parts.join(""),
    lineMappings: state.lineMappings,
  };
}

function buildCssSourcemap(file: string, lineMappings: (SourceLocation | null)[]): SourceMapInput {
  const map = new GenMapping({ file });
  const seenSources = new Set<string>();

  for (const [index, loc] of lineMappings.entries()) {
    if (!loc?.source) continue;

    maybeAddMapping(map, {
      generated: { line: index + 1, column: 0 },
      source: loc.source,
      original: { line: loc.line, column: loc.column },
    });

    if (loc.content != null && !seenSources.has(loc.source)) {
      setSourceContent(map, loc.source, loc.content);
      seenSources.add(loc.source);
    }
  }

  return toEncodedMap(map) as SourceMapInput;
}

export function cssCompilePlugin(): Plugin {
  let devServer: ViteDevServer | null = null;
  let root = normalizePath(process.cwd());

  return {
    name: "vite-plugin-css-compile",

    configureServer(server) {
      devServer = server;
    },

    async configResolved(config) {
      root = normalizePath(config.root);
    },

    async transform(code: string, id: string) {
      const normalizedId = normalizePath(id);
      const [cleanId, query] = normalizedId.split("?");

      if (
        normalizedId.startsWith("\0") ||
        cleanId.includes("/node_modules/") ||
        !isWithinRoot(cleanId, root)
      ) {
        return null;
      }

      if (!/\.[jt]sx?$/.test(cleanId)) return null;

      const isEval = query?.includes("css-compile-eval");
      const result = rustTransform(code, {
        mode: isEval ? "compileTime" : "runtime",
        filename: cleanId,
      });

      if (result.code === code) return null;

      if (!isEval) {
        return {
          code: rewriteRuntimeVirtualIds(result.code, cleanId),
          map: result.map ? (JSON.parse(result.map) as SourceMapInput) : null,
        };
      }

      const combinedMap = this.getCombinedSourcemap();
      const metadata = result.meta ? (JSON.parse(result.meta) as CssBlockMetadata[]) : [];
      const remappedBlocks = remapCssMetadata(metadata, code, cleanId, root, combinedMap);
      const prelude = createCompileTimePrelude(remappedBlocks);
      const map = shiftSourcemap(
        result.map ? (JSON.parse(result.map) as SourceMapInput) : null,
        prelude,
      );

      return {
        code: `${prelude}${result.code}`,
        map,
      };
    },

    resolveId(source) {
      if (source.startsWith(VIRTUAL_CSS_ID_PREFIX)) {
        return source;
      }
      return null;
    },

    async load(id) {
      if (!id.startsWith(VIRTUAL_CSS_ID_PREFIX)) {
        return null;
      }

      const match = id.match(/virtual:css-compile\/(\d+)\.module\.css\?sourceId=([^&]+)$/);
      if (!match) {
        return null;
      }

      const [, index, sourceId] = match;
      const normalizedAbsPath = normalizePath(decodeSourceId(sourceId));
      const evalId = `${normalizedAbsPath}?css-compile-eval`;
      const server = devServer || (this as any).environment?.server;

      if (!server) return null;

      try {
        const mod = await server.ssrLoadModule(evalId);
        const getCss = mod[`__ext_css_${index}`];

        if (!getCss) {
          console.error(`[Plugin] CSS function __ext_css_${index} not found in ${evalId}`);
          return null;
        }

        const result = getCss() as ExtractedCssResult;
        const cssFile = `${VIRTUAL_CSS_ID_PREFIX}${index}.module.css`;
        const output = buildCssOutput(result, `css-${index}`);
        return {
          code: output.css,
          map: buildCssSourcemap(cssFile, output.lineMappings),
          moduleType: "css",
        };
      } catch (err: any) {
        console.error(`[Plugin] CSS Extraction failed for ${id}:`, err);
        return null;
      }
    },
  };
}
