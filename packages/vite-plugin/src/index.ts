import { transformClient } from "@csslit/rust-transformer";
import { readFileSync } from "node:fs";
import { createRunnableDevEnvironment, isRunnableDevEnvironment, normalizePath } from "vite-plus";
import type {
  BuildEnvironment,
  PluginOption,
  RunnableDevEnvironment,
  ViteDevServer,
} from "vite-plus";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite-plus/module-runner";
import type { PluginContext, SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";
import { buildCsslitError, buildCsslitEvaluationError } from "./eval-error";
import type { EvalDiagnostic, Location } from "./eval-error";
import { csslitComptimeBuildImportNormalizer } from "./import-normalizer";

interface EvalResult {
  code: string;
  errors: EvalDiagnostic[];
  map: SourceMapInput | null;
}

interface CsslitModuleMetadata {
  eval: {
    code: string;
    map: SourceMapInput | null;
  };
}

type LoadModule = PluginContext["load"];

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

export function csslitPlugin(): PluginOption {
  let comptimeEnvironment: RunnableDevEnvironment | null = null;
  let loadClientModule: LoadModule | null = null;

  return [
    {
      name: "vite-plugin-csslit",
      enforce: "pre",
      sharedDuringBuild: true,

      config(config) {
        config.builder ??= {};
        config.environments ??= {};
        const comptime = (config.environments.comptime ??= {});

        comptime.consumer ??= "server";
        comptime.isBundled ??= false;
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

        comptime.build ??= {};
        comptime.build.createEnvironment ??= (name, config) => {
          const environment = createRunnableDevEnvironment(name, config, {
            runnerOptions: {
              hmr: false,
            },
          });

          (environment as unknown as BuildEnvironment).isBuilt = true;
          comptimeEnvironment = environment;

          return environment as unknown as BuildEnvironment;
        };
      },

      configureServer(viteServer: ViteDevServer) {
        comptimeEnvironment = viteServer.environments.comptime as RunnableDevEnvironment;
      },

      buildStart() {
        if (this.environment.name === "client") {
          loadClientModule = this.load.bind(this);
        }
      },

      async buildApp(builder) {
        const environment = builder.environments.comptime;
        if (environment && isRunnableDevEnvironment(environment)) {
          comptimeEnvironment = environment;
        }

        try {
          const builds = Object.entries(builder.environments)
            .filter(([name, environment]) => name !== "comptime" && !environment.isBuilt)
            .map(([, environment]) => builder.build(environment));

          await Promise.all(builds);
        } finally {
          await comptimeEnvironment?.close();
          comptimeEnvironment = null;
          loadClientModule = null;
        }
      },

      transform: {
        filter: {
          id: /\.(?:js|ts|jsx|tsx)$/,
        },
        async handler(code: string, id: string) {
          const config = this.environment.config;
          const jsSourcemap =
            config.command === "build"
              ? !!config.build.sourcemap
              : typeof config.dev.sourcemap === "boolean"
                ? config.dev.sourcemap
                : (config.dev.sourcemap?.js ?? true);

          const cssSourcemap =
            config.command === "build" ? !!config.build.sourcemap : config.css.devSourcemap;

          const filename = id.startsWith(`${config.root}/`) ? id.slice(config.root.length) : id;

          const result = transformClient(code, {
            cssFilename: filename,
            cssImport: `${normalizePath(id)}.csslit.module.css`,
            cssSourcemap,
            filename: id,
            sourcemap: jsSourcemap,
          });

          return {
            code: result.runtime.code,
            map: result.runtime.map ?? null,
            meta: {
              csslit: {
                eval: {
                  code: result.eval.code,
                  map: result.eval.map ?? null,
                },
              } satisfies CsslitModuleMetadata,
            },
          };
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
            const moduleInfo = await loadClientModule!({ id: evalSourceId });
            const metadata = moduleInfo.meta.csslit as CsslitModuleMetadata;

            return {
              code: metadata.eval.code,
              map: metadata.eval.map,
            };
          } else if (id.endsWith(".csslit.module.css")) {
            const sourceId = id.slice(0, -".csslit.module.css".length);
            const sourceFile = sourceId;
            const evalId = `${sourceId}.csslit`;
            let result: EvalResult;

            this.addWatchFile(sourceId);
            const runnerEnvironment = comptimeEnvironment!;

            const runner = runnerEnvironment.runner;

            let mod: Record<string, unknown>;

            try {
              mod = await runner.import(evalId);
            } catch (err: unknown) {
              const error = buildCsslitEvaluationError(
                err,
                sourceFile,
                csslitErrorResolutionOptions,
              );

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
                runnerEnvironment.moduleGraph,
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
    },
    csslitComptimeBuildImportNormalizer(),
  ];
}
