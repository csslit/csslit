import { transformCompileTime, transformRuntime } from "@csslit/rust-transformer";
import { readFileSync } from "node:fs";
import { createRunnableDevEnvironment, normalizePath } from "vite-plus";
import type { Plugin, ViteDevServer, RunnableDevEnvironment } from "vite-plus";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite-plus/module-runner";
import type { SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";
import { buildCsslitError, buildCsslitEvaluationError } from "./eval-error";
import type { EvalDiagnostic, Location } from "./eval-error";

interface EvalResult {
  code: string;
  errors: EvalDiagnostic[];
  map: SourceMapInput | null;
}

const csslitEvalRuntimeCode = readFileSync(new URL("./eval-runtime.js", import.meta.url), "utf8");

const csslitErrorResolutionOptions = {
  normalizeStackLine(line: string) {
    const stackLine = line.replace(/[^)\s]+?\.csslit(?=:\d+:\d+\)?|$|\s)/g, (id) =>
      id.slice(0, -".csslit".length),
    );

    const match = /^    at (.+) \((.+):([0-9]+):([0-9]+)\)$/.exec(stackLine);

    let location: { file: string; location: Location } | undefined = undefined;
    if (match) {
      const callee = match[1]!;
      const file = match[2]!;
      const line = Number(match[3]!);
      const column = Number(match[4]!);

      if (
        callee === "ESModulesEvaluator.runInlinedModule" ||
        file === "virtual:csslit-eval-runtime"
      ) {
        return undefined;
      }

      location = {
        file: normalizePath(file),
        location: {
          row: line - 1,
          col: column - 1,
        },
      };
    }

    return {
      line: stackLine,
      location: location,
    };
  },
  readSource(file: string) {
    return readFileSync(file, "utf8");
  },
};

function watchCssEvalDependencies(
  addWatchFile: (id: string) => void,
  evaluatedModules: EvaluatedModules,
  moduleGraph: RunnableDevEnvironment["moduleGraph"],
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

    const graphModule = moduleGraph.getModuleById(mod.id);
    if (graphModule) {
      for (const importedModule of graphModule.importedModules) {
        if (importedModule.type === "asset") {
          addWatchFile(importedModule.file!);
        }
      }
    }

    for (const importedId of mod.imports) {
      visit(evaluatedModules.getModuleById(importedId));
    }
  };

  visit(start);
}

export function csslitPlugin(): Plugin {
  let evalEnvironment: RunnableDevEnvironment | null = null;

  return {
    name: "vite-plugin-csslit",
    enforce: "pre",

    config(config) {
      config.environments ??= {};
      const comptime = (config.environments.comptime ??= {});

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
      evalEnvironment = server.environments.comptime as RunnableDevEnvironment;
    },

    transform: {
      filter: {
        id: [/\.(?:js|ts|jsx|tsx)\.csslit$/, /\.(?:js|ts|jsx|tsx)$/],
        moduleType: ["js", "jsx", "ts", "tsx"],
      },
      async handler(code: string, id: string) {
        const config = this.environment.config;
        const isEvalRequest = id.endsWith(".csslit");

        const jsSourcemap =
          config.command === "build"
            ? !!config.build.sourcemap
            : typeof config.dev.sourcemap === "boolean"
              ? config.dev.sourcemap
              : (config.dev.sourcemap?.js ?? true);

        if (isEvalRequest) {
          const evalSourceId = id.slice(0, -".csslit".length);

          const cssSourcemap =
            config.command === "build" ? !!config.build.sourcemap : config.css.devSourcemap;

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
            cssImport: `${normalizePath(id)}.csslit.module.css`,
            filename: id,
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
      filter: {
        id: [/^virtual:csslit-eval-runtime$/, /\.csslit\.module\.css$/],
      },
      async handler(source) {
        if (source === "virtual:csslit-eval-runtime") {
          return "\0virtual:csslit-eval-runtime";
        }

        if (source.endsWith(".csslit.module.css")) {
          const sourceId = source.slice(0, -".csslit.module.css".length);
          return {
            id: `${sourceId}.csslit.module.css`,
            moduleType: "css",
          };
        }

        return null;
      },
    },

    load: {
      filter: {
        id: [
          // oxlint-disable-next-line no-control-regex
          /^\0virtual:csslit-eval-runtime$/,
          /\.csslit\.module\.css$/,
          /\.(?:js|ts|jsx|tsx)\.csslit$/,
        ],
      },
      async handler(id) {
        if (id === "\0virtual:csslit-eval-runtime") {
          return csslitEvalRuntimeCode;
        } else if (id.endsWith(".csslit")) {
          const evalSourceId = id.slice(0, -".csslit".length);
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
        } else if (id.endsWith(".csslit.module.css")) {
          const sourceId = id.slice(0, -".csslit.module.css".length);
          const sourceFile = sourceId;
          const evalId = `${sourceId}.csslit`;
          let result: EvalResult;

          this.addWatchFile(sourceId);
          const runner = evalEnvironment!.runner;

          let mod: Record<string, unknown>;

          try {
            mod = await runner.import(evalId);
          } catch (err: unknown) {
            const error = buildCsslitEvaluationError(err, sourceFile, csslitErrorResolutionOptions);

            this.error({
              cause: err,
              code: "CSS_EVALUATION_ERROR",
              hook: "load",
              id: sourceId,
              loc: error.loc,
              message: error.message,
              stack: error.stack,
            });
          } finally {
            watchCssEvalDependencies(
              (file) => this.addWatchFile(file),
              runner.evaluatedModules,
              evalEnvironment!.moduleGraph,
              evalId,
            );
          }

          result = mod.__csslit_eval_result as EvalResult;

          if (result.errors.length > 0) {
            if (this.environment.name !== "comptime") {
              for (const error of result.errors) {
                const warning = buildCsslitError(error, {
                  ...csslitErrorResolutionOptions,
                  sourceFile,
                });

                this.warn({
                  cause: error,
                  frame: warning.frame,
                  id: sourceId,
                  loc: warning.loc,
                  message: warning.message,
                });
              }
            }
          }

          return {
            code: result.code,
            map: result.map ?? null,
            moduleType: "css",
          };
        } else {
          return null;
        }
      },
    },
  };
}
