import { transformCompileTime, transformRuntime } from "@csslit/rust-transformer";
import type { RawSourceMap } from "@csslit/rust-transformer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRunnableDevEnvironment, normalizePath } from "vite-plus";
import type { Plugin, ViteDevServer, RunnableDevEnvironment } from "vite-plus";
import type { EvaluatedModuleNode, EvaluatedModules } from "vite-plus/module-runner";
import type { SourceMapInput } from "@voidzero-dev/vite-plus-core/rolldown";

const CSS_DERIVED_SUFFIX = ".csslit.module.css";
const CSS_EVAL_QUERY = "csslit-eval";
const CSSLIT_EVAL_RESULT_EXPORT = "__csslit_eval_result";
const CSSLIT_COMPTIME_ENVIRONMENT = "comptime";
const CSSLIT_EVAL_RUNTIME_ID = "virtual:csslit-eval-runtime";
const RESOLVED_CSSLIT_EVAL_RUNTIME_ID = "\0virtual:csslit-eval-runtime";
const SCRIPT_ID_RE = /\.(?:js|ts|jsx|tsx)?(?:$|\?)/;
const CSS_DERIVED_ID_RE = /\.csslit\.module\.css$/;

type CsslitEvalResult = {
  code: string;
  map: SourceMapInput | null;
};

const csslitEvalRuntimeCode = readFileSync(new URL("./eval-runtime.js", import.meta.url), "utf8");

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
            root: config.root,
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
      async handler(source, importer) {
        if (source === CSSLIT_EVAL_RUNTIME_ID) {
          return RESOLVED_CSSLIT_EVAL_RUNTIME_ID;
        }

        if (!CSS_DERIVED_ID_RE.test(source)) {
          return null;
        }

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
      async handler(id) {
        if (id === RESOLVED_CSSLIT_EVAL_RUNTIME_ID) {
          return csslitEvalRuntimeCode;
        }

        if (!CSS_DERIVED_ID_RE.test(id)) {
          return null;
        }

        const absPath = id.slice(0, -CSS_DERIVED_SUFFIX.length);
        const evalId = `${absPath}?${CSS_EVAL_QUERY}`;

        try {
          const runner = evalEnvironment!.runner;
          const evalModule = runner.evaluatedModules.getModuleByUrl(evalId);
          if (evalModule) {
            runner.evaluatedModules.invalidateModule(evalModule);
          }
          const mod = await runner.import(evalId);
          watchCssEvalDependencies(
            (file) => this.addWatchFile(file),
            runner.evaluatedModules,
            evalId,
          );
          const result = mod[CSSLIT_EVAL_RESULT_EXPORT] as CsslitEvalResult;

          return {
            code: result.code,
            map: result.map ?? null,
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
