import { transform as rustTransform } from "@csslit/rust-transformer";
import {
  GenMapping,
  maybeAddMapping,
  toEncodedMap,
} from "@jridgewell/gen-mapping";
import path from "node:path";
import type { SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";
import { type Plugin, type ViteDevServer, normalizePath } from "vite-plus";

const CSS_DERIVED_SUFFIX = ".csslit-";

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

function parseDerivedCssId(id: string) {
  const normalizedId = normalizePath(id);
  const match = normalizedId.match(new RegExp(`^(.*)\\.csslit-(\\d+)\\.module\\.css$`));
  if (!match) return null;
  return {
    absPath: match[1],
    index: match[2],
  };
}

function buildCssCode(result: ExtractedCssResult, className: string) {
  return `.${className} {\n${String.raw({ raw: result.strings }, ...result.values)}\n}`;
}

function buildCssSourcemap(
  file: string,
  result: ExtractedCssResult,
): SourceMapInput {
  const block = result.block;
  const map = new GenMapping({ file });
  const normalizedSources = new Map<string, string>();
  let currentLine = 1;

  function getSource(loc: SourceLocation | null) {
    if (!loc?.source) return null;
    let source = normalizedSources.get(loc.source);
    if (!source) {
      const cleanSource = normalizePath(loc.source.split("?")[0] ?? loc.source);
      source = path.isAbsolute(cleanSource)
        ? normalizePath(path.relative(path.dirname(file), cleanSource))
        : cleanSource;
      normalizedSources.set(loc.source, source);
    }
    return source;
  }

  if (block?.quasis?.[0] || block?.expressions?.[0]) {
    const startLoc = block?.quasis?.[0] ?? block?.expressions?.[0] ?? null;
    const source = getSource(startLoc);
    if (source) {
      maybeAddMapping(map, {
        generated: { line: 1, column: 0 },
        source,
        original: { line: startLoc.line, column: startLoc.column },
        content: startLoc.content,
      });
    }
  }

  for (let index = 0; index < result.strings.length; index += 1) {
    const cooked = result.strings[index] ?? "";
    const raw = result.strings.raw[index] ?? "";
    const quasiLoc = block?.quasis?.[index] ?? null;

    if (cooked.length > 0) {
      const generatedLineCount = (cooked.match(/\r\n?|\n/g)?.length ?? 0) + 1;
      const sourceLineCount = raw.split("\n").length;

      for (let lineOffset = 0; lineOffset < generatedLineCount; lineOffset += 1) {
        if (!quasiLoc) continue;
        const source = getSource(quasiLoc);
        if (!source) continue;
        maybeAddMapping(map, {
          generated: { line: currentLine + lineOffset, column: 0 },
          source,
          original: {
            line: quasiLoc.line + Math.min(lineOffset, sourceLineCount - 1),
            column: lineOffset === 0 ? quasiLoc.column : 0,
          },
          content: quasiLoc.content,
        });
      }

      currentLine += generatedLineCount - 1;
    }

    if (index >= result.values.length) continue;

    const value = String(result.values[index] ?? "");
    const expressionLoc = block?.expressions?.[index] ?? null;

    if (value.length === 0) continue;

    const generatedLineCount = (value.match(/\r\n?|\n/g)?.length ?? 0) + 1;

    for (let lineOffset = 0; lineOffset < generatedLineCount; lineOffset += 1) {
      if (!expressionLoc) continue;
      const source = getSource(expressionLoc);
      if (!source) continue;
      maybeAddMapping(map, {
        generated: { line: currentLine + lineOffset, column: 0 },
        source,
        original: { line: expressionLoc.line, column: expressionLoc.column },
        content: expressionLoc.content,
      });
    }

    currentLine += generatedLineCount - 1;
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
        !(cleanId === root || cleanId.startsWith(`${root}/`))
      ) {
        return null;
      }

      if (!/\.[jt]sx?$/.test(cleanId)) return null;

      const isEval = query?.includes("css-compile-eval");
      const inputMap = this.getCombinedSourcemap();
      const result = rustTransform(code, {
        mode: isEval ? "compileTime" : "runtime",
        filename: cleanId,
        inputMap: inputMap ? JSON.stringify(inputMap) : undefined,
      });

      return {
        code: result.code,
        map: result.map ? (JSON.parse(result.map) as SourceMapInput) : null,
      };
    },

    resolveId(source, importer) {
      if (!source.includes(CSS_DERIVED_SUFFIX) || !source.endsWith(".module.css")) return null;

      if (source.startsWith("/") || path.isAbsolute(source)) {
        return {
          id: normalizePath(source),
          moduleType: "css",
        };
      }

      if (!importer) return null;

      return {
        id: normalizePath(path.resolve(path.dirname(importer), source)),
        moduleType: "css",
      };
    },

    async load(id) {
      const derivedCss = parseDerivedCssId(id);
      if (!derivedCss) return null;

      const { absPath, index } = derivedCss;
      const normalizedAbsPath = normalizePath(absPath);
      const evalId = `${normalizedAbsPath}?css-compile-eval`;
      const server = devServer || (this.environment as any).server;

      if (!server) return null;

      try {
        const mod = await server.ssrLoadModule(evalId);
        const getCss = mod[`__ext_css_${index}`];

        if (!getCss) {
          console.error(`[Plugin] CSS function __ext_css_${index} not found in ${evalId}`);
          return null;
        }

        const result = getCss() as ExtractedCssResult;
        return {
          code: buildCssCode(result, `css-${index}`),
          map: buildCssSourcemap(id, result),
          moduleType: "css",
        };
      } catch (err: unknown) {
        console.error(`[Plugin] CSS Extraction failed for ${id}:`, err);
        return null;
      }
    },
  };
}
