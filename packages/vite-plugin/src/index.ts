import { transform as rustTransform } from "@csslit/rust-transformer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { type Plugin, type ViteDevServer, normalizePath } from "vite";

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

type RawSourceMap = {
  version: number;
  file?: string;
  names?: string[];
  mappings: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
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

function shiftSourcemap(map: RawSourceMap | null, prefix: string) {
  if (!map) return null;
  const prefixLines = prefix.match(/\n/g)?.length ?? 0;
  if (prefixLines === 0) return map;
  return {
    ...map,
    mappings: `${";".repeat(prefixLines)}${map.mappings}`,
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
  combinedMap: RawSourceMap | null,
) {
  const lineStarts = createLineStarts(code);

  if (!combinedMap?.mappings) {
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

  const traceMap = new TraceMap(combinedMap);
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

    const sourceIndex = combinedMap.sources.indexOf(original.source);
    const sourceContent =
      sourceIndex >= 0 ? (combinedMap.sourcesContent?.[sourceIndex] ?? null) : null;
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
  combinedMap: RawSourceMap | null,
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
  return `${getExtractRuntimeSource()}
const __csslit_extract__ = createCsslitExtractRuntime(${JSON.stringify([null, ...blocks])});
`;
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
          map: result.map ? JSON.parse(result.map) : null,
        };
      }

      const combinedMap = this.getCombinedSourcemap() as RawSourceMap | null;
      const metadata = result.meta ? (JSON.parse(result.meta) as CssBlockMetadata[]) : [];
      const remappedBlocks = remapCssMetadata(metadata, code, cleanId, root, combinedMap);
      const prelude = createCompileTimePrelude(remappedBlocks);
      const map = shiftSourcemap(
        result.map ? (JSON.parse(result.map) as RawSourceMap) : null,
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

        const result = getCss();
        return {
          code: result?.css ?? "",
          map: result?.map ?? null,
          moduleType: "css",
        };
      } catch (err: any) {
        console.error(`[Plugin] CSS Extraction failed for ${id}:`, err);
        return null;
      }
    },
  };
}
