import { transformCompileTime, transformRuntime } from "@csslit/rust-transformer";
import type { RawSourceMap } from "@csslit/rust-transformer";
import {
  GenMapping,
  maybeAddMapping,
  setSourceContent,
  toEncodedMap,
} from "@jridgewell/gen-mapping";
import path from "node:path";
import type { SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";
import { createRunnableDevEnvironment, normalizePath } from "vite-plus";
import type { Plugin, ViteDevServer, RunnableDevEnvironment } from "vite-plus";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite-plus/module-runner";

const CSS_DERIVED_SUFFIX = ".csslit.module.css";
const CSS_EVAL_QUERY = "csslit-eval";
const SCRIPT_ID_RE = /\.(?:js|ts|jsx|tsx)?(?:$|\?)/;
const CSS_DERIVED_ID_RE = /\.csslit\.module\.css$/;

type SourceLocation = {
  source: string;
  line: number;
  column: number;
};

type RemappedCssBlock = {
  quasis: SourceLocation[];
  expressions: SourceLocation[];
};

type ExtractedCssResult = {
  block: RemappedCssBlock | null;
  strings: TemplateStringsArray;
  values: unknown[];
};

type ExtractedSourceContent = [string, string | null];

function toRawSourceMap(map: SourceMapInput | null | undefined): RawSourceMap | undefined {
  return map && typeof map !== "string" ? (map as RawSourceMap) : undefined;
}

function getErrorLocation(error: Error) {
  for (const line of error.stack?.split("\n") ?? []) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;

    const match = trimmed.match(/\((.+):(\d+):(\d+)\)$/) ?? trimmed.match(/^at (.+):(\d+):(\d+)$/);

    if (!match) continue;

    const file = normalizePath(match[1] ?? "");
    if (!file || file.includes("/node_modules/")) continue;

    return {
      file,
      line: Number(match[2]),
      column: Number(match[3]),
    };
  }

  return null;
}

function formatCssEvaluationStack(error: Error) {
  const lines = error.stack?.split("\n");
  if (!lines || lines.length === 0) return error.stack;

  const header = lines[0] ?? `${error.name}: ${error.message}`;
  const stack: string[] = [header];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;

    if (trimmed.startsWith("at eval (") || trimmed.startsWith("at async eval (")) {
      stack.push(line.replace(/\beval\b/, "css eval"));
      break;
    }

    stack.push(line);
  }

  return stack.join("\n");
}

function buildCssCode(results: ExtractedCssResult[]) {
  let css = "";

  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    const result = results[resultIndex];
    const className = `csslit_${resultIndex}`;

    if (resultIndex > 0) {
      css += "\n";
    }

    css += `.${className} {\n`;

    for (let index = 0; index < result.strings.length; index += 1) {
      css += result.strings[index] ?? "";
      if (index < result.values.length) {
        // oxlint-disable-next-line typescript/no-base-to-string
        css += String(result.values[index]);
      }
    }

    css += "\n}";
  }

  return css;
}

function watchCssEvalDependencies(
  addWatchFile: (id: string) => void,
  evaluatedModules: EvaluatedModules,
  evalId: string,
) {
  const start = evaluatedModules.getModuleByUrl(evalId);
  const seen = new Set<string>();

  const visit = (mod: EvaluatedModuleNode | undefined) => {
    if (!mod || seen.has(mod.id)) {
      return;
    }
    seen.add(mod.id);

    addWatchFile(mod.file);

    for (const importedId of mod.imports) {
      visit(evaluatedModules.getModuleById(importedId));
    }
  };

  visit(start);
}

function buildCssSourcemap(
  file: string,
  results: ExtractedCssResult[],
  root: string,
  sourceContents: Map<string, string | null> | null,
): SourceMapInput {
  const map = new GenMapping({ file });
  const normalizedSources = new Map<string, string>();
  const sourcesWithContent = new Set<string>();
  let currentLine = 1;

  function getSource(loc: SourceLocation | null) {
    if (!loc?.source) return null;
    let source = normalizedSources.get(loc.source);
    if (!source) {
      const cleanSource = normalizePath(loc.source.split("?")[0] ?? loc.source);
      if (path.isAbsolute(cleanSource)) {
        const relativeSource = normalizePath(path.relative(root, cleanSource));
        source = relativeSource.startsWith("..") ? cleanSource : `/${relativeSource}`;
      } else {
        source = cleanSource;
      }
      normalizedSources.set(loc.source, source);
    }

    if (sourceContents?.has(loc.source) && !sourcesWithContent.has(source)) {
      setSourceContent(map, source, sourceContents.get(loc.source) ?? null);
      sourcesWithContent.add(source);
    }

    return source;
  }

  for (const result of results) {
    const block = result.block;

    if (block?.quasis?.[0] || block?.expressions?.[0]) {
      const startLoc = block?.quasis?.[0] ?? block?.expressions?.[0] ?? null;
      const source = getSource(startLoc);
      if (source) {
        maybeAddMapping(map, {
          generated: { line: currentLine, column: 0 },
          source,
          original: { line: startLoc.line, column: startLoc.column },
        });
      }
    }

    currentLine += 1;

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
          });
        }

        currentLine += generatedLineCount - 1;
      }

      if (index >= result.values.length) continue;

      // oxlint-disable-next-line typescript/no-base-to-string
      const value = String(result.values[index]);
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
        });
      }

      currentLine += generatedLineCount - 1;
    }

    currentLine += 1;

    if (result !== results[results.length - 1]) {
      currentLine += 1;
    }
  }

  return toEncodedMap(map) as SourceMapInput;
}

export function cssCompilePlugin(): Plugin {
  let evalEnvironment: RunnableDevEnvironment | null = null;

  return {
    name: "vite-plugin-css-compile",

    configureServer(server: ViteDevServer) {
      evalEnvironment = server.environments.ssr as RunnableDevEnvironment;
    },

    async configResolved(config) {
      if (config.command !== "build") return;
      evalEnvironment = createRunnableDevEnvironment("ssr", config);
      await evalEnvironment.init();
    },

    async buildEnd() {
      if (evalEnvironment) {
        await evalEnvironment.close();
        evalEnvironment = null;
      }
    },

    transform: {
      filter: {
        id: SCRIPT_ID_RE,
        moduleType: ["js", "jsx", "ts", "tsx"],
      },
      async handler(code: string, id: string) {
        const config = this.environment.config;
        const [cleanId, query] = id.split("?");
        const isEval = query?.split("&").includes(CSS_EVAL_QUERY) ?? false;

        if (isEval) {
          const sourcemap =
            config.command === "build" ? !!config.build.sourcemap : config.css.devSourcemap;

          const result = transformCompileTime(code, {
            filename: cleanId,
            inputMap: sourcemap ? toRawSourceMap(this.getCombinedSourcemap()) : undefined,
            sourcemap,
          });

          return {
            code: result.code,
            map: result.map ?? null,
          };
        } else {
          const sourcemap =
            config.command === "build"
              ? !!config.build.sourcemap
              : typeof config.dev.sourcemap === "boolean"
                ? config.dev.sourcemap
                : (config.dev.sourcemap?.js ?? true);

          const result = transformRuntime(code, {
            filename: cleanId,
            sourcemap,
          });

          return {
            code: result.code,
            map: result.map ?? null,
          };
        }
      },
    },

    resolveId: {
      filter: {
        id: CSS_DERIVED_ID_RE,
      },
      handler(source, importer) {
        const id = path.isAbsolute(source)
          ? source
          : importer
            ? normalizePath(path.resolve(path.dirname(importer), source))
            : null;

        if (!id) return null;

        return {
          id,
          moduleType: "css",
        };
      },
    },

    load: {
      filter: {
        id: CSS_DERIVED_ID_RE,
      },
      async handler(id) {
        const config = this.environment.config;
        const absPath = id.slice(0, -CSS_DERIVED_SUFFIX.length);
        const evalId = `${absPath}?${CSS_EVAL_QUERY}`;
        const sourcemap =
          config.command === "build" ? !!config.build.sourcemap : config.css.devSourcemap;

        try {
          const runner = evalEnvironment!.runner;
          const mod = await runner.import(evalId);
          watchCssEvalDependencies(
            (file) => this.addWatchFile(file),
            runner.evaluatedModules,
            evalId,
          );
          const results: ExtractedCssResult[] = [];
          const sourceContents = mod.__csslit_source_contents
            ? new Map(mod.__csslit_source_contents as ExtractedSourceContent[])
            : null;

          for (const [name, value] of Object.entries(mod)) {
            if (name.startsWith("__ext_css_") && value != null && typeof value === "object") {
              results.push(value as ExtractedCssResult);
            }
          }

          if (results.length === 0) {
            this.error({
              code: "CSS_EXTRACTION_ERROR",
              hook: "load",
              id: absPath,
              message: `CSS extraction failed for ${absPath}: no __ext_css_ exports found in ${evalId}`,
              plugin: "vite-plugin-css-compile",
            });
          }

          return {
            code: buildCssCode(results),
            map: sourcemap ? buildCssSourcemap(id, results, config.root, sourceContents) : null,
            moduleType: "css",
          };
        } catch (err: unknown) {
          const loc = err instanceof Error ? getErrorLocation(err) : null;

          this.error({
            cause: err,
            code: "CSS_EXTRACTION_ERROR",
            hook: "load",
            id: absPath,
            loc: loc ?? undefined,
            message: `CSS extraction failed for ${absPath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            name: err instanceof Error ? err.name : undefined,
            plugin: "vite-plugin-css-compile",
            stack: err instanceof Error ? formatCssEvaluationStack(err) : undefined,
          });
        }
      },
    },
  };
}
