import { compileCsslit, transformClient } from "@csslit/transform";
import type { ClientTransformResult, CsslitEvalBlock } from "@csslit/transform";
import { readFileSync } from "node:fs";
import path from "node:path";
import { composeCssSourcemap } from "./compose-sourcemap.ts";
import { BuildEnvironment, createRunnableDevEnvironment, normalizePath } from "vite";
import type {
  Environment,
  PluginOption,
  ResolvedConfig,
  Rolldown,
  RunnableDevEnvironment,
  ViteBuilder,
  ViteDevServer,
} from "vite";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite/module-runner";
import { buildCsslitError, buildCsslitEvaluationError } from "./eval-error.ts";
import type { EvalDiagnostic, Location } from "./eval-error.ts";
import { csslitComptimeBuildImportNormalizer } from "./import-normalizer.ts";

interface EvalResult {
  blocks: CsslitEvalBlock[];
  errors: EvalDiagnostic[];
}

interface CsslitModuleMetadata {
  result: ClientTransformResult;
  sourceMap: Rolldown.SourceMapInput | null;
}

type LoadModule = Rolldown.PluginContext["load"];

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

// Clone of Vite's internal fileToDevUrl (vite:asset), which is not exported. Intended to exactly
// reproduce its result for source files so csslit map sources resolve to the same dev-server URL
// as the file's own module. The asset-only branches (public files, inlining, server.origin) are
// omitted because they cannot apply to csslit source modules.
function fileToDevUrl(file: string, config: { base: string; root: string }): string {
  const url = file.startsWith(`${config.root}/`)
    ? `/${path.posix.relative(config.root, file)}`
    : path.posix.join("/@fs/", file);
  return config.base.endsWith("/") ? config.base.slice(0, -1) + url : config.base + url;
}

export type CsslitModuleType = "js" | "jsx" | "ts" | "tsx";

export interface CsslitOptions {
  /** Parser source type for extensions lowered by another plugin. */
  moduleType?: Record<string, CsslitModuleType>;
}

const defaultModuleTypes: Record<string, CsslitModuleType> = {
  ".jsx": "jsx",
  ".tsx": "tsx",
  ".js": "js",
  ".ts": "ts",
};

export default function csslit(options: CsslitOptions = {}): PluginOption {
  const moduleTypes = { ...defaultModuleTypes, ...options.moduleType };

  const pattern = (extensions: string[]) => extensions.map(RegExp.escape).join("|");
  const filterExtensions = pattern(Object.keys(moduleTypes));
  const preExtensions = pattern(Object.keys(defaultModuleTypes));
  const normalExtensions = Object.keys(moduleTypes).filter(
    (extension) => !(extension in defaultModuleTypes),
  );

  let projectConfiguredBuilder = false;
  let projectHasBuildApp = false;
  let buildBuilder: ViteBuilder | null = null;
  let devServer: ViteDevServer | null = null;
  let loadClientModule: LoadModule | null = null;

  function getComptimeEnvironment() {
    const environment =
      devServer?.environments["comptime"] ?? buildBuilder?.environments["comptime"];
    return environment as RunnableDevEnvironment;
  }

  async function transformModule(
    this: Rolldown.TransformPluginContext,
    code: string,
    id: string,
  ): Promise<Rolldown.TransformResult> {
    const config = this.environment.config;

    const jsSourcemap =
      config.command === "build"
        ? !!config.build.sourcemap
        : typeof config.dev.sourcemap === "boolean"
          ? config.dev.sourcemap
          : (config.dev.sourcemap?.js ?? true);

    const cssSourcemap = config.command === "build" ? false : config.css.devSourcemap;

    const ext = id.slice(id.lastIndexOf("."));
    const moduleType = moduleTypes[ext]!;

    const result = transformClient(code, {
      cssFilename: path.posix.relative(config.root, id),
      cssSourcemap,
      filename: id,
      importPath: normalizePath(id),
      moduleType,
      sourcemap: jsSourcemap,
    });

    if (!result) {
      return null;
    }

    let sourceMap: Rolldown.SourceMap | null = null;
    if (cssSourcemap) {
      sourceMap = this.getCombinedSourcemap();
      for (let i = 0; i < sourceMap.sources.length; i++) {
        const source = sourceMap.sources[i];
        if (source) sourceMap.sources[i] = fileToDevUrl(source, config);
      }
    }

    return {
      code: result.runtime.code,
      map: result.runtime.map ?? null,
      moduleType,
      meta: {
        csslit: {
          result,
          sourceMap,
        },
      },
    };
  }

  return [
    {
      name: "vite-plugin-csslit",
      enforce: "pre",
      sharedDuringBuild: true,

      config(config) {
        projectConfiguredBuilder = Boolean(config.builder);
        config.builder ??= {};
        config.environments ??= {};
        const comptime = (config.environments["comptime"] ??= {});
        const createComptimeBuildEnvironment = (name: string, config: ResolvedConfig) =>
          createRunnableDevEnvironment(name, config, {
            runnerOptions: {
              hmr: false,
              sourcemapInterceptor: isWebContainer ? "prepareStackTrace" : undefined,
            },
          }) as unknown as BuildEnvironment;

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
        comptime.build.createEnvironment ??= createComptimeBuildEnvironment;

        config.build ??= {};
        const createBuildEnvironment = config.build.createEnvironment;
        config.build.createEnvironment = (name, resolvedConfig) =>
          name === "comptime"
            ? createComptimeBuildEnvironment(name, resolvedConfig)
            : (createBuildEnvironment?.(name, resolvedConfig) ??
              new BuildEnvironment(name, resolvedConfig));
      },

      configureServer(viteServer: ViteDevServer) {
        devServer = viteServer;
      },

      buildStart() {
        if (this.environment.name === "client") {
          loadClientModule = this.load.bind(this);
        }
      },

      buildApp: {
        order: "pre",
        async handler(builder) {
          buildBuilder = builder;
        },
      },

      transform: {
        filter: {
          id: new RegExp(`(?:${preExtensions})$`),
        },
        handler: transformModule,
      },

      resolveId: {
        filter: {
          id: [/^virtual:csslit-eval-runtime$/, /\.(?:csslit\.json|csslit\.css)$/],
        },
        async handler(source, importer) {
          if (source === "virtual:csslit-eval-runtime") {
            return "\0virtual:csslit-eval-runtime";
          } else if (source.endsWith(".csslit.json")) {
            const sourceId = source.slice(0, -".csslit.json".length);
            const resolved = await this.resolve(sourceId, importer);
            return {
              id: `${resolved!.id}.csslit.json`,
            };
          } else if (source.endsWith(".csslit.css")) {
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
            /\.(?:csslit\.json|csslit\.css)$/,
            new RegExp(`(?:${filterExtensions})\\.csslit$`),
          ],
        },
        async handler(id) {
          if (id === "\0virtual:csslit-eval-runtime") {
            return csslitEvalRuntimeCode;
          } else if (id.endsWith(".csslit")) {
            const evalSourceId = id.slice(0, -".csslit".length);
            let metadata: CsslitModuleMetadata;

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
              code: metadata.result.eval.code,
              map: metadata.result.eval.map,
            };
          } else if (id.endsWith(".csslit.json")) {
            const sourceId = id.slice(0, -".csslit.json".length);
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
              metadata.result.runtime.exports.map((entry) => [
                entry.localName,
                this.environment.name === "comptime"
                  ? `__csslit_class_${entry.scopedName}`
                  : entry.scopedName,
              ]),
            );

            return JSON.stringify(exports);
          } else if (id.endsWith(".csslit.css")) {
            const sourceId = id.slice(0, -".csslit.css".length);
            const sourceFile = sourceId;
            const evalId = `${sourceId}.csslit`;
            let metadata: CsslitModuleMetadata;
            let result: EvalResult;

            this.addWatchFile(sourceId);
            metadata = this.getModuleInfo(sourceId)!.meta["csslit"] as CsslitModuleMetadata;

            const runnerEnvironment = getComptimeEnvironment();

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
              return; // this.error returning never is not enough for TS to understand mod is assigned below for some reason.
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
              filename: path.posix.relative(this.environment.config.root, sourceId),
              sourcemap: metadata.sourceMap !== null,
            });

            return {
              code: compiled.code,
              map:
                compiled.map && metadata.sourceMap
                  ? composeCssSourcemap(compiled.map, metadata.sourceMap)
                  : (compiled.map ?? null),
              moduleType: "css",
            };
          } else {
            return null;
          }
        },
      },
    },

    normalExtensions.length > 0 && {
      name: "vite-plugin-csslit-lowered",
      sharedDuringBuild: true,
      transform: {
        filter: {
          id: new RegExp(`(?:${pattern(normalExtensions)})$`),
        },
        handler: transformModule,
      },
    },

    csslitComptimeBuildImportNormalizer(),

    {
      name: "vite-plugin-csslit-build",
      sharedDuringBuild: true,

      config: {
        order: "post",
        handler(config) {
          projectHasBuildApp = typeof config.builder?.buildApp === "function";
        },
      },

      buildApp: {
        order: "post",
        async handler(builder) {
          try {
            if (!projectHasBuildApp) {
              const legacyEnvironment = builder.config.build.ssr ? "ssr" : "client";
              await Promise.all(
                Object.entries(builder.environments)
                  .filter(
                    ([name, environment]) =>
                      name !== "comptime" &&
                      !environment.isBuilt &&
                      (projectConfiguredBuilder || name === legacyEnvironment),
                  )
                  .map(([, environment]) => builder.build(environment)),
              );
            }

            if (builder.environments["comptime"]?.isBuilt) {
              throw new Error(
                "csslit's `comptime` environment was built as an app output. It exists only to " +
                  "evaluate css templates at compile time and has no entry. The project's " +
                  "`builder.buildApp` builds every registered environment; build the ones it needs " +
                  "by name instead.",
              );
            }
          } finally {
            const environment = builder.environments[
              "comptime"
            ] as Environment as RunnableDevEnvironment;
            await environment.close();
            buildBuilder = null;
            loadClientModule = null;
          }
        },
      },
    },
  ];
}
