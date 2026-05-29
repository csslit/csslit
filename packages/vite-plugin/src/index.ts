import { transformCompileTime, transformRuntime } from "@csslit/rust-transformer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRunnableDevEnvironment, normalizePath } from "vite-plus";
import type { Plugin, ViteDevServer, RunnableDevEnvironment } from "vite-plus";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite-plus/module-runner";
import type { SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";
import { buildCsslitError, getThrownValueInfo, trimModuleRunnerStack } from "./eval-error";
import type { CsslitEvalError } from "./eval-error";

const CSS_DERIVED_SUFFIX = ".csslit.module.css";
const CSSLIT_EVAL_RESULT_EXPORT = "__csslit_eval_result";
const CSSLIT_COMPTIME_ENVIRONMENT = "comptime";
const CSSLIT_EVAL_RUNTIME_ID = "virtual:csslit-eval-runtime";
const RESOLVED_CSSLIT_EVAL_RUNTIME_ID = "\0virtual:csslit-eval-runtime";
const CSSLIT_EVAL_ID_PREFIX = "virtual:csslit-eval:";
const CSSLIT_EVAL_STACK_ID_RE = /virtual:csslit-eval:[^)\s]+?(?=:\d+:\d+\)?|$|\s)/g;
const TRANSFORM_ID_RE = /^(?:virtual:csslit-eval:|.*\.(?:js|ts|jsx|tsx)(?:$|\?))/;
const CSS_DERIVED_ID_RE = /\.csslit\.module\.css$/;

function normalizeLocationFile(file: string) {
  return normalizePath(file);
}

type CsslitEvalResult = {
  code: string;
  errors: CsslitEvalError[];
  map: SourceMapInput | null;
};

const csslitEvalRuntimeCode = readFileSync(new URL("./eval-runtime.js", import.meta.url), "utf8");

const csslitErrorResolutionOptions = {
  ignoreStackFrameFile(file: string) {
    return file.includes("/node_modules/") || file.includes("virtual:csslit-eval-runtime");
  },
  normalizeFile: normalizeLocationFile,
  normalizeStackText(stackText: string | undefined) {
    const normalized = stackText?.replace(
      CSSLIT_EVAL_STACK_ID_RE,
      (id) => parseCssEvalId(id) ?? id,
    );
    return trimModuleRunnerStack(normalized);
  },
};

function parseCssEvalId(id: string) {
  return id.startsWith(CSSLIT_EVAL_ID_PREFIX)
    ? decodeURIComponent(id.slice(CSSLIT_EVAL_ID_PREFIX.length))
    : null;
}

function buildWarning(error: unknown, fallbackFile?: string) {
  return buildCsslitError(error, {
    ...csslitErrorResolutionOptions,
    fallbackFile,
    readSource(file) {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return undefined;
      }
    },
  });
}

function parseLocationFromStack(stack: string | undefined) {
  if (!stack) {
    return undefined;
  }

  const locationRe = /\(?((?:[A-Za-z]:[\\/]|\/|file:\/\/\/)[^:\n)]+):(\d+):(\d+)\)?/u;
  const lines = stack.split(/\r?\n/u);

  for (const line of lines) {
    if (line.includes("/node_modules/") || line.includes("\\node_modules\\")) {
      continue;
    }

    const match = locationRe.exec(line);
    if (!match) {
      continue;
    }

    const file = normalizeLocationFile(match[1]!.replace(/^file:\/\//u, ""));
    const lineNumber = Number.parseInt(match[2]!, 10);
    const columnNumber = Number.parseInt(match[3]!, 10);

    if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
      continue;
    }

    return {
      file,
      line: lineNumber,
      column: columnNumber,
    };
  }

  return undefined;
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

export function cssCompilePlugin(): Plugin {
  let evalEnvironment: RunnableDevEnvironment | null = null;

  return {
    name: "vite-plugin-css-compile",
    enforce: "pre",

    config(config) {
      config.environments ??= {};
      const comptime = (config.environments[CSSLIT_COMPTIME_ENVIRONMENT] ??= {});

      comptime.consumer ??= "server";
      comptime.resolve ??= {};
      comptime.resolve.external ??= true;
      comptime.resolve.noExternal ??= [];
      comptime.dev ??= {};
      comptime.dev.createEnvironment ??= (name, config) =>
        createRunnableDevEnvironment(name, config, {
          runnerOptions: {
            hmr: false,
          },
        });
    },

    configureServer(server: ViteDevServer) {
      evalEnvironment = server.environments[CSSLIT_COMPTIME_ENVIRONMENT] as RunnableDevEnvironment;
    },

    transform: {
      filter: {
        id: TRANSFORM_ID_RE,
        moduleType: ["js", "jsx", "ts", "tsx"],
      },
      async handler(code: string, id: string) {
        const config = this.environment.config;
        const queryIndex = id.indexOf("?");
        const cleanId = queryIndex === -1 ? id : id.slice(0, queryIndex);
        const evalSourceId = parseCssEvalId(cleanId);
        const jsSourcemap =
          config.command === "build"
            ? !!config.build.sourcemap
            : typeof config.dev.sourcemap === "boolean"
              ? config.dev.sourcemap
              : (config.dev.sourcemap?.js ?? true);
        const cssSourcemap =
          config.command === "build" ? !!config.build.sourcemap : config.css.devSourcemap;

        if (evalSourceId) {
          const filename = evalSourceId.startsWith(`${config.root}/`)
            ? evalSourceId.slice(config.root.length)
            : evalSourceId;

          const result = transformCompileTime(code, {
            cssFilename: filename,
            cssSourcemap,
            filename: evalSourceId,
            sourcemap: jsSourcemap,
          });

          return {
            code: result.code,
            map: result.map ?? null,
            moduleType: "js",
          };
        } else {
          const result = transformRuntime(code, {
            filename: cleanId,
            sourcemap: jsSourcemap,
          });

          return {
            code: result.code,
            map: result.map ?? null,
          };
        }
      },
    },

    resolveId: {
      async handler(source, importer) {
        if (source === CSSLIT_EVAL_RUNTIME_ID) {
          return RESOLVED_CSSLIT_EVAL_RUNTIME_ID;
        }

        const importerId = importer ? (parseCssEvalId(importer) ?? importer) : null;

        if (
          importerId &&
          (source.startsWith("./") || source.startsWith("../")) &&
          !source.startsWith(CSSLIT_EVAL_ID_PREFIX)
        ) {
          return normalizePath(path.resolve(path.dirname(importerId), source));
        }

        if (source.startsWith(CSSLIT_EVAL_ID_PREFIX)) {
          return {
            id: source,
            moduleType: "js",
          };
        }

        if (!CSS_DERIVED_ID_RE.test(source)) {
          return null;
        }

        if (path.isAbsolute(source)) {
          return {
            id: normalizePath(source),
            moduleType: "css",
          };
        }

        if (!importerId) return null;

        return {
          id: normalizePath(path.resolve(path.dirname(importerId), source)),
          moduleType: "css",
        };
      },
    },

    load: {
      async handler(id) {
        if (id === RESOLVED_CSSLIT_EVAL_RUNTIME_ID) {
          return csslitEvalRuntimeCode;
        }

        const evalSourceId = parseCssEvalId(id);
        if (evalSourceId) {
          return {
            code: readFileSync(evalSourceId, "utf8"),
            moduleType: evalSourceId.endsWith(".tsx")
              ? "tsx"
              : evalSourceId.endsWith(".ts")
                ? "ts"
                : evalSourceId.endsWith(".jsx")
                  ? "jsx"
                  : "js",
          };
        }

        if (!CSS_DERIVED_ID_RE.test(id)) {
          return null;
        }

        const sourcePath = id.slice(0, -CSS_DERIVED_SUFFIX.length);
        const sourceId = path.isAbsolute(sourcePath)
          ? normalizePath(sourcePath)
          : normalizePath(path.resolve(this.environment.config.root, `.${sourcePath}`));
        const evalId = `${CSSLIT_EVAL_ID_PREFIX}${encodeURIComponent(sourceId)}`;
        let result: CsslitEvalResult;

        this.addWatchFile(sourceId);
        const runner = evalEnvironment!.runner;
        const evalModule = runner.evaluatedModules.getModuleByUrl(evalId);
        if (evalModule) {
          runner.evaluatedModules.invalidateModule(evalModule);
        }
        const comptimeModule = evalEnvironment!.moduleGraph.getModuleById(evalId);
        if (comptimeModule) {
          evalEnvironment!.moduleGraph.invalidateModule(comptimeModule);
        }
        let mod: Record<string, unknown>;
        try {
          mod = await runner.import(evalId);
        } catch (err: unknown) {
          const { stack, thrownValue } = getThrownValueInfo(err);
          const trimedStack = trimModuleRunnerStack(stack);
          const loc = parseLocationFromStack(trimedStack);

          this.error({
            cause: err,
            code: "CSS_EVALUATION_ERROR",
            hook: "load",
            id: sourceId,
            loc,
            message: `CSS literal evaluation failed while evaluating ${sourceId}.\n` + thrownValue,
            stack: trimedStack,
          });
        }
        watchCssEvalDependencies(
          (file) => this.addWatchFile(file),
          runner.evaluatedModules,
          evalId,
        );
        result = mod[CSSLIT_EVAL_RESULT_EXPORT] as CsslitEvalResult;

        if (result.errors.length > 0) {
          if (this.environment.name !== CSSLIT_COMPTIME_ENVIRONMENT) {
            for (const error of result.errors) {
              const warning = buildWarning(error, sourceId);

              this.warn({
                cause: error,
                frame: warning.kind === "csslit" ? warning.frame : undefined,
                id: sourceId,
                loc: warning.loc
                  ? {
                      file: warning.loc.file,
                      line: warning.loc.line,
                      column: warning.loc.column,
                    }
                  : undefined,
                message: warning.message,
                stack: warning.stack,
              });
            }
          }
        }

        return {
          code: result.code,
          map: result.map ?? null,
          moduleType: "css",
        };
      },
    },
  };
}
