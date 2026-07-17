import { compileCsslit, transformClient } from "@csslit/transform";
import { readFileSync } from "node:fs";
import remapping from "@jridgewell/remapping";
import type { SourceMapInput as RemappingSourceMapInput } from "@jridgewell/remapping";
import { createRunnableDevEnvironment, isRunnableDevEnvironment, normalizePath } from "vite";
import type { BuildEnvironment, PluginOption, RunnableDevEnvironment, ViteDevServer } from "vite";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite/module-runner";
import type { PluginContext, SourceMapInput } from "rolldown";
import { buildCsslitError, buildCsslitEvaluationError } from "./eval-error.ts";
import type { EvalDiagnostic, Location } from "./eval-error.ts";
import { csslitComptimeBuildImportNormalizer } from "./import-normalizer.ts";

interface EvalResult {
  blocks: Array<
    | {
        kind: "scoped";
        scopedName: string;
        code: string;
        mappingRuns?: number[];
      }
    | {
        kind: "global";
        code: string;
        mappingRuns?: number[];
      }
  >;
  errors: EvalDiagnostic[];
}

interface CsslitModuleMetadata {
  eval: {
    code: string;
    map: SourceMapInput | null;
  };
  exports: Array<{
    localName: string;
    scopedName: string;
  }>;
  sourceMap: RemappingSourceMapInput | null;
}

type LoadModule = PluginContext["load"];

const csslitEvalRuntimeCode = readFileSync(new URL("./eval-runtime.js", import.meta.url), "utf8");
const isWebContainer = !!process.versions["webcontainer"];

const csslitErrorResolutionOptions = {
  normalizeStackLine(line: string) {
    const stackLine = line.replace(/[^)\s]+?\.csslit(?=:\d+:\d+\)?|$|\s)/g, (id) =>
      id.slice(0, -".csslit".length),
    );

    const match = /^    at (?:(.+) \((.+):([0-9]+):([0-9]+)\)|(.+):([0-9]+):([0-9]+))$/.exec(
      stackLine,
    );

    let callee: string | undefined = undefined;
    let location: { file: string; location: Location } | undefined = undefined;
    if (match) {
      callee = match[1];
      const file = (match[2] ?? match[5])!;
      const line = Number((match[3] ?? match[6])!);
      const column = Number((match[4] ?? match[7])!);

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
      callee,
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

export default function csslit(): PluginOption {
  let comptimeEnvironment: RunnableDevEnvironment | null = null;
  let devServer: ViteDevServer | null = null;
  let loadClientModule: LoadModule | null = null;

  return [
    {
      name: "vite-plugin-csslit",
      // Run before Vite's built-in source transforms so csslit receives the original source.
      enforce: "pre",
      sharedDuringBuild: true,

      config(config) {
        config.builder ??= {};
        config.environments ??= {};
        const comptime = (config.environments["comptime"] ??= {});

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
              sourcemapInterceptor: isWebContainer ? "prepareStackTrace" : undefined,
            },
          });

        comptime.build ??= {};
        comptime.build.createEnvironment ??= (name, config) => {
          const environment = createRunnableDevEnvironment(name, config, {
            runnerOptions: {
              hmr: false,
              sourcemapInterceptor: isWebContainer ? "prepareStackTrace" : undefined,
            },
          });

          (environment as unknown as BuildEnvironment).isBuilt = true;
          comptimeEnvironment = environment;

          return environment as unknown as BuildEnvironment;
        };
      },

      configureServer(viteServer: ViteDevServer) {
        devServer = viteServer;
        comptimeEnvironment = viteServer.environments["comptime"] as RunnableDevEnvironment;
      },

      buildStart() {
        if (this.environment.name === "client") {
          loadClientModule = this.load.bind(this);
        }
      },

      async buildApp(builder) {
        const environment = builder.environments["comptime"];
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
            moduleImport: `${normalizePath(id)}.csslit.module.js`,
            cssSourcemap,
            filename: id,
            sourcemap: jsSourcemap,
          });
          const sourceMap = cssSourcemap
            ? (this.getCombinedSourcemap() as unknown as RemappingSourceMapInput)
            : null;

          return {
            code: result.runtime.code,
            map: result.runtime.map ?? null,
            meta: {
              csslit: {
                eval: {
                  code: result.eval.code,
                  map: result.eval.map ?? null,
                },
                exports: result.runtime.exports,
                sourceMap,
              } satisfies CsslitModuleMetadata,
            },
          };
        },
      },

      resolveId: {
        filter: {
          id: [/^virtual:csslit-eval-runtime$/, /\.csslit\.(?:module\.js|css)$/],
        },
        async handler(source, importer) {
          if (source === "virtual:csslit-eval-runtime") {
            return "\0virtual:csslit-eval-runtime";
          }

          if (source.endsWith(".csslit.module.js")) {
            const sourceId = source.slice(0, -".csslit.module.js".length);
            const resolved = await this.resolve(sourceId, importer);
            return {
              id: `${resolved!.id}.csslit.module.js`,
            };
          }

          if (source.endsWith(".csslit.css")) {
            const sourceId = source.slice(0, -".csslit.css".length);
            const resolved = await this.resolve(sourceId, importer);
            return {
              id: `${resolved!.id}.csslit.css`,
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
            /\.csslit\.css$/,
            /\.csslit\.module\.js$/,
            /\.(?:js|ts|jsx|tsx)\.csslit$/,
          ],
        },
        async handler(id) {
          if (id === "\0virtual:csslit-eval-runtime") {
            return csslitEvalRuntimeCode;
          } else if (id.endsWith(".csslit")) {
            const evalSourceId = id.slice(0, -".csslit".length);
            let metadata: CsslitModuleMetadata;

            // Link the virtual eval module to its source so Vite invalidates the runner cache.
            this.addWatchFile(evalSourceId);

            if (devServer) {
              // Vite dev's PluginContext.load is not the full Rollup/Rolldown load pipeline for
              // ordinary source files: it runs plugin load/transform hooks, but the default
              // filesystem read lives in transformRequest. Until that compat gap is fixed, force
              // the client owner module through transformRequest before reading transform metadata.
              // Related upstream compat issues:
              // https://github.com/vitejs/vite/issues/18914
              // https://github.com/vitejs/vite/issues/19674
              await devServer!.environments.client.transformRequest(evalSourceId);
              metadata = devServer!.environments.client.pluginContainer.getModuleInfo(evalSourceId)!
                .meta["csslit"] as CsslitModuleMetadata;
            } else {
              const moduleInfo = await loadClientModule!({ id: evalSourceId });
              metadata = moduleInfo.meta["csslit"] as CsslitModuleMetadata;
            }

            return {
              code: metadata.eval.code,
              map: metadata.eval.map,
            };
          } else if (id.endsWith(".csslit.module.js")) {
            const sourceId = id.slice(0, -".csslit.module.js".length);
            let metadata: CsslitModuleMetadata;

            this.addWatchFile(sourceId);

            if (devServer) {
              await devServer!.environments.client.transformRequest(sourceId);
              metadata = devServer!.environments.client.pluginContainer.getModuleInfo(sourceId)!
                .meta["csslit"] as CsslitModuleMetadata;
            } else {
              const moduleInfo = await loadClientModule!({ id: sourceId });
              metadata = moduleInfo.meta["csslit"] as CsslitModuleMetadata;
            }

            const exports = Object.fromEntries(
              metadata.exports.map((entry) => [
                entry.localName,
                this.environment.name === "comptime"
                  ? `__csslit_class_${entry.scopedName}`
                  : entry.scopedName,
              ]),
            );

            return {
              code:
                this.environment.name === "comptime"
                  ? `export default ${JSON.stringify(exports)};\n`
                  : `import ${JSON.stringify(`${sourceId}.csslit.css`)};\nexport default ${JSON.stringify(exports)};\n`,
              map: null,
            };
          } else if (id.endsWith(".csslit.css")) {
            const sourceId = id.slice(0, -".csslit.css".length);
            const sourceFile = sourceId;
            const evalId = `${sourceId}.csslit`;
            let metadata: CsslitModuleMetadata;
            let result: EvalResult;

            this.addWatchFile(sourceId);
            metadata = this.getModuleInfo(sourceId)!.meta["csslit"] as CsslitModuleMetadata;

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

            result = mod["__csslit_eval_result"] as EvalResult;

            if (result.errors.length > 0) {
              const error = buildCsslitError(result.errors, {
                ...csslitErrorResolutionOptions,
                sourceFile,
              });

              this.error({
                code: "CSS_EVALUATION_ERROR",
                frame: error.frame,
                hook: "load",
                id: sourceId,
                loc: error.loc,
                message: error.message,
              });
            }

            const compiled = compileCsslit({
              blocks: result.blocks,
              filename: sourceId,
              sourcemap: metadata.sourceMap !== null,
            });

            return {
              code: compiled.code,
              map:
                compiled.map && metadata.sourceMap
                  ? (remapping(
                      [compiled.map as unknown as RemappingSourceMapInput, metadata.sourceMap],
                      () => null,
                    ) as SourceMapInput)
                  : (compiled.map ?? null),
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
